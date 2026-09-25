package main

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"log"
	"mime"
	"net"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"

	"github.com/SriVishnu230707/dream-music/internal/sequence"
	"github.com/SriVishnu230707/dream-music/internal/taste"
)

func handler(catalog taste.Catalog) http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /health", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusOK, map[string]any{"status": "ok", "catalogId": catalog.ID, "tracks": catalog.Count()})
	})
	mux.HandleFunc("POST /v1/sessions", func(w http.ResponseWriter, r *http.Request) {
		mediaType, _, err := mime.ParseMediaType(r.Header.Get("Content-Type"))
		if err != nil || mediaType != "application/json" {
			writeError(w, http.StatusUnsupportedMediaType, "Content-Type must be application/json")
			return
		}
		r.Body = http.MaxBytesReader(w, r.Body, 64*1024)
		decoder := json.NewDecoder(r.Body)
		decoder.DisallowUnknownFields()
		var raw json.RawMessage
		if err := decoder.Decode(&raw); err != nil {
			writeError(w, http.StatusBadRequest, "invalid session request")
			return
		}
		if err := decoder.Decode(new(any)); !errors.Is(err, io.EOF) {
			writeError(w, http.StatusBadRequest, "trailing JSON or oversized request")
			return
		}
		if err := rejectDuplicateKeys(raw); err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		if err := requiredFields(raw); err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		var request sequence.Request
		strict := json.NewDecoder(strings.NewReader(string(raw)))
		strict.DisallowUnknownFields()
		if err := strict.Decode(&request); err != nil {
			writeError(w, http.StatusBadRequest, "invalid session fields")
			return
		}
		plan, err := sequence.Build(catalog, request)
		if err != nil {
			var insufficient sequence.InsufficientError
			if errors.As(err, &insufficient) {
				writeJSON(w, http.StatusUnprocessableEntity, map[string]any{"error": insufficient.Error(), "available": insufficient.Available})
			} else {
				writeError(w, http.StatusBadRequest, err.Error())
			}
			return
		}
		candidates := make([]taste.Candidate, len(plan.Queue))
		for i, item := range plan.Queue {
			candidates[i] = taste.Candidate{TrackID: item.TrackID}
		}
		if err := catalog.ValidateCandidates(candidates); err != nil {
			writeError(w, http.StatusServiceUnavailable, "queue audio unavailable")
			return
		}
		id, err := newSessionID()
		if err != nil {
			writeError(w, http.StatusInternalServerError, "session ID unavailable")
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{
			"sessionId": id, "status": "ready", "revision": 1,
			"catalogId": plan.CatalogID, "featureVersion": plan.FeatureVersion,
			"scoringVersion": plan.ScoringVersion, "available": plan.Available,
			"unsupportedGenres": plan.UnsupportedGenres, "queue": plan.Queue, "quality": plan.Quality,
		})
	})
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		host, _, err := net.SplitHostPort(r.Host)
		if err != nil || (host != "127.0.0.1" && host != "::1") {
			writeError(w, http.StatusForbidden, "local host required")
			return
		}
		if origin := r.Header.Get("Origin"); origin != "" {
			parsed, err := url.Parse(origin)
			if err != nil || parsed.Scheme != "http" || parsed.Host != r.Host || parsed.User != nil || parsed.Path != "" || parsed.RawQuery != "" || parsed.Fragment != "" {
				writeError(w, http.StatusForbidden, "cross-origin request rejected")
				return
			}
		}
		mux.ServeHTTP(w, r)
	})
}

func requiredFields(raw json.RawMessage) error {
	var root map[string]json.RawMessage
	if err := json.Unmarshal(raw, &root); err != nil || root == nil {
		return errors.New("session request must be an object")
	}
	if err := exactKeys(root, "session request", "userId", "checkInText", "startMood", "targetMood", "trackCount", "taste"); err != nil {
		return err
	}
	for _, key := range []string{"userId", "startMood", "targetMood", "trackCount", "taste"} {
		if missing(root[key]) {
			return fmt.Errorf("missing required field: %s", key)
		}
	}
	for _, entry := range []struct {
		name string
		keys []string
	}{
		{"startMood", []string{"valence", "arousal", "source"}},
		{"targetMood", []string{"valence", "arousal"}},
		{"taste", []string{"preferredGenres", "likedTrackIds"}},
	} {
		var nested map[string]json.RawMessage
		if err := json.Unmarshal(root[entry.name], &nested); err != nil || nested == nil {
			return fmt.Errorf("%s must be an object", entry.name)
		}
		allowed := entry.keys
		if entry.name == "startMood" {
			allowed = append(append([]string(nil), allowed...), "confidence")
		}
		if err := exactKeys(nested, entry.name, allowed...); err != nil {
			return err
		}
		for _, key := range entry.keys {
			if missing(nested[key]) {
				return fmt.Errorf("missing required field: %s.%s", entry.name, key)
			}
		}
	}
	for _, key := range []string{"preferredGenres", "likedTrackIds"} {
		var fields map[string]json.RawMessage
		_ = json.Unmarshal(root["taste"], &fields)
		var values []json.RawMessage
		if string(fields[key]) == "null" || json.Unmarshal(fields[key], &values) != nil {
			return fmt.Errorf("taste.%s must be an array", key)
		}
	}
	return nil
}

func exactKeys(fields map[string]json.RawMessage, location string, allowed ...string) error {
	set := make(map[string]bool, len(allowed))
	for _, key := range allowed {
		set[key] = true
	}
	for key := range fields {
		if !set[key] {
			return fmt.Errorf("unknown field: %s.%s", location, key)
		}
	}
	return nil
}

// encoding/json otherwise accepts duplicate and case-folded keys, allowing one
// logical field to override another after validation.
func rejectDuplicateKeys(raw []byte) error {
	decoder := json.NewDecoder(strings.NewReader(string(raw)))
	var walk func() error
	walk = func() error {
		token, err := decoder.Token()
		if err != nil {
			return err
		}
		delimiter, ok := token.(json.Delim)
		if !ok {
			return nil
		}
		switch delimiter {
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
	return walk()
}

func missing(raw json.RawMessage) bool { return len(raw) == 0 || string(raw) == "null" }

func newSessionID() (string, error) {
	bytes := make([]byte, 16)
	if _, err := rand.Read(bytes); err != nil {
		return "", err
	}
	bytes[6] = (bytes[6] & 0x0f) | 0x40
	bytes[8] = (bytes[8] & 0x3f) | 0x80
	return "session-" + hex.EncodeToString(bytes), nil
}

func writeError(w http.ResponseWriter, status int, message string) {
	writeJSON(w, status, map[string]string{"error": message})
}
func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}

func main() {
	root := flag.String("root", ".", "repository root")
	listen := flag.String("listen", "127.0.0.1:8082", "local listen address")
	flag.Parse()
	if !strings.HasPrefix(*listen, "127.0.0.1:") && !strings.HasPrefix(*listen, "[::1]:") {
		fmt.Fprintln(os.Stderr, "Phase 4 API must bind to loopback until authentication exists")
		os.Exit(2)
	}
	catalog, err := taste.LoadCatalog(*root)
	if err != nil {
		log.Fatal(err)
	}
	server := &http.Server{Addr: *listen, Handler: handler(catalog), ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout: 10 * time.Second, WriteTimeout: 10 * time.Second, IdleTimeout: 30 * time.Second}
	log.Printf("sequence API listening on %s with %d playable tracks", *listen, catalog.Count())
	log.Fatal(server.ListenAndServe())
}
