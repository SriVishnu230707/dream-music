package session

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime"
	"net"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/SriVishnu230707/dream-music/internal/sequence"
	"github.com/SriVishnu230707/dream-music/internal/taste"
)

type Server struct {
	Catalog taste.Catalog
	Store   Store
	Root    string
	MoodURL string
	Client  *http.Client
}

func (s Server) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/health", func(w http.ResponseWriter, r *http.Request) {
		jsonResponse(w, 200, map[string]any{"status": "ok", "catalogId": s.Catalog.ID})
	})
	mux.HandleFunc("GET /api/v1/catalog", s.catalog)
	mux.HandleFunc("POST /api/v1/mood/predict", s.predict)
	mux.HandleFunc("POST /api/v1/sessions", s.create)
	mux.HandleFunc("GET /api/v1/sessions/{id}", s.get)
	mux.HandleFunc("POST /api/v1/sessions/{id}/advance", s.advance)
	mux.HandleFunc("GET /audio/{id}", s.audio)
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		host, _, err := net.SplitHostPort(r.Host)
		if err != nil || (host != "127.0.0.1" && host != "::1") {
			jsonError(w, 403, "local host required")
			return
		}
		if origin := r.Header.Get("Origin"); origin != "" {
			parsed, err := url.Parse(origin)
			if err != nil || parsed.Scheme != "http" || parsed.User != nil || parsed.Path != "" || parsed.RawQuery != "" || parsed.Fragment != "" {
				jsonError(w, 403, "origin rejected")
				return
			}
			originHost, _, err := net.SplitHostPort(parsed.Host)
			if err != nil || (originHost != "127.0.0.1" && originHost != "::1") {
				jsonError(w, 403, "origin rejected")
				return
			}
		}
		mux.ServeHTTP(w, r)
	})
}

func (s Server) catalog(w http.ResponseWriter, r *http.Request) {
	type item struct {
		ID              string `json:"id"`
		Title           string `json:"title"`
		Artist          string `json:"artist"`
		Genre           string `json:"genre"`
		DurationSeconds int    `json:"durationSeconds"`
		Attribution     string `json:"attribution"`
		AudioURL        string `json:"audioUrl"`
	}
	tracks := make([]item, 0, s.Catalog.Count())
	for _, track := range s.Catalog.Tracks {
		tracks = append(tracks, item{track.ID, track.Title, track.Artist, track.Genre, track.Audio.DurationSeconds, "Synthesized for Mood Drift Music by the project generator.", "/audio/" + track.ID})
	}
	jsonResponse(w, 200, map[string]any{"catalogId": s.Catalog.ID, "tracks": tracks})
}

func (s Server) create(w http.ResponseWriter, r *http.Request) {
	var req sequence.Request
	if err := decode(r, w, &req, 64*1024, "session"); err != nil {
		jsonError(w, 400, err.Error())
		return
	}
	if req.Taste.PreferredGenres == nil || req.Taste.LikedTrackIDs == nil {
		jsonError(w, 400, "taste arrays required")
		return
	}
	plan, err := sequence.Build(s.Catalog, req)
	if err != nil {
		var insufficient sequence.InsufficientError
		if errors.As(err, &insufficient) {
			jsonResponse(w, 422, map[string]any{"error": err.Error(), "available": insufficient.Available})
		} else {
			jsonError(w, 400, err.Error())
		}
		return
	}
	candidates := make([]taste.Candidate, len(plan.Queue))
	for i, q := range plan.Queue {
		candidates[i] = taste.Candidate{TrackID: q.TrackID}
	}
	if err := s.Catalog.ValidateCandidates(candidates); err != nil {
		jsonError(w, 503, "queue audio unavailable")
		return
	}
	id, err := sessionID()
	if err != nil {
		jsonError(w, 500, "session ID unavailable")
		return
	}
	record, err := s.Store.Create(r.Context(), Record{ID: id, UserID: req.UserID, CatalogID: plan.CatalogID, Queue: plan.Queue})
	if err != nil {
		jsonError(w, 503, "session storage unavailable")
		return
	}
	jsonResponse(w, 201, record)
}

