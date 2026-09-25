package session

import (
	"errors"
	"fmt"
	"math"
	"reflect"
	"strings"
	"time"

	"github.com/SriVishnu230707/dream-music/internal/sequence"
	"github.com/SriVishnu230707/dream-music/internal/taste"
)

type EventInput struct {
	EventID          string    `json:"eventId"`
	SessionID        string    `json:"sessionId"`
	TrackID          string    `json:"trackId"`
	Type             string    `json:"type"`
	OccurredAt       time.Time `json:"occurredAt"`
	ListenedSeconds  *float64  `json:"listenedSeconds,omitempty"`
	ExpectedRevision int       `json:"expectedRevision"`
}
type EventResult struct {
	Accepted        bool   `json:"accepted"`
	SessionID       string `json:"sessionId"`
	Revision        int    `json:"revision"`
	QueueChanged    bool   `json:"queueChanged"`
	FutureReplanned bool   `json:"futureReplanned"`
	Session         Record `json:"session"`
}
type AuditEvent struct {
	EventInput
	AcceptedAt time.Time `json:"acceptedAt"`
}
type CheckInInput struct {
	ExpectedRevision int     `json:"expectedRevision"`
	Valence          float64 `json:"valence"`
	Arousal          float64 `json:"arousal"`
	Source           string  `json:"source"`
}
type AuditCheckIn struct {
	ID        string             `json:"id"`
	Mood      sequence.StartMood `json:"mood"`
	CreatedAt time.Time          `json:"createdAt"`
}

func validateEvent(c taste.Catalog, r Record, input EventInput) error {
	if input.SessionID != r.ID || input.ExpectedRevision < 1 {
		return errors.New("invalid session or revision")
	}
	if strings.TrimSpace(input.EventID) == "" || len(input.EventID) > 128 {
		return errors.New("invalid eventId")
	}
	if input.OccurredAt.IsZero() || input.OccurredAt.After(time.Now().Add(5*time.Minute)) {
		return errors.New("invalid occurredAt")
	}
	if !r.CreatedAt.IsZero() && input.OccurredAt.Before(r.CreatedAt.Add(-5*time.Minute)) {
		return errors.New("event predates session")
	}
	if input.Type != "start" && input.Type != "skip" && input.Type != "complete" && input.Type != "replay" && input.Type != "like" {
		return errors.New("invalid event type")
	}
	if input.ListenedSeconds != nil && (math.IsNaN(*input.ListenedSeconds) || math.IsInf(*input.ListenedSeconds, 0) || *input.ListenedSeconds < 0) {
		return errors.New("invalid listenedSeconds")
	}
	index := -1
	for i, item := range r.Queue {
		if item.TrackID == input.TrackID {
			index = i
			break
		}
	}
	if index < 0 {
		return errors.New("track is not in this session")
	}
	track, ok := c.Track(input.TrackID)
	if !ok {
		return errors.New("unknown track")
	}
	if input.ListenedSeconds != nil && *input.ListenedSeconds > float64(track.Audio.DurationSeconds)+2 {
		return errors.New("listenedSeconds exceeds track duration")
	}
	if input.Type == "like" {
		if r.Status != "completed" && index > r.CurrentIndex {
			return errors.New("cannot like an unplayed track")
		}
	} else if r.Status == "completed" || index != r.CurrentIndex {
		return errors.New("event is not for the current track")
	}
	return nil
}

// applyEvent changes the queue in memory; callers persist it and the event atomically.
func applyEvent(c taste.Catalog, r Record, history []EventInput, input EventInput) (Record, EventResult, error) {
	if input.ExpectedRevision != r.Revision {
		return Record{}, EventResult{}, ErrConflict
	}
	if err := validateEvent(c, r, input); err != nil {
		return Record{}, EventResult{}, err
	}
	if input.Type == "skip" || input.Type == "complete" {
		r.CurrentIndex++
		action := input.Type
		r.LastAction = &action
		if r.CurrentIndex >= len(r.Queue) {
			r.Status = "completed"
		} else {
			r.Status = "active"
		}
	}
	if input.Type == "start" && r.Status == "ready" {
		r.Status = "active"
	}
	r.Revision++
	replanned, changed := false, false
	if input.Type != "start" && r.Status != "completed" {
		var err error
		r, replanned, changed, err = replan(c, r, append(history, input))
		if err != nil {
			return Record{}, EventResult{}, err
		}
	}
	result := EventResult{Accepted: true, SessionID: r.ID, Revision: r.Revision, QueueChanged: changed, FutureReplanned: replanned, Session: r}
	return r, result, nil
}

