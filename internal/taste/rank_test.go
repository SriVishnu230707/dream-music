package taste

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

func fixtureCatalog() Catalog {
	var tracks []Track
	data := []string{
		`{"id":"a-ambient","title":"A","artist":"Lab","genre":"ambient","bpm":60,"audio":{"path":"audio/generated/a-ambient.wav","durationSeconds":12}}`,
		`{"id":"b-ambient","title":"B","artist":"Lab","genre":"ambient","bpm":65,"audio":{"path":"audio/generated/b-ambient.wav","durationSeconds":12}}`,
		`{"id":"c-pulse","title":"C","artist":"Lab","genre":"pulse","bpm":130,"audio":{"path":"audio/generated/c-pulse.wav","durationSeconds":12}}`,
		`{"id":"d-pulse","title":"D","artist":"Lab","genre":"pulse","bpm":135,"audio":{"path":"audio/generated/d-pulse.wav","durationSeconds":12}}`,
	}
	byID := map[string]Track{}
	for _, raw := range data {
		var track Track
		if err := json.Unmarshal([]byte(raw), &track); err != nil {
			panic(err)
		}
		tracks = append(tracks, track)
		byID[track.ID] = track
	}
	return Catalog{ID: "test", Tracks: tracks, byID: byID}
}

func request() Request               { return Request{UserID: "user", Strategy: "taste", Limit: 4} }
func seconds(value float64) *float64 { return &value }

func TestPreferencesAndLikesChangeRanking(t *testing.T) {
	c := fixtureCatalog()
	r := request()
	r.PreferredGenres = []string{"ambient"}
	out, err := Rank(c, r)
	if err != nil {
		t.Fatal(err)
	}
	if out.Candidates[0].Genre != "ambient" || out.Candidates[1].Genre != "ambient" {
		t.Fatalf("genre preference ignored: %+v", out.Candidates)
	}
	r = request()
	r.LikedTrackIDs = []string{"a-ambient"}
	r.ExcludeTrackIDs = []string{"a-ambient"}
	out, err = Rank(c, r)
	if err != nil {
		t.Fatal(err)
	}
	if out.Candidates[0].TrackID != "b-ambient" {
		t.Fatalf("liked-track similarity ignored: %+v", out.Candidates)
	}
}

func TestDuplicateAndConflictingEvents(t *testing.T) {
	c := fixtureCatalog()
	r := request()
	event := Event{EventID: "e1", TrackID: "a-ambient", Type: "like"}
	r.Events = []Event{event}
	one, err := Rank(c, r)
	if err != nil {
		t.Fatal(err)
	}
	r.Events = append(r.Events, event)
	two, err := Rank(c, r)
	if err != nil {
		t.Fatal(err)
	}
	if one.Candidates[0].Scores != two.Candidates[0].Scores {
		t.Fatal("duplicate event changed score")
	}
	r.Events[1].TrackID = "c-pulse"
	if _, err := Rank(c, r); err == nil {
		t.Fatal("conflicting event ID accepted")
	}
}

func TestSkipIsWeakAndColdStartDiversifies(t *testing.T) {
	c := fixtureCatalog()
	r := request()
	r.Limit = 2
	cold, err := Rank(c, r)
	if err != nil {
		t.Fatal(err)
	}
	if !cold.ColdStart || cold.Candidates[0].Genre == cold.Candidates[1].Genre {
		t.Fatal("cold start lacks genre coverage")
	}
	r.Events = []Event{{EventID: "skip", TrackID: "a-ambient", Type: "skip", ListenedSeconds: seconds(1)}}
	result, err := Rank(c, r)
	if err != nil {
		t.Fatal(err)
	}
	if result.ColdStart || result.Candidates[0].Genre != "pulse" {
		t.Fatalf("short skip did not weakly penalize similar tracks: %+v", result.Candidates)
	}
	r.Events[0].ListenedSeconds = nil
	result, err = Rank(c, r)
	if err != nil {
		t.Fatal(err)
	}
	if !result.ColdStart {
		t.Fatal("skip without duration became negative evidence")
	}
}

func TestPopularityAndExploration(t *testing.T) {
	c := fixtureCatalog()
	r := request()
	r.Strategy = "popularity"
	r.PopularityCounts = map[string]int64{"d-pulse": 50}
	out, err := Rank(c, r)
	if err != nil {
		t.Fatal(err)
	}
	if out.Candidates[0].TrackID != "d-pulse" {
		t.Fatal("popularity baseline ignored count")
	}
	r = request()
	r.Strategy = "taste-explore"
	r.LikedTrackIDs = []string{"a-ambient"}
	out, err = Rank(c, r)
	if err != nil {
		t.Fatal(err)
	}
	seen := map[string]bool{}
	for _, candidate := range out.Candidates {
		if seen[candidate.TrackID] || candidate.AudioPath == "" {
			t.Fatal("duplicate or unplayable candidate")
		}
		seen[candidate.TrackID] = true
	}
	if out.Candidates[len(out.Candidates)-1].Reason != "Exploration of an unseen track" {
		t.Fatal("missing exploration slot")
	}
}

func TestInvalidRequest(t *testing.T) {
	c := fixtureCatalog()
	r := request()
	r.Limit = 21
	if _, err := Rank(c, r); err == nil {
		t.Fatal("oversized ranking accepted")
	}
	r = request()
	r.LikedTrackIDs = []string{"not-a-track"}
	if _, err := Rank(c, r); err == nil {
		t.Fatal("unknown track accepted")
	}
	r = request()
	r.PopularityCounts = map[string]int64{"a-ambient": -1}
	if _, err := Rank(c, r); err == nil {
		t.Fatal("negative popularity accepted")
	}
}

func TestUnsupportedGenreFallsBackToColdStart(t *testing.T) {
	r := request()
	r.PreferredGenres = []string{"jazz"}
	out, err := Rank(fixtureCatalog(), r)
	if err != nil {
		t.Fatal(err)
	}
	if !out.ColdStart || len(out.UnsupportedGenres) != 1 || out.UnsupportedGenres[0] != "jazz" {
		t.Fatalf("unsupported genre presented as personalization: %+v", out)
	}
}

func TestScoresAreDeterministicAcrossMapIteration(t *testing.T) {
	c := fixtureCatalog()
	r := request()
	r.LikedTrackIDs = []string{"a-ambient", "c-pulse"}
	first, err := Rank(c, r)
	if err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 50; i++ {
		next, err := Rank(c, r)
		if err != nil {
			t.Fatal(err)
		}
		for j := range first.Candidates {
			if first.Candidates[j].TrackID != next.Candidates[j].TrackID || first.Candidates[j].Scores != next.Candidates[j].Scores {
				t.Fatal("ranking changed across identical calls")
			}
		}
	}
}

func TestMalformedAudioRejected(t *testing.T) {
	path := filepath.Join(t.TempDir(), "bad.wav")
	if err := os.WriteFile(path, make([]byte, 44+22050*2), 0600); err != nil {
		t.Fatal(err)
	}
	if err := validateWAV(path, 1); err == nil {
		t.Fatal("malformed WAV accepted")
	}
}
