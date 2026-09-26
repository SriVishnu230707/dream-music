package sequence

import (
	"fmt"

	"github.com/SriVishnu230707/dream-music/internal/taste"
)

// Baseline keeps Phase 3 ordering; Phase 4 scores it only for a fair comparison.
func Baseline(c taste.Catalog, req Request, strategy string) (Plan, error) {
	if err := validate(req); err != nil {
		return Plan{}, err
	}
	if strategy != "popularity" && strategy != "taste" {
		return Plan{}, fmt.Errorf("unsupported baseline: %s", strategy)
	}
	ranked, err := taste.Rank(c, taste.Request{UserID: req.UserID, Strategy: strategy,
		Limit: req.TrackCount, PreferredGenres: req.Taste.PreferredGenres, LikedTrackIDs: req.Taste.LikedTrackIDs,
		Events: req.FeedbackEvents, PopularityCounts: req.PopularityCounts})
	if err != nil {
		return Plan{}, err
	}
	if req.TrackCount > ranked.Available {
		return Plan{}, InsufficientError{Requested: req.TrackCount, Available: ranked.Available}
	}
	queue := make([]QueueItem, 0, req.TrackCount)
	for i, candidate := range ranked.Candidates {
		track, ok := c.Track(candidate.TrackID)
		if !ok {
			return Plan{}, fmt.Errorf("candidate missing: %s", candidate.TrackID)
		}
		point := PathPoint(req.StartMood.Mood, req.TargetMood, i, req.TrackCount)
		moodGap := distance(point, trackMood(track))
		transition := 0.0
		if i > 0 {
			transition = distance(queue[i-1].TrackMood, trackMood(track))
		}
		queue = append(queue, QueueItem{Position: i, TrackID: track.ID, AudioPath: candidate.AudioPath,
			PathPoint: roundedMood(point), TrackMood: roundedMood(trackMood(track)),
			TasteScore: candidate.Scores.Taste, MoodDistance: round(moodGap),
			TransitionDistance: round(transition), Score: candidate.Scores.Total,
			Reason: "Phase 3 " + strategy + " ordering"})
	}
	return Plan{CatalogID: c.ID, FeatureVersion: taste.FeatureVersion, ScoringVersion: "baseline-" + strategy,
		Available: ranked.Available, UnsupportedGenres: ranked.UnsupportedGenres,
		Queue: queue, Quality: Measure(queue)}, nil
}
