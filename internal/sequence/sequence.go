package sequence

import (
	"errors"
	"fmt"
	"math"
	"sort"
	"strings"
	"unicode/utf8"

	"github.com/SriVishnu230707/dream-music/internal/taste"
)

const ScoringVersion = "drift-beam-v1"
const beamWidth = 128

type Mood struct {
	Valence float64 `json:"valence"`
	Arousal float64 `json:"arousal"`
}

type StartMood struct {
	Mood
	Source     string   `json:"source"`
	Confidence *float64 `json:"confidence,omitempty"`
}

type TasteInput struct {
	PreferredGenres []string `json:"preferredGenres"`
	LikedTrackIDs   []string `json:"likedTrackIds"`
}

type Request struct {
	UserID        string     `json:"userId"`
	CheckInText   *string    `json:"checkInText,omitempty"`
	StartMood     StartMood  `json:"startMood"`
	TargetMood    Mood       `json:"targetMood"`
	TrackCount    int        `json:"trackCount"`
	Taste         TasteInput `json:"taste"`
	RetentionDays int        `json:"retentionDays,omitempty"`
	// Internal session adaptation inputs. They are never accepted from session JSON.
	ExcludeTrackIDs []string      `json:"-"`
	FeedbackEvents  []taste.Event `json:"-"`
}

type QueueItem struct {
	Position           int     `json:"position"`
	TrackID            string  `json:"trackId"`
	AudioPath          string  `json:"audioPath"`
	PathPoint          Mood    `json:"pathPoint"`
	TrackMood          Mood    `json:"trackMood"`
	TasteScore         float64 `json:"tasteScore"`
	MoodDistance       float64 `json:"moodDistance"`
	TransitionDistance float64 `json:"transitionDistance"`
	DiversityPenalty   float64 `json:"diversityPenalty"`
	Score              float64 `json:"score"`
	Reason             string  `json:"reason"`
}

type Quality struct {
	MeanMoodDistance      float64 `json:"meanMoodDistance"`
	MaxMoodDistance       float64 `json:"maxMoodDistance"`
	MaxTransitionDistance float64 `json:"maxTransitionDistance"`
	MeanTasteScore        float64 `json:"meanTasteScore"`
	TargetGap             float64 `json:"targetGap"`
	CoverageLimited       bool    `json:"coverageLimited"`
}

type Plan struct {
	CatalogID         string      `json:"catalogId"`
	FeatureVersion    string      `json:"featureVersion"`
	ScoringVersion    string      `json:"scoringVersion"`
	Available         int         `json:"available"`
	UnsupportedGenres []string    `json:"unsupportedGenres"`
	Queue             []QueueItem `json:"queue"`
	Quality           Quality     `json:"quality"`
}

type InsufficientError struct {
	Requested int
	Available int
}

func (e InsufficientError) Error() string {
	return fmt.Sprintf("requested %d distinct tracks; only %d playable candidates available", e.Requested, e.Available)
}

type state struct {
	indices []int
	used    uint32
	total   float64
	key     string
}

func Build(c taste.Catalog, req Request) (Plan, error) {
	if err := validate(req); err != nil {
		return Plan{}, err
	}
	pool, err := taste.Rank(c, taste.Request{UserID: req.UserID, Strategy: "taste",
		Limit: min(20, c.Count()), PreferredGenres: req.Taste.PreferredGenres, LikedTrackIDs: req.Taste.LikedTrackIDs,
		ExcludeTrackIDs: req.ExcludeTrackIDs, Events: req.FeedbackEvents})
	if err != nil {
		return Plan{}, err
	}
	if req.TrackCount > len(pool.Candidates) {
		return Plan{}, InsufficientError{Requested: req.TrackCount, Available: len(pool.Candidates)}
	}
	if len(pool.Candidates) > 20 {
		return Plan{}, errors.New("candidate pool exceeds beam-search limit")
	}
	tracks := make([]taste.Track, len(pool.Candidates))
	for i, candidate := range pool.Candidates {
		track, ok := c.Track(candidate.TrackID)
		if !ok {
			return Plan{}, errors.New("candidate missing from catalog")
		}
		tracks[i] = track
	}
	start := req.StartMood.Mood
	points := make([]Mood, req.TrackCount)
	for i := range points {
		points[i] = PathPoint(start, req.TargetMood, i, req.TrackCount)
	}
	beam := []state{{indices: []int{}, used: 0, key: ""}}
	for slot := 0; slot < req.TrackCount; slot++ {
		next := make([]state, 0, len(beam)*len(tracks))
		for _, current := range beam {
			for i, track := range tracks {
				if current.used&(uint32(1)<<i) != 0 {
					continue
				}
				var previous *taste.Track
				if len(current.indices) > 0 {
					previous = &tracks[current.indices[len(current.indices)-1]]
				}
				contribution := scoreSlot(points[slot], track, pool.Candidates[i].Scores.Taste, previous,
					threeGenreRepeat(current.indices, tracks, track.Genre))
				indices := append(append([]int(nil), current.indices...), i)
				next = append(next, state{indices: indices, used: current.used | (uint32(1) << i),
					total: current.total + contribution, key: current.key + "/" + track.ID})
			}
		}
		sort.Slice(next, func(i, j int) bool {
			if math.Abs(next[i].total-next[j].total) > 1e-12 {
				return next[i].total > next[j].total
			}
			return next[i].key < next[j].key
		})
		if len(next) > beamWidth {
			next = next[:beamWidth]
		}
		beam = next
	}
	if len(beam) == 0 {
		return Plan{}, errors.New("no valid sequence")
	}
	selected := beam[0].indices
	queue := make([]QueueItem, 0, len(selected))
	for slot, index := range selected {
		track := tracks[index]
		candidate := pool.Candidates[index]
		var previous *taste.Track
		if slot > 0 {
			previous = &tracks[selected[slot-1]]
		}
		moodDistance := distance(points[slot], trackMood(track))
		transition := 0.0
		if previous != nil {
			transition = distance(trackMood(*previous), trackMood(track))
		}
		diversity := 0.0
		if threeGenreRepeat(selected[:slot], tracks, track.Genre) {
			diversity = 0.03
		}
		reason := "Balances taste with the requested mood path"
		if moodDistance > 0.35 {
			reason = "Closest available tradeoff; catalog mood coverage is limited"
		}
		queue = append(queue, QueueItem{Position: slot, TrackID: track.ID, AudioPath: candidate.AudioPath,
			PathPoint: roundedMood(points[slot]), TrackMood: roundedMood(trackMood(track)),
			TasteScore: round(candidate.Scores.Taste), MoodDistance: round(moodDistance),
			TransitionDistance: round(transition), DiversityPenalty: diversity,
			Score:  round(scoreSlot(points[slot], track, candidate.Scores.Taste, previous, diversity > 0)),
			Reason: reason})
	}
	return Plan{CatalogID: c.ID, FeatureVersion: taste.FeatureVersion, ScoringVersion: ScoringVersion,
		Available: len(pool.Candidates), UnsupportedGenres: pool.UnsupportedGenres,
		Queue: queue, Quality: Measure(queue)}, nil
}

