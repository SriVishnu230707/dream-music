package session

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"reflect"
	"sync"
	"time"

	"github.com/SriVishnu230707/dream-music/internal/taste"
)

// MemoryStore provides a concurrent, in-memory implementation of Store.
type MemoryStore struct {
	mu       sync.RWMutex
	records  map[string]Record
	events   map[string][]AuditEvent
	checkIns map[string][]AuditCheckIn
	results  map[string]EventResult
}

func NewMemoryStore() *MemoryStore {
	return &MemoryStore{
		records:  make(map[string]Record),
		events:   make(map[string][]AuditEvent),
		checkIns: make(map[string][]AuditCheckIn),
		results:  make(map[string]EventResult),
	}
}

func (m *MemoryStore) Close() error {
	return nil
}

func (m *MemoryStore) PurgeExpired(_ context.Context) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	now := time.Now()
	for id, r := range m.records {
		if !r.ExpiresAt.IsZero() && r.ExpiresAt.Before(now) {
			delete(m.records, id)
			delete(m.events, id)
			delete(m.checkIns, id)
		}
	}
	return nil
}

func (m *MemoryStore) Create(_ context.Context, r Record) (Record, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.records == nil {
		m.records = map[string]Record{}
	}
	r.Status = "ready"
	r.Revision = 1
	r.CreatedAt = time.Now()
	r.UpdatedAt = r.CreatedAt
	days := r.RetentionDays
	if days != 1 && days != 7 && days != 30 {
		days = 30
	}
	r.RetentionDays = days
	r.ExpiresAt = r.CreatedAt.Add(time.Duration(days) * 24 * time.Hour)
	m.records[r.ID] = r
	return r, nil
}

func (m *MemoryStore) Get(_ context.Context, id string) (Record, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	r, ok := m.records[id]
	if !ok || (!r.ExpiresAt.IsZero() && r.ExpiresAt.Before(time.Now())) {
		return Record{}, ErrNotFound
	}
	return r, nil
}

func (m *MemoryStore) ApplyEvent(_ context.Context, c taste.Catalog, input EventInput) (EventResult, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	r, ok := m.records[input.SessionID]
	if !ok || (!r.ExpiresAt.IsZero() && r.ExpiresAt.Before(time.Now())) {
		return EventResult{}, ErrNotFound
	}
	key := input.SessionID + "/" + input.EventID
	if old, exists := m.results[key]; exists {
		for _, entry := range m.events[input.SessionID] {
			if entry.EventID == input.EventID {
				if !reflect.DeepEqual(entry.EventInput, input) {
					return EventResult{}, ErrConflict
				}
				old.Session = r
				old.Revision = r.Revision
				return old, nil
			}
		}
	}
	history := make([]EventInput, 0, len(m.events[input.SessionID]))
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

func (m *MemoryStore) ListEvents(_ context.Context, id string) ([]AuditEvent, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	if _, ok := m.records[id]; !ok {
		return nil, ErrNotFound
	}
	list := m.events[id]
	if list == nil {
		return []AuditEvent{}, nil
	}
	out := make([]AuditEvent, len(list))
	copy(out, list)
	return out, nil
}

func (m *MemoryStore) AddCheckIn(_ context.Context, c taste.Catalog, id string, input CheckInInput) (Record, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	r, ok := m.records[id]
	if !ok || (!r.ExpiresAt.IsZero() && r.ExpiresAt.Before(time.Now())) {
		return Record{}, ErrNotFound
	}
	history := make([]EventInput, 0, len(m.events[id]))
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
	checkInID := "checkin-" + randomHex(8)
	m.checkIns[id] = append(m.checkIns[id], AuditCheckIn{ID: checkInID, Mood: *updated.LastCheckIn, CreatedAt: time.Now()})
	return updated, nil
}

func (m *MemoryStore) ListCheckIns(_ context.Context, id string) ([]AuditCheckIn, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	if _, ok := m.records[id]; !ok {
		return nil, ErrNotFound
	}
	if m.checkIns[id] == nil {
		return []AuditCheckIn{}, nil
	}
	out := make([]AuditCheckIn, len(m.checkIns[id]))
	copy(out, m.checkIns[id])
	return out, nil
}

func (m *MemoryStore) ClearCheckIns(_ context.Context, c taste.Catalog, id string, revision int) (Record, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	r, ok := m.records[id]
	if !ok || (!r.ExpiresAt.IsZero() && r.ExpiresAt.Before(time.Now())) {
		return Record{}, ErrNotFound
	}
	history := make([]EventInput, 0, len(m.events[id]))
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

func (m *MemoryStore) DeleteSession(_ context.Context, id string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if _, ok := m.records[id]; !ok {
		return ErrNotFound
	}
	delete(m.records, id)
	delete(m.events, id)
	delete(m.checkIns, id)
	return nil
}

func randomHex(bytes int) string {
	b := make([]byte, bytes)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}
