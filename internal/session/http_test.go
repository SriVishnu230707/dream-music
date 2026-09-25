package session

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/SriVishnu230707/dream-music/internal/taste"
)

type memoryStore struct {
	records  map[string]Record
	events   map[string][]AuditEvent
	checkIns map[string][]AuditCheckIn
	results  map[string]EventResult
}

func (m *memoryStore) Create(_ context.Context, r Record) (Record, error) {
	if m.records == nil {
		m.records = map[string]Record{}
	}
	r.Status = "ready"
	r.Revision = 1
	r.CreatedAt = time.Now()
	r.UpdatedAt = r.CreatedAt
	r.ExpiresAt = r.CreatedAt.Add(30 * 24 * time.Hour)
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
func (m *memoryStore) ApplyEvent(_ context.Context, c taste.Catalog, input EventInput) (EventResult, error) {
	r, ok := m.records[input.SessionID]
	if !ok {
		return EventResult{}, ErrNotFound
	}
	key := input.SessionID + "/" + input.EventID
	if old, exists := m.results[key]; exists {
		for _, entry := range m.events[input.SessionID] {
			if entry.EventID == input.EventID {
				if !reflect.DeepEqual(entry.EventInput, input) {
					return EventResult{}, ErrConflict
				}
				return old, nil
			}
		}
	}
	history := []EventInput{}
	for _, item := range m.events[input.SessionID] {
		history = append(history, item.EventInput)
	}
	updated, result, err := applyEvent(c, r, history, input)
	if err != nil {
		if errors.Is(err, ErrConflict) {
			return EventResult{}, err
		}
		return EventResult{}, fmt.Errorf("%w: %v", ErrInvalid, err)
	}
	m.records[input.SessionID] = updated
	if m.events == nil {
		m.events = map[string][]AuditEvent{}
	}
	if m.results == nil {
		m.results = map[string]EventResult{}
	}
	m.events[input.SessionID] = append(m.events[input.SessionID], AuditEvent{EventInput: input, AcceptedAt: time.Now()})
	m.results[key] = result
	return result, nil
}
func (m *memoryStore) ListEvents(_ context.Context, id string) ([]AuditEvent, error) {
	if _, ok := m.records[id]; !ok {
		return nil, ErrNotFound
	}
	return m.events[id], nil
}
func (m *memoryStore) AddCheckIn(_ context.Context, c taste.Catalog, id string, input CheckInInput) (Record, error) {
	r, ok := m.records[id]
	if !ok {
		return Record{}, ErrNotFound
	}
	history := []EventInput{}
	for _, item := range m.events[id] {
		history = append(history, item.EventInput)
	}
	updated, err := applyCheckIn(c, r, history, input)
	if err != nil {
		return Record{}, err
	}
	m.records[id] = updated
	if m.checkIns == nil {
		m.checkIns = map[string][]AuditCheckIn{}
	}
	m.checkIns[id] = append(m.checkIns[id], AuditCheckIn{ID: "checkin-test", Mood: *updated.LastCheckIn, CreatedAt: time.Now()})
	return updated, nil
}
func (m *memoryStore) ListCheckIns(_ context.Context, id string) ([]AuditCheckIn, error) {
	if _, ok := m.records[id]; !ok {
		return nil, ErrNotFound
	}
	if m.checkIns[id] == nil {
		return []AuditCheckIn{}, nil
	}
	return m.checkIns[id], nil
}
func (m *memoryStore) ClearCheckIns(_ context.Context, c taste.Catalog, id string, revision int) (Record, error) {
	r, ok := m.records[id]
	if !ok {
		return Record{}, ErrNotFound
	}
	history := []EventInput{}
	for _, item := range m.events[id] {
		history = append(history, item.EventInput)
	}
	updated, err := clearCheckIns(c, r, history, revision)
	if err != nil {
		return Record{}, err
	}
	m.records[id] = updated
	delete(m.checkIns, id)
	return updated, nil
}
func (m *memoryStore) DeleteSession(_ context.Context, id string) error {
	if _, ok := m.records[id]; !ok {
		return ErrNotFound
	}
	delete(m.records, id)
	delete(m.events, id)
	delete(m.checkIns, id)
	return nil
}

func TestSessionFlow(t *testing.T) {
	catalog, err := taste.LoadCatalog("../..")
	if err != nil {
		t.Fatal(err)
	}
	store := &memoryStore{}
	h := Server{Catalog: catalog, Store: store}.Handler()
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
	h := Server{Catalog: catalog, Store: &memoryStore{}}.Handler()
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
		{"GET", "/api/v1/sessions/" + strings.Repeat("a", 400), "", "127.0.0.1:8083", "", 404},
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

func TestMoodProxyRejectsRedirectAndRemoteURL(t *testing.T) {
	for _, raw := range []string{"https://127.0.0.1:8000", "http://example.com:8000", "http://127.0.0.1:8000/extra", "http://127.0.0.1:0"} {
		if ValidateMoodURL(raw) == nil {
			t.Fatalf("unsafe URL accepted: %s", raw)
		}
	}
	redirected := false
	other := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { redirected = true }))
	defer other.Close()
	mood := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, other.URL, http.StatusTemporaryRedirect)
	}))
	defer mood.Close()
	catalog, err := taste.LoadCatalog("../..")
	if err != nil {
		t.Fatal(err)
	}
	h := Server{Catalog: catalog, Store: &memoryStore{}, MoodURL: mood.URL}.Handler()
	r := httptest.NewRequest("POST", "/api/v1/mood/predict", strings.NewReader(`{"text":"private check-in"}`))
	r.Host = "127.0.0.1:8083"
	r.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	if w.Code != 503 || redirected {
		t.Fatalf("redirect followed: status %d, redirected %v", w.Code, redirected)
	}
}

