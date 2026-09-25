package sequence

import (
	"errors"
	"math"
	"testing"

	"github.com/SriVishnu230707/dream-music/internal/taste"
)

func testRequest() Request {
	return Request{UserID: "test-user", StartMood: StartMood{Mood: Mood{0.1, 0.2}, Source: "manual"}, TargetMood: Mood{0.9, 0.8}, TrackCount: 5, Taste: TasteInput{PreferredGenres: []string{}, LikedTrackIDs: []string{}}}
}

func TestPathEndpoints(t *testing.T) {
	start, target := Mood{0.1, 0.2}, Mood{0.9, 0.8}
	if got := PathPoint(start, target, 0, 5); got != start {
		t.Fatalf("start=%v", got)
	}
	if got := PathPoint(start, target, 4, 5); math.Abs(got.Valence-target.Valence) > 1e-12 || math.Abs(got.Arousal-target.Arousal) > 1e-12 {
		t.Fatalf("target=%v", got)
	}
	if got := PathPoint(start, target, 0, 1); got != start {
		t.Fatalf("single=%v", got)
	}
}

func TestBuildDistinctDeterministicPlayable(t *testing.T) {
	c, err := taste.LoadCatalog("../..")
	if err != nil {
		t.Fatal(err)
	}
	req := testRequest()
	first, err := Build(c, req)
	if err != nil {
		t.Fatal(err)
	}
	second, err := Build(c, req)
	if err != nil {
		t.Fatal(err)
	}
	if len(first.Queue) != req.TrackCount {
		t.Fatalf("queue length=%d", len(first.Queue))
	}
	seen := map[string]bool{}
	candidates := make([]taste.Candidate, 0, len(first.Queue))
	for i, item := range first.Queue {
		if seen[item.TrackID] {
			t.Fatalf("duplicate %s", item.TrackID)
		}
		seen[item.TrackID] = true
		if item.TrackID != second.Queue[i].TrackID {
			t.Fatal("nondeterministic queue")
		}
		candidates = append(candidates, taste.Candidate{TrackID: item.TrackID})
	}
	if err := c.ValidateCandidates(candidates); err != nil {
		t.Fatal(err)
	}
	if first.Queue[0].PathPoint.Valence != req.StartMood.Valence || first.Queue[len(first.Queue)-1].PathPoint.Valence != req.TargetMood.Valence {
		t.Fatal("path endpoints lost")
	}
}

func TestBuildErrors(t *testing.T) {
	c, err := taste.LoadCatalog("../..")
	if err != nil {
		t.Fatal(err)
	}
	req := testRequest()
	req.TrackCount = c.Count() + 1
	_, err = Build(c, req)
	var insufficient InsufficientError
	if !errors.As(err, &insufficient) || insufficient.Available != c.Count() {
		t.Fatalf("insufficient error: %v", err)
	}
	req = testRequest()
	req.TargetMood.Valence = math.NaN()
	if _, err = Build(c, req); err == nil {
		t.Fatal("NaN accepted")
	}
	req = testRequest()
	req.StartMood.Source = ""
	if _, err = Build(c, req); err == nil {
		t.Fatal("unconfirmed mood accepted")
	}
}
