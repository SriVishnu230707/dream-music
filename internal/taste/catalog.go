package taste

import (
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"os"
	"path/filepath"
	"regexp"
	"strings"
)

var trackIDPattern = regexp.MustCompile(`^[a-z0-9][a-z0-9-]*$`)

type Track struct {
	ID     string `json:"id"`
	Title  string `json:"title"`
	Artist string `json:"artist"`
	Genre  string `json:"genre"`
	BPM    int    `json:"bpm"`
	Mood   struct {
		Valence    float64 `json:"valence"`
		Arousal    float64 `json:"arousal"`
		Provenance string  `json:"provenance"`
	} `json:"mood"`
	Audio struct {
		Path            string `json:"path"`
		Rights          string `json:"rights"`
		DurationSeconds int    `json:"durationSeconds"`
	} `json:"audio"`
}

type Catalog struct {
	ID          string
	Tracks      []Track
	byID        map[string]Track
	catalogRoot string
	audioDir    string
}

func LoadCatalog(root string) (Catalog, error) {
	base := filepath.Join(root, "data", "catalog")
	file, err := os.Open(filepath.Join(base, "demo-tracks.json"))
	if err != nil {
		return Catalog{}, err
	}
	defer file.Close()
	var manifest struct {
		SchemaVersion string  `json:"schemaVersion"`
		CatalogID     string  `json:"catalogId"`
		Tracks        []Track `json:"tracks"`
	}
	if err := json.NewDecoder(file).Decode(&manifest); err != nil {
		return Catalog{}, err
	}
	if manifest.SchemaVersion != "1.0.0" || manifest.CatalogID == "" {
		return Catalog{}, errors.New("unsupported catalog")
	}
	allowed, err := filepath.EvalSymlinks(filepath.Join(base, "audio", "generated"))
	if err != nil {
		return Catalog{}, err
	}
	catalog := Catalog{ID: manifest.CatalogID, byID: make(map[string]Track), catalogRoot: base, audioDir: allowed}
	for _, track := range manifest.Tracks {
		if !trackIDPattern.MatchString(track.ID) || track.Title == "" || track.Artist == "" || track.Genre == "" || track.BPM < 40 || track.BPM > 200 {
			return Catalog{}, fmt.Errorf("invalid track metadata: %q", track.ID)
		}
		if track.Mood.Provenance != "design-proxy" || !unit(track.Mood.Valence) || !unit(track.Mood.Arousal) ||
			track.Audio.Rights != "project-original-demo" || track.Audio.DurationSeconds < 1 || track.Audio.DurationSeconds > 60 {
			return Catalog{}, fmt.Errorf("invalid track provenance or mood: %s", track.ID)
		}
		if track.Audio.Path != "audio/generated/"+track.ID+".wav" || strings.Contains(track.Audio.Path, `\`) {
			return Catalog{}, fmt.Errorf("unsafe audio path: %s", track.ID)
		}
		path := filepath.Join(base, filepath.FromSlash(track.Audio.Path))
		resolved, err := filepath.EvalSymlinks(path)
		if err != nil {
			return Catalog{}, fmt.Errorf("unplayable track %s: %w", track.ID, err)
		}
		if filepath.Dir(resolved) != allowed {
			return Catalog{}, fmt.Errorf("audio escapes catalog: %s", track.ID)
		}
		if err := validateWAV(resolved, track.Audio.DurationSeconds); err != nil {
			return Catalog{}, fmt.Errorf("unplayable track %s: %w", track.ID, err)
		}
		if _, exists := catalog.byID[track.ID]; exists {
			return Catalog{}, fmt.Errorf("duplicate track ID: %s", track.ID)
		}
		catalog.Tracks = append(catalog.Tracks, track)
		catalog.byID[track.ID] = track
	}
	if len(catalog.Tracks) == 0 {
		return Catalog{}, errors.New("empty playable catalog")
	}
	return catalog, nil
}

func (c Catalog) Track(id string) (Track, bool) { track, ok := c.byID[id]; return track, ok }
func (c Catalog) Count() int                    { return len(c.Tracks) }
func unit(value float64) bool {
	return !math.IsNaN(value) && !math.IsInf(value, 0) && value >= 0 && value <= 1
}

// ValidateCandidates catches audio removed or replaced after catalog startup.
func (c Catalog) ValidateCandidates(candidates []Candidate) error {
	for _, candidate := range candidates {
		track, ok := c.Track(candidate.TrackID)
		if !ok {
			return fmt.Errorf("unknown candidate: %s", candidate.TrackID)
		}
		resolved, err := filepath.EvalSymlinks(filepath.Join(c.catalogRoot, filepath.FromSlash(track.Audio.Path)))
		if err != nil {
			return fmt.Errorf("audio unavailable for %s: %w", track.ID, err)
		}
		if filepath.Dir(resolved) != c.audioDir {
			return fmt.Errorf("audio path changed for %s", track.ID)
		}
		if err := validateWAV(resolved, track.Audio.DurationSeconds); err != nil {
			return fmt.Errorf("audio invalid for %s: %w", track.ID, err)
		}
	}
	return nil
}

func validateWAV(path string, duration int) error {
	if duration < 1 || duration > 60 {
		return errors.New("invalid WAV duration")
	}
	file, err := os.Open(path)
	if err != nil {
		return err
	}
	defer file.Close()
	info, err := file.Stat()
	if err != nil {
		return err
	}
	expected := int64(44 + 22050*duration*2)
	if !info.Mode().IsRegular() || info.Size() != expected {
		return errors.New("unexpected WAV size")
	}
	header := make([]byte, 44)
	if _, err := io.ReadFull(file, header); err != nil {
		return err
	}
	if string(header[:4]) != "RIFF" || binary.LittleEndian.Uint32(header[4:8]) != uint32(expected-8) ||
		string(header[8:12]) != "WAVE" || string(header[12:16]) != "fmt " ||
		binary.LittleEndian.Uint32(header[16:20]) != 16 ||
		string(header[36:40]) != "data" || binary.LittleEndian.Uint16(header[20:22]) != 1 ||
		binary.LittleEndian.Uint16(header[22:24]) != 1 || binary.LittleEndian.Uint32(header[24:28]) != 22050 ||
		binary.LittleEndian.Uint32(header[28:32]) != 44100 || binary.LittleEndian.Uint16(header[32:34]) != 2 ||
		binary.LittleEndian.Uint16(header[34:36]) != 16 ||
		binary.LittleEndian.Uint32(header[40:44]) != uint32(expected-44) {
		return errors.New("invalid WAV header")
	}
	pcm := make([]byte, expected-44)
	if _, err := io.ReadFull(file, pcm); err != nil {
		return err
	}
	nonzero := 0
	for i := 0; i < len(pcm); i += 2 {
		if binary.LittleEndian.Uint16(pcm[i:i+2]) != 0 {
			nonzero++
		}
	}
	if nonzero < len(pcm)/8 {
		return errors.New("silent or nearly silent WAV")
	}
	return nil
}