func (s Server) get(w http.ResponseWriter, r *http.Request) {
	record, err := s.Store.Get(r.Context(), r.PathValue("id"))
	if err != nil {
		storeError(w, err)
		return
	}
	jsonResponse(w, 200, record)
}

func (s Server) advance(w http.ResponseWriter, r *http.Request) {
	var input struct {
		ExpectedRevision int    `json:"expectedRevision"`
		Action           string `json:"action"`
	}
	if err := decode(r, w, &input, 1024, "advance"); err != nil {
		jsonError(w, 400, err.Error())
		return
	}
	if input.ExpectedRevision < 1 || (input.Action != "skip" && input.Action != "complete") {
		jsonError(w, 400, "invalid advance request")
		return
	}
	record, err := s.Store.Advance(r.Context(), r.PathValue("id"), input.ExpectedRevision, input.Action)
	if err != nil {
		storeError(w, err)
		return
	}
	jsonResponse(w, 200, record)
}

func (s Server) audio(w http.ResponseWriter, r *http.Request) {
	track, ok := s.Catalog.Track(r.PathValue("id"))
	if !ok {
		jsonError(w, 404, "track not found")
		return
	}
	if err := s.Catalog.ValidateCandidates([]taste.Candidate{{TrackID: track.ID}}); err != nil {
		jsonError(w, 503, "audio unavailable")
		return
	}
	path := filepath.Join(s.Root, "data", "catalog", filepath.FromSlash(track.Audio.Path))
	file, err := os.Open(path)
	if err != nil {
		jsonError(w, 503, "audio unavailable")
		return
	}
	defer file.Close()
	stat, err := file.Stat()
	if err != nil {
		jsonError(w, 503, "audio unavailable")
		return
	}
	w.Header().Set("Content-Type", "audio/wav")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	http.ServeContent(w, r, track.ID+".wav", stat.ModTime(), file)
}

func (s Server) predict(w http.ResponseWriter, r *http.Request) {
	var input struct {
		Text string `json:"text"`
	}
	if err := decode(r, w, &input, 4096, "predict"); err != nil {
		jsonError(w, 400, err.Error())
		return
	}
	if len([]rune(input.Text)) > 1000 {
		jsonError(w, 400, "text exceeds 1000 characters")
		return
	}
	payload, _ := json.Marshal(input)
	ctx, cancel := context.WithTimeout(r.Context(), 3*time.Second)
	defer cancel()
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, strings.TrimRight(s.MoodURL, "/")+"/v1/mood/predict", bytes.NewReader(payload))
	if err != nil {
		jsonError(w, 503, "mood service unavailable")
		return
	}
	request.Header.Set("Content-Type", "application/json")
	client := s.Client
	if client == nil {
		client = &http.Client{Timeout: 3 * time.Second}
	}
	response, err := client.Do(request)
	if err != nil {
		jsonError(w, 503, "mood service unavailable; choose mood manually")
		return
	}
	defer response.Body.Close()
	if response.StatusCode != 200 {
		jsonError(w, 503, "mood service unavailable; choose mood manually")
		return
	}
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	_, _ = io.Copy(w, io.LimitReader(response.Body, 32*1024))
}

func storeError(w http.ResponseWriter, err error) {
	if errors.Is(err, ErrNotFound) {
		jsonError(w, 404, "session not found")
	} else if errors.Is(err, ErrConflict) {
		jsonError(w, 409, "session changed; reload it")
	} else {
		jsonError(w, 503, "session storage unavailable")
	}
}
func jsonError(w http.ResponseWriter, status int, message string) {
	jsonResponse(w, status, map[string]string{"error": message})
}
func jsonResponse(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}

