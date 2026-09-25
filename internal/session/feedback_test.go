package session

import (
	"errors"
	"math"
	"testing"
	"time"

	"github.com/SriVishnu230707/dream-music/internal/sequence"
	"github.com/SriVishnu230707/dream-music/internal/taste"
)

func feedbackFixture(t *testing.T) (taste.Catalog, Record) {
	t.Helper()
	c, err := taste.LoadCatalog("../..")
	if err != nil {
		t.Fatal(err)
	}
	target := sequence.Mood{Valence: .85, Arousal: .8}
	preferences := sequence.TasteInput{PreferredGenres: []string{}, LikedTrackIDs: []string{}}
	plan, err := sequence.Build(c, sequence.Request{UserID: "listener", StartMood: sequence.StartMood{Mood: sequence.Mood{Valence: .2, Arousal: .2}, Source: "manual"}, TargetMood: target, TrackCount: 5, Taste: preferences})
	if err != nil {
		t.Fatal(err)
	}
	return c, Record{ID: "session-0123456789abcdef0123456789abcdef", UserID: "listener", CatalogID: c.ID, Queue: plan.Queue, Revision: 1, Status: "ready", TargetMood: &target, Taste: preferences, CreatedAt: time.Now().Add(-time.Minute)}
}

func TestFeedbackLocksPlayedAndCurrentTracks(t *testing.T) {
	c, r := feedbackFixture(t)
	original := append([]sequence.QueueItem(nil), r.Queue...)
	seconds := 1.0
	input := EventInput{EventID: "skip-1", SessionID: r.ID, TrackID: r.Queue[0].TrackID, Type: "skip", OccurredAt: time.Now(), ListenedSeconds: &seconds, ExpectedRevision: 1}
	updated, result, err := applyEvent(c, r, nil, input)
	if err != nil {
		t.Fatal(err)
	}
	if updated.CurrentIndex != 1 || updated.Revision != 2 || updated.Queue[0] != original[0] || updated.Queue[1] != original[1] {
		t.Fatal("played or current track moved")
	}
	if !result.FutureReplanned || !result.Accepted {
		t.Fatal("future was not replanned")
	}
	seen := map[string]bool{}
	for i, item := range updated.Queue {
		if seen[item.TrackID] || item.Position != i {
			t.Fatalf("duplicate or wrong position: %+v", item)
		}
		seen[item.TrackID] = true
	}
	if _, _, err := applyEvent(c, updated, nil, input); !errors.Is(err, ErrConflict) {
		t.Fatalf("stale revision: %v", err)
	}
}

func TestExplicitCheckInOnlyChangesFuture(t *testing.T) {
	c, r := feedbackFixture(t)
	first := r.Queue[0]
	updated, err := applyCheckIn(c, r, nil, CheckInInput{ExpectedRevision: 1, Valence: .1, Arousal: .9, Source: "manual"})
	if err != nil {
		t.Fatal(err)
	}
	if updated.Queue[0] != first || updated.Revision != 2 || updated.LastCheckIn == nil {
		t.Fatal("check-in moved current track or was lost")
	}
	if math.Abs(updated.Queue[1].PathPoint.Valence-.1) > .0001 {
		t.Fatalf("future path did not start at check-in: %+v", updated.Queue[1].PathPoint)
	}
	cleared, err := clearCheckIns(c, updated, nil, 2)
	if err != nil {
		t.Fatal(err)
	}
	if cleared.LastCheckIn != nil || cleared.Queue[0] != first || cleared.Revision != 3 {
		t.Fatal("check-in deletion did not preserve current track")
	}
}

func TestFeedbackRejectsIneligibleAndInvalidValues(t *testing.T) {
	c, r := feedbackFixture(t)
	base := EventInput{EventID: "x", SessionID: r.ID, TrackID: r.Queue[1].TrackID, Type: "skip", OccurredAt: time.Now(), ExpectedRevision: 1}
	if _, _, err := applyEvent(c, r, nil, base); err == nil {
		t.Fatal("future track skipped")
	}
	base.Type = "like"
	if _, _, err := applyEvent(c, r, nil, base); err == nil {
		t.Fatal("future track liked")
	}
	base.TrackID = r.Queue[0].TrackID
	base.ListenedSeconds = new(float64)
	*base.ListenedSeconds = math.NaN()
	if _, _, err := applyEvent(c, r, nil, base); err == nil {
		t.Fatal("NaN duration accepted")
	}
	if _, err := applyCheckIn(c, r, nil, CheckInInput{ExpectedRevision: 1, Valence: 2, Arousal: .5, Source: "manual"}); err == nil {
		t.Fatal("invalid check-in accepted")
	}
}