func validate(req Request) error {
	if strings.TrimSpace(req.UserID) == "" || len(req.UserID) > 128 || req.TrackCount < 1 || req.TrackCount > 20 {
		return errors.New("invalid userId or trackCount")
	}
	if req.CheckInText != nil && utf8.RuneCountInString(*req.CheckInText) > 1000 {
		return errors.New("checkInText exceeds 1000 characters")
	}
	if !validMood(req.StartMood.Mood) || !validMood(req.TargetMood) {
		return errors.New("mood coordinates must be finite values in [0,1]")
	}
	if req.StartMood.Source != "manual" && req.StartMood.Source != "text-model" && req.StartMood.Source != "user-corrected" {
		return errors.New("startMood must have a confirmed source")
	}
	if req.StartMood.Confidence != nil && !unit(*req.StartMood.Confidence) {
		return errors.New("invalid startMood confidence")
	}
	return nil
}

func PathPoint(start, target Mood, position, count int) Mood {
	if count <= 1 {
		return start
	}
	fraction := float64(position) / float64(count-1)
	return Mood{Valence: (1-fraction)*start.Valence + fraction*target.Valence,
		Arousal: (1-fraction)*start.Arousal + fraction*target.Arousal}
}

func Measure(queue []QueueItem) Quality {
	if len(queue) == 0 {
		return Quality{}
	}
	quality := Quality{}
	for _, item := range queue {
		quality.MeanMoodDistance += item.MoodDistance
		quality.MeanTasteScore += item.TasteScore
		quality.MaxMoodDistance = math.Max(quality.MaxMoodDistance, item.MoodDistance)
		quality.MaxTransitionDistance = math.Max(quality.MaxTransitionDistance, item.TransitionDistance)
	}
	quality.MeanMoodDistance = round(quality.MeanMoodDistance / float64(len(queue)))
	quality.MeanTasteScore = round(quality.MeanTasteScore / float64(len(queue)))
	quality.MaxMoodDistance = round(quality.MaxMoodDistance)
	quality.MaxTransitionDistance = round(quality.MaxTransitionDistance)
	quality.TargetGap = queue[len(queue)-1].MoodDistance
	quality.CoverageLimited = quality.MaxMoodDistance > 0.35 || quality.TargetGap > 0.25
	return quality
}

func scoreSlot(point Mood, track taste.Track, affinity float64, previous *taste.Track, repeat bool) float64 {
	transition := 0.0
	if previous != nil {
		transition = distance(trackMood(*previous), trackMood(track))
	}
	penalty := 0.0
	if repeat {
		penalty = 0.03
	}
	return 0.4*affinity + 0.5*(1-distance(point, trackMood(track))) - 0.08*transition - penalty
}

func threeGenreRepeat(indices []int, tracks []taste.Track, genre string) bool {
	n := len(indices)
	return n >= 2 && tracks[indices[n-1]].Genre == genre && tracks[indices[n-2]].Genre == genre
}
func trackMood(track taste.Track) Mood {
	return Mood{Valence: track.Mood.Valence, Arousal: track.Mood.Arousal}
}
func distance(a, b Mood) float64 {
	return math.Hypot(a.Valence-b.Valence, a.Arousal-b.Arousal) / math.Sqrt2
}
func validMood(m Mood) bool   { return unit(m.Valence) && unit(m.Arousal) }
func unit(v float64) bool     { return !math.IsNaN(v) && !math.IsInf(v, 0) && v >= 0 && v <= 1 }
func roundedMood(m Mood) Mood { return Mood{Valence: round(m.Valence), Arousal: round(m.Arousal)} }
func round(v float64) float64 { return math.Round(v*10000) / 10000 }
