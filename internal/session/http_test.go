package session

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http/httptest"
	"testing"

	"github.com/SriVishnu230707/dream-music/internal/taste"
)

type memoryStore struct{ records map[string]Record }

func (m *memoryStore) Create(_ context.Context, r Record) (Record, error) {
	if m.records == nil {
		m.records = map[string]Record{}
	}
	r.Status = "ready"
	r.Revision = 1
	m.records[r.ID] = r
	return r, nil
}
func (m *memoryStore) Get(_ context.Context, id string) (Record, error) {
	r, ok := m.records[id]
	if !ok {
		return Record{}, ErrNotFound
	}
	return r, nil
}
func (m *memoryStore) Advance(_ context.Context, id string, revision int, action string) (Record, error) {
	r, ok := m.records[id]
	if !ok {
		return Record{}, ErrNotFound
	}
	if r.Revision != revision || r.Status == "completed" {
		return Record{}, ErrConflict
	}
	r.CurrentIndex++
	r.Revision++
	if r.CurrentIndex == len(r.Queue) {
		r.Status = "completed"
	} else {
		r.Status = "active"
	}
	m.records[id] = r
	return r, nil
}

func TestSessionFlow(t *testing.T) {
	catalog, err := taste.LoadCatalog("../..")
	if err != nil {
		t.Fatal(err)
	}
	store := &memoryStore{}
	h := Server{Catalog: catalog, Store: store, Root: "../.."}.Handler()
	call := func(method, path, body string) *httptest.ResponseRecorder {
		r := httptest.NewRequest(method, path, bytes.NewBufferString(body))
		r.Host = "127.0.0.1:8083"
		if body != "" {
			r.Header.Set("Content-Type", "application/json")
		}
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		return w
	}
	request := `{"userId":"listener","startMood":{"valence":0.2,"arousal":0.2,"source":"manual"},"targetMood":{"valence":0.8,"arousal":0.8},"trackCount":2,"taste":{"preferredGenres":[],"likedTrackIds":[]}}`
	created := call("POST", "/api/v1/sessions", request)
	if created.Code != 201 {
		t.Fatalf("create: %d %s", created.Code, created.Body.String())
	}
	var first Record
	if err := json.Unmarshal(created.Body.Bytes(), &first); err != nil {
		t.Fatal(err)
	}
	if first.ID == "" || len(first.Queue) != 2 || first.Revision != 1 {
		t.Fatalf("bad session: %+v", first)
	}
	if got := call("GET", "/api/v1/sessions/"+first.ID, ""); got.Code != 200 {
		t.Fatalf("get: %d", got.Code)
	}
	next := call("POST", "/api/v1/sessions/"+first.ID+"/advance", `{"expectedRevision":1,"action":"skip"}`)
	if next.Code != 200 {
		t.Fatalf("advance: %d %s", next.Code, next.Body.String())
	}
	if got := call("POST", "/api/v1/sessions/"+first.ID+"/advance", `{"expectedRevision":1,"action":"skip"}`); got.Code != 409 {
		t.Fatalf("stale revision: %d", got.Code)
	}
	done := call("POST", "/api/v1/sessions/"+first.ID+"/advance", `{"expectedRevision":2,"action":"complete"}`)
	if done.Code != 200 {
		t.Fatalf("complete: %d", done.Code)
	}
	var last Record
	_ = json.Unmarshal(done.Body.Bytes(), &last)
	if last.Status != "completed" || last.CurrentIndex != 2 {
		t.Fatalf("status: %+v", last)
	}
	audio := call("GET", "/audio/"+first.Queue[0].TrackID, "")
	if audio.Code != 200 || audio.Body.Len() < 44 {
		t.Fatalf("audio: %d", audio.Code)
	}
}

func TestRejectedRequests(t *testing.T) {
	catalog, err := taste.LoadCatalog("../..")
	if err != nil {
		t.Fatal(err)
	}
	h := Server{Catalog: catalog, Store: &memoryStore{}, Root: "../.."}.Handler()
	request := `{"userId":"u","startMood":{"valence":0.2,"arousal":0.2,"source":"manual"},"targetMood":{"valence":0.8,"arousal":0.8},"trackCount":1,"taste":{"preferredGenres":[],"likedTrackIds":[]}}`
	cases := []struct {
		method, path, body, host, origin string
		status                           int
	}{
		{"POST", "/api/v1/sessions", request, "evil.test:8083", "", 403},
		{"POST", "/api/v1/sessions", request, "127.0.0.1:8083", "http://evil.test", 403},
		{"POST", "/api/v1/sessions", `{"userId":"a","userId":"b"}`, "127.0.0.1:8083", "", 400},
		{"POST", "/api/v1/sessions", `{"userId":"u","UserId":"overridden"}`, "127.0.0.1:8083", "", 400},
		{"GET", "/audio/unknown", "", "127.0.0.1:8083", "", 404},
		{"GET", "/api/v1/sessions/missing", "", "127.0.0.1:8083", "", 404},
	}
	for _, tc := range cases {
		r := httptest.NewRequest(tc.method, tc.path, bytes.NewBufferString(tc.body))
		r.Host = tc.host
		if tc.body != "" {
			r.Header.Set("Content-Type", "application/json")
		}
		if tc.origin != "" {
			r.Header.Set("Origin", tc.origin)
		}
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		if w.Code != tc.status {
			t.Fatalf("%s: %d want %d", tc.path, w.Code, tc.status)
		}
	}
}
func TestStoreSentinels(t *testing.T) {
	if !errors.Is(ErrConflict, ErrConflict) || !errors.Is(ErrNotFound, ErrNotFound) {
		t.Fatal("sentinels")
	}
}
