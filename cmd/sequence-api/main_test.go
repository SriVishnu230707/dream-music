package main

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/SriVishnu230707/dream-music/internal/taste"
)

func TestSessionAPI(t *testing.T) {
	c, err := taste.LoadCatalog("../..")
	if err != nil {
		t.Fatal(err)
	}
	h := handler(c)
	valid := `{"userId":"api-user","checkInText":"private words","startMood":{"valence":0.2,"arousal":0.3,"source":"manual"},"targetMood":{"valence":0.8,"arousal":0.7},"trackCount":3,"taste":{"preferredGenres":[],"likedTrackIds":[]}}`
	call := func(body, contentType string) *httptest.ResponseRecorder {
		r := httptest.NewRequest(http.MethodPost, "/v1/sessions", bytes.NewBufferString(body))
		r.Host = "127.0.0.1:8082"
		r.Header.Set("Content-Type", contentType)
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		return w
	}
	w := call(valid, "application/json")
	if w.Code != 200 {
		t.Fatalf("valid: %d %s", w.Code, w.Body.String())
	}
	if bytes.Contains(w.Body.Bytes(), []byte("private words")) {
		t.Fatal("raw check-in leaked")
	}
	var response struct {
		SessionID string `json:"sessionId"`
		Queue     []any  `json:"queue"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &response); err != nil || response.SessionID == "" || len(response.Queue) != 3 {
		t.Fatalf("response: %v %s", err, w.Body.String())
	}
	if w2 := call(valid, "application/json"); w2.Code != 200 || bytes.Contains(w2.Body.Bytes(), []byte(response.SessionID)) {
		t.Fatal("session IDs not unique")
	}
	cases := []struct {
		body, contentType string
		status            int
	}{
		{`{}`, "application/json", 400},
		{valid + ` {}`, "application/json", 400},
		{`{"userId":"u","startMood":{"valence":2,"arousal":0.1,"source":"manual"},"targetMood":{"valence":0.5,"arousal":0.5},"trackCount":1,"taste":{"preferredGenres":[],"likedTrackIds":[]}}`, "application/json", 400},
		{`{"userId":"u","startMood":{"valence":0.2,"arousal":0.1,"source":"manual"},"targetMood":{"valence":0.5,"arousal":0.5},"trackCount":20,"taste":{"preferredGenres":[],"likedTrackIds":[]}}`, "application/json", 422},
		{valid, "text/plain", 415},
		{`{"userId":"first","userId":"second","startMood":{"valence":0.2,"arousal":0.1,"source":"manual"},"targetMood":{"valence":0.5,"arousal":0.5},"trackCount":1,"taste":{"preferredGenres":[],"likedTrackIds":[]}}`, "application/json", 400},
		{`{"userId":"u","startMood":{"valence":0.2,"Valence":0.9,"arousal":0.1,"source":"manual"},"targetMood":{"valence":0.5,"arousal":0.5},"trackCount":1,"taste":{"preferredGenres":[],"likedTrackIds":[]}}`, "application/json", 400},
		{`{"userId":"u","startMood":{"valence":0.2,"arousal":0.1,"source":"manual"},"targetMood":{"valence":0.5,"arousal":0.5},"trackCount":1,"taste":{"preferredGenres":null,"likedTrackIds":[]}}`, "application/json", 400},
	}
	for _, tc := range cases {
		w := call(tc.body, tc.contentType)
		if w.Code != tc.status {
			t.Fatalf("expected %d got %d: %s", tc.status, w.Code, w.Body.String())
		}
	}
	for _, tc := range []struct{ host, origin string }{
		{"attacker.example:8082", ""},
		{"127.0.0.1:8082", "http://attacker.example"},
	} {
		r := httptest.NewRequest(http.MethodPost, "/v1/sessions", bytes.NewBufferString(valid))
		r.Host = tc.host
		r.Header.Set("Content-Type", "application/json")
		if tc.origin != "" {
			r.Header.Set("Origin", tc.origin)
		}
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		if w.Code != http.StatusForbidden {
			t.Fatalf("host/origin accepted: %s %s", tc.host, tc.origin)
		}
	}
}