func decode(r *http.Request, w http.ResponseWriter, out any, maxBytes int64, shape string) error {
	media, _, err := mime.ParseMediaType(r.Header.Get("Content-Type"))
	if err != nil || media != "application/json" {
		return errors.New("Content-Type must be application/json")
	}
	r.Body = http.MaxBytesReader(w, r.Body, maxBytes)
	raw, err := io.ReadAll(r.Body)
	if err != nil {
		return errors.New("request too large")
	}
	if err := checkJSON(raw); err != nil {
		return err
	}
	if err := validateShape(raw, shape); err != nil {
		return err
	}
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(out); err != nil {
		return errors.New("invalid JSON fields")
	}
	if err := decoder.Decode(new(any)); !errors.Is(err, io.EOF) {
		return errors.New("trailing JSON")
	}
	return nil
}
func validateShape(raw []byte, shape string) error {
	var root map[string]json.RawMessage
	if err := json.Unmarshal(raw, &root); err != nil || root == nil {
		return errors.New("request must be an object")
	}
	var allowed, required []string
	switch shape {
	case "session":
		allowed = []string{"userId", "checkInText", "startMood", "targetMood", "trackCount", "taste"}
		required = []string{"userId", "startMood", "targetMood", "trackCount", "taste"}
	case "advance":
		allowed = []string{"expectedRevision", "action"}
		required = allowed
	case "predict":
		allowed = []string{"text"}
		required = allowed
	default:
		return errors.New("unknown request shape")
	}
	if err := keys(root, allowed, required); err != nil {
		return err
	}
	if shape == "session" {
		for _, entry := range []struct {
			name              string
			allowed, required []string
		}{
			{"startMood", []string{"valence", "arousal", "source", "confidence"}, []string{"valence", "arousal", "source"}},
			{"targetMood", []string{"valence", "arousal"}, []string{"valence", "arousal"}},
			{"taste", []string{"preferredGenres", "likedTrackIds"}, []string{"preferredGenres", "likedTrackIds"}},
		} {
			var nested map[string]json.RawMessage
			if err := json.Unmarshal(root[entry.name], &nested); err != nil || nested == nil {
				return fmt.Errorf("%s must be an object", entry.name)
			}
			if err := keys(nested, entry.allowed, entry.required); err != nil {
				return err
			}
		}
	}
	return nil
}
func keys(fields map[string]json.RawMessage, allowed, required []string) error {
	valid := map[string]bool{}
	for _, key := range allowed {
		valid[key] = true
	}
	for key := range fields {
		if !valid[key] {
			return fmt.Errorf("unknown field: %s", key)
		}
	}
	for _, key := range required {
		if len(fields[key]) == 0 || string(fields[key]) == "null" {
			return fmt.Errorf("missing field: %s", key)
		}
	}
	return nil
}
func checkJSON(raw []byte) error {
	decoder := json.NewDecoder(bytes.NewReader(raw))
	var walk func() error
	walk = func() error {
		token, err := decoder.Token()
		if err != nil {
			return err
		}
		delim, ok := token.(json.Delim)
		if !ok {
			return nil
		}
		switch delim {
		case '{':
			seen := map[string]bool{}
			for decoder.More() {
				keyToken, err := decoder.Token()
				if err != nil {
					return err
				}
				key := keyToken.(string)
				if seen[key] {
					return fmt.Errorf("duplicate JSON field: %s", key)
				}
				seen[key] = true
				if err := walk(); err != nil {
					return err
				}
			}
		case '[':
			for decoder.More() {
				if err := walk(); err != nil {
					return err
				}
			}
		default:
			return errors.New("invalid JSON")
		}
		_, err = decoder.Token()
		return err
	}
	if err := walk(); err != nil {
		return err
	}
	if _, err := decoder.Token(); !errors.Is(err, io.EOF) {
		return errors.New("trailing JSON")
	}
	return nil
}
func sessionID() (string, error) {
	raw := make([]byte, 16)
	if _, err := rand.Read(raw); err != nil {
		return "", err
	}
	return "session-" + hex.EncodeToString(raw), nil
}