func TestPhase6EventAndPrivacyEndpoints(t *testing.T) {
	catalog, err := taste.LoadCatalog("../..")
	if err != nil {
		t.Fatal(err)
	}
	store := &memoryStore{}
	h := Server{Catalog: catalog, Store: store}.Handler()
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
	request := `{"userId":"listener","startMood":{"valence":0.2,"arousal":0.2,"source":"manual"},"targetMood":{"valence":0.8,"arousal":0.8},"trackCount":4,"retentionDays":7,"taste":{"preferredGenres":[],"likedTrackIds":[]}}`
	created := call("POST", "/api/v1/sessions", request)
	if created.Code != 201 {
		t.Fatalf("create: %d %s", created.Code, created.Body.String())
	}
	var record Record
	_ = json.Unmarshal(created.Body.Bytes(), &record)
	if record.RetentionDays != 7 {
		t.Fatal("retention was lost")
	}
	path := "/api/v1/sessions/" + record.ID
	event := fmt.Sprintf(`{"eventId":"start-1","sessionId":%q,"trackId":%q,"type":"start","occurredAt":%q,"expectedRevision":1}`, record.ID, record.Queue[0].TrackID, time.Now().UTC().Format(time.RFC3339Nano))
	first := call("POST", path+"/events", event)
	if first.Code != 200 {
		t.Fatalf("event: %d %s", first.Code, first.Body.String())
	}
	duplicate := call("POST", path+"/events", event)
	if duplicate.Code != 200 || duplicate.Body.String() != first.Body.String() {
		t.Fatal("idempotent retry changed result")
	}
	conflicting := strings.Replace(event, `"type":"start"`, `"type":"like"`, 1)
	if got := call("POST", path+"/events", conflicting); got.Code != 409 {
		t.Fatalf("conflicting event: %d", got.Code)
	}
	if got := call("GET", path+"/events", ""); got.Code != 200 || !strings.Contains(got.Body.String(), "start-1") {
		t.Fatal("audit event missing")
	}
	checkIn := call("POST", path+"/check-ins", `{"expectedRevision":2,"valence":0.1,"arousal":0.9,"source":"manual"}`)
	if checkIn.Code != 200 {
		t.Fatalf("check-in: %d %s", checkIn.Code, checkIn.Body.String())
	}
	var updated Record
	_ = json.Unmarshal(checkIn.Body.Bytes(), &updated)
	if updated.LastCheckIn == nil || updated.Queue[0].TrackID != record.Queue[0].TrackID {
		t.Fatal("check-in not applied safely")
	}
	if got := call("GET", path+"/check-ins", ""); got.Code != 200 || !strings.Contains(got.Body.String(), "checkin-test") {
		t.Fatal("check-in audit missing")
	}
	cleared := call("DELETE", path+"/check-ins", `{"expectedRevision":3}`)
	if cleared.Code != 200 || strings.Contains(cleared.Body.String(), `"lastCheckIn"`) {
		t.Fatalf("check-in not cleared: %d", cleared.Code)
	}
	if got := call("GET", path+"/check-ins", ""); got.Code != 200 || !strings.Contains(got.Body.String(), `"checkIns":[]`) {
		t.Fatal("check-in audit not deleted")
	}
	if got := call("DELETE", path, ""); got.Code != 204 {
		t.Fatalf("delete: %d", got.Code)
	}
	if got := call("GET", path, ""); got.Code != 404 {
		t.Fatal("deleted session still available")
	}
}