func validateCheckIn(input CheckInInput) error {
	if input.ExpectedRevision < 1 || !unit(input.Valence) || !unit(input.Arousal) {
		return errors.New("invalid check-in coordinates or revision")
	}
	if input.Source != "manual" && input.Source != "user-corrected" && input.Source != "text-model" {
		return errors.New("invalid check-in source")
	}
	return nil
}
func applyCheckIn(c taste.Catalog, r Record, history []EventInput, input CheckInInput) (Record, error) {
	if err := validateCheckIn(input); err != nil {
		return Record{}, err
	}
	if r.Revision != input.ExpectedRevision {
		return Record{}, ErrConflict
	}
	if r.Status == "completed" {
		return Record{}, errors.New("session is complete")
	}
	mood := sequence.StartMood{Mood: sequence.Mood{Valence: input.Valence, Arousal: input.Arousal}, Source: input.Source}
	r.LastCheckIn = &mood
	r.Revision++
	var err error
	r, _, _, err = replan(c, r, history)
	return r, err
}
func clearCheckIns(c taste.Catalog, r Record, history []EventInput, revision int) (Record, error) {
	if revision != r.Revision {
		return Record{}, ErrConflict
	}
	r.LastCheckIn = nil
	r.Revision++
	if r.Status != "completed" {
		var err error
		r, _, _, err = replan(c, r, history)
		if err != nil {
			return Record{}, err
		}
	}
	return r, nil
}

func replan(c taste.Catalog, r Record, history []EventInput) (Record, bool, bool, error) {
	locked := r.CurrentIndex + 1
	if locked >= len(r.Queue) || locked < 1 {
		return r, false, false, nil
	}
	start := r.Queue[locked-1].TrackMood
	if r.LastCheckIn != nil {
		start = r.LastCheckIn.Mood
	}
	target := r.Queue[len(r.Queue)-1].PathPoint
	if r.TargetMood != nil {
		target = *r.TargetMood
	}
	remaining := len(r.Queue) - locked
	if remaining == 1 {
		start = target
	}
	excluded := make([]string, locked)
	for i := 0; i < locked; i++ {
		excluded[i] = r.Queue[i].TrackID
	}
	if len(history) > 200 {
		history = history[len(history)-200:]
	}
	events := make([]taste.Event, 0, len(history))
	for _, item := range history {
		events = append(events, taste.Event{EventID: item.EventID, TrackID: item.TrackID, Type: item.Type, ListenedSeconds: item.ListenedSeconds})
	}
	plan, err := sequence.Build(c, sequence.Request{UserID: r.UserID, StartMood: sequence.StartMood{Mood: start, Source: "manual"}, TargetMood: target, TrackCount: remaining, Taste: r.Taste, ExcludeTrackIDs: excluded, FeedbackEvents: events})
	if err != nil {
		return Record{}, false, false, fmt.Errorf("replan remaining queue: %w", err)
	}
	selected := make([]taste.Candidate, len(plan.Queue))
	for i, item := range plan.Queue {
		selected[i] = taste.Candidate{TrackID: item.TrackID}
	}
	if err := c.ValidateCandidates(selected); err != nil {
		return Record{}, false, false, fmt.Errorf("replan audio: %w", err)
	}
	old := append([]sequence.QueueItem(nil), r.Queue[locked:]...)
	for i := range plan.Queue {
		plan.Queue[i].Position = locked + i
		plan.Queue[i].Reason = "Adjusted using session feedback and the mood path"
	}
	r.Queue = append(append([]sequence.QueueItem(nil), r.Queue[:locked]...), plan.Queue...)
	changed := false
	for i := range old {
		if old[i].TrackID != plan.Queue[i].TrackID {
			changed = true
			break
		}
	}
	if !changed && reflect.DeepEqual(old, plan.Queue) {
		return r, true, false, nil
	}
	return r, true, changed, nil
}
func unit(v float64) bool { return !math.IsNaN(v) && !math.IsInf(v, 0) && v >= 0 && v <= 1 }
