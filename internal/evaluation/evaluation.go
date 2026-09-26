package evaluation

import (
	"bufio"
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"math/rand"
	"regexp"
	"sort"
	"time"

	"github.com/SriVishnu230707/dream-music/internal/sequence"
	"github.com/SriVishnu230707/dream-music/internal/taste"
)

const Version = "phase7-eval-v1"

var safeID = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$`)

type TimedEvent struct {
	taste.Event
	OccurredAt  time.Time `json:"occurredAt"`
	IsSynthetic *bool     `json:"isSynthetic"`
}
type Relevance struct {
	TrackID     string    `json:"trackId"`
	OccurredAt  time.Time `json:"occurredAt"`
	IsSynthetic *bool     `json:"isSynthetic"`
}
type Case struct {
	ID               string           `json:"id"`
	Split            string           `json:"split"`
	IsSynthetic      *bool            `json:"isSynthetic"`
	CutoffAt         time.Time        `json:"cutoffAt"`
	MoodAsOf         time.Time        `json:"moodAsOf"`
	PreferencesAsOf  time.Time        `json:"preferencesAsOf"`
	PopularityAsOf   time.Time        `json:"popularityAsOf"`
	Request          sequence.Request `json:"request"`
	PopularityCounts map[string]int64 `json:"popularityCounts"`
	History          []TimedEvent     `json:"history"`
	Relevant         []Relevance      `json:"relevant"`
}
type Ranking struct {
	Precision float64 `json:"precisionAtK"`
	Recall    float64 `json:"recallAtK"`
	NDCG      float64 `json:"ndcgAtK"`
}
type Metrics struct {
	Ranking
	MeanMoodDistance      float64 `json:"meanMoodDistance"`
	MaxTransitionDistance float64 `json:"maxTransitionDistance"`
	TargetGap             float64 `json:"targetGap"`
	GenreDiversity        float64 `json:"genreDiversity"`
}
type CaseResult struct {
	ID        string              `json:"id"`
	ColdStart bool                `json:"coldStart"`
	Metrics   map[string]Metrics  `json:"metrics"`
	TrackIDs  map[string][]string `json:"trackIds"`
}
type Interval struct {
	Mean    float64 `json:"mean"`
	Lower95 float64 `json:"lower95"`
	Upper95 float64 `json:"upper95"`
}
type Report struct {
	Version         string              `json:"version"`
	CatalogID       string              `json:"catalogId"`
	CatalogSHA256   string              `json:"catalogSha256"`
	ScoringVersion  string              `json:"scoringVersion"`
	BootstrapSeed   int64               `json:"bootstrapSeed"`
	InputSHA256     string              `json:"inputSha256"`
	K               int                 `json:"k"`
	Cases           int                 `json:"cases"`
	Synthetic       bool                `json:"synthetic"`
	PerCase         []CaseResult        `json:"perCase"`
	Mean            map[string]Metrics  `json:"mean"`
	PairedNDCGDelta map[string]Interval `json:"pairedNdcgDeltaVsDrift"`
	Note            string              `json:"note"`
}

func Evaluate(c taste.Catalog, reader io.Reader, k int, seed int64) (Report, error) {
	if k < 1 || k > 20 || k > c.Count() {
		return Report{}, errors.New("k must be 1..20 and no larger than the catalog")
	}
	raw, err := io.ReadAll(io.LimitReader(reader, (16<<20)+1))
	if err != nil {
		return Report{}, err
	}
	if len(raw) > 16<<20 {
		return Report{}, errors.New("evaluation input exceeds 16 MiB")
	}
	digest := sha256.Sum256(raw)
	catalogRaw, err := json.Marshal(c.Tracks)
	if err != nil {
		return Report{}, err
	}
	catalogDigest := sha256.Sum256(catalogRaw)
	out := Report{Version: Version, CatalogID: c.ID, CatalogSHA256: hex.EncodeToString(catalogDigest[:]), ScoringVersion: sequence.ScoringVersion, BootstrapSeed: seed, InputSHA256: hex.EncodeToString(digest[:]), K: k, PerCase: []CaseResult{}, Mean: map[string]Metrics{}, PairedNDCGDelta: map[string]Interval{}}
	scanner := bufio.NewScanner(bytes.NewReader(raw))
	scanner.Buffer(make([]byte, 64<<10), 1<<20)
	ids, users := map[string]bool{}, map[string]bool{}
	var cohort *bool
	for scanner.Scan() {
		if len(bytes.TrimSpace(scanner.Bytes())) == 0 {
			continue
		}
		if len(out.PerCase) >= 1000 {
			return Report{}, errors.New("evaluation exceeds 1000 cases")
		}
		if err := uniqueJSON(scanner.Bytes()); err != nil {
			return Report{}, fmt.Errorf("case %d: %w", len(out.PerCase)+1, err)
		}
		var item Case
		dec := json.NewDecoder(bytes.NewReader(scanner.Bytes()))
		dec.DisallowUnknownFields()
		if err := dec.Decode(&item); err != nil {
			return Report{}, fmt.Errorf("case %d: %w", len(out.PerCase)+1, err)
		}
		if dec.Decode(new(any)) != io.EOF {
			return Report{}, errors.New("trailing case data")
		}
		if !safeID.MatchString(item.ID) || !safeID.MatchString(item.Request.UserID) || ids[item.ID] || users[item.Request.UserID] {
			return Report{}, errors.New("case IDs and users must be unique")
		}
		ids[item.ID], users[item.Request.UserID] = true, true
		if item.IsSynthetic == nil {
			return Report{}, fmt.Errorf("case %s missing isSynthetic", item.ID)
		}
		if cohort != nil && *cohort != *item.IsSynthetic {
			return Report{}, errors.New("do not mix real and synthetic evaluation cases")
		}
		cohort = item.IsSynthetic
		if err := validate(c, item, k); err != nil {
			return Report{}, fmt.Errorf("case %s: %w", item.ID, err)
		}
		result, err := evaluateCase(c, item, k)
		if err != nil {
			return Report{}, fmt.Errorf("case %s: %w", item.ID, err)
		}
		out.PerCase = append(out.PerCase, result)
	}
	if err := scanner.Err(); err != nil {
		return Report{}, err
	}
	if len(out.PerCase) == 0 {
		return Report{}, errors.New("no evaluation cases")
	}
	out.Cases = len(out.PerCase)
	out.Synthetic = *cohort
	for _, name := range []string{"popularity", "taste", "drift"} {
		var sum Metrics
		for _, row := range out.PerCase {
			v := row.Metrics[name]
			sum.Precision += v.Precision
			sum.Recall += v.Recall
			sum.NDCG += v.NDCG
			sum.MeanMoodDistance += v.MeanMoodDistance
			sum.MaxTransitionDistance += v.MaxTransitionDistance
			sum.TargetGap += v.TargetGap
			sum.GenreDiversity += v.GenreDiversity
		}
		n := float64(out.Cases)
		sum.Precision /= n
		sum.Recall /= n
		sum.NDCG /= n
		sum.MeanMoodDistance /= n
		sum.MaxTransitionDistance /= n
		sum.TargetGap /= n
		sum.GenreDiversity /= n
		out.Mean[name] = sum
	}
	for _, name := range []string{"popularity", "taste"} {
		deltas := make([]float64, len(out.PerCase))
		for i, row := range out.PerCase {
			deltas[i] = row.Metrics["drift"].NDCG - row.Metrics[name].NDCG
		}
		out.PairedNDCGDelta[name] = bootstrap(deltas, seed)
	}
	if out.Synthetic {
		out.Note = "Synthetic engineering fixture only; metrics are not evidence of listener satisfaction or mood improvement."
	} else {
		out.Note = "Offline relevance and catalog-proxy sequence metrics only; user-study outcomes must be analyzed separately."
	}
	return out, nil
}

func validate(c taste.Catalog, item Case, k int) error {
	if item.Request.CheckInText != nil {
		return errors.New("raw check-in text is not allowed in evaluation files")
	}
	if item.Split != "test" {
		return errors.New("only frozen test-split cases are evaluated")
	}
	if item.CutoffAt.IsZero() || item.MoodAsOf.IsZero() || item.MoodAsOf.After(item.CutoffAt) {
		return errors.New("mood must be recorded by cutoff")
	}
	if item.Request.TrackCount != k {
		return errors.New("trackCount must equal k")
	}
	if len(item.Request.Taste.PreferredGenres) > 0 || len(item.Request.Taste.LikedTrackIDs) > 0 {
		if item.PreferencesAsOf.IsZero() || item.PreferencesAsOf.After(item.CutoffAt) {
			return errors.New("taste preferences must predate cutoff")
		}
	}
	if len(item.PopularityCounts) > 0 && (item.PopularityAsOf.IsZero() || item.PopularityAsOf.After(item.CutoffAt)) {
		return errors.New("popularity counts must predate cutoff")
	}
	knownTrack := func(id string) bool {
		if !safeID.MatchString(id) {
			return false
		}
		_, ok := c.Track(id)
		return ok
	}
	for _, id := range item.Request.Taste.LikedTrackIDs {
		if !knownTrack(id) {
			return errors.New("liked track is not in catalog")
		}
	}
	for id, count := range item.PopularityCounts {
		if !knownTrack(id) || count < 0 {
			return errors.New("invalid popularity count or track")
		}
	}
	eventIDs := map[string]bool{}
	for _, e := range item.History {
		if e.IsSynthetic == nil || *e.IsSynthetic != *item.IsSynthetic || e.OccurredAt.IsZero() || !e.OccurredAt.Before(item.CutoffAt) || !safeID.MatchString(e.EventID) || eventIDs[e.EventID] || !knownTrack(e.TrackID) {
			return errors.New("history must match cohort, predate cutoff, and have unique event IDs")
		}
		eventIDs[e.EventID] = true
	}
	if len(item.Relevant) == 0 {
		return errors.New("at least one held-out relevant track is required")
	}
	for _, e := range item.Relevant {
		if e.IsSynthetic == nil || *e.IsSynthetic != *item.IsSynthetic || e.OccurredAt.IsZero() || !e.OccurredAt.After(item.CutoffAt) {
			return errors.New("relevance must match cohort and follow cutoff")
		}
		if !knownTrack(e.TrackID) {
			return errors.New("relevant track is not in catalog")
		}
	}
	return nil
}

func evaluateCase(c taste.Catalog, item Case, k int) (CaseResult, error) {
	req := item.Request
	req.PopularityCounts = item.PopularityCounts
	for _, e := range item.History {
		req.FeedbackEvents = append(req.FeedbackEvents, e.Event)
	}
	relevant := map[string]bool{}
	for _, e := range item.Relevant {
		relevant[e.TrackID] = true
	}
	output := CaseResult{ID: item.ID, ColdStart: len(req.Taste.PreferredGenres) == 0 && len(req.Taste.LikedTrackIDs) == 0 && len(req.FeedbackEvents) == 0, Metrics: map[string]Metrics{}, TrackIDs: map[string][]string{}}
	for _, name := range []string{"popularity", "taste", "drift"} {
		var plan sequence.Plan
		var err error
		if name == "drift" {
			plan, err = sequence.Build(c, req)
		} else {
			plan, err = sequence.Baseline(c, req, name)
		}
		if err != nil {
			return CaseResult{}, fmt.Errorf("%s: %w", name, err)
		}
		seen, genres := map[string]bool{}, map[string]bool{}
		hits, dcg := 0, 0.0
		ids := make([]string, len(plan.Queue))
		for i, q := range plan.Queue {
			if seen[q.TrackID] {
				return CaseResult{}, errors.New("queue contains duplicate tracks")
			}
			seen[q.TrackID] = true
			ids[i] = q.TrackID
			track, ok := c.Track(q.TrackID)
			if !ok {
				return CaseResult{}, errors.New("queue contains unknown track")
			}
			genres[track.Genre] = true
			if relevant[q.TrackID] {
				hits++
				dcg += 1 / math.Log2(float64(i+2))
			}
		}
		ideal := 0.0
		for i := 0; i < min(k, len(relevant)); i++ {
			ideal += 1 / math.Log2(float64(i+2))
		}
		output.TrackIDs[name] = ids
		output.Metrics[name] = Metrics{Ranking: Ranking{Precision: float64(hits) / float64(k), Recall: float64(hits) / float64(len(relevant)), NDCG: dcg / ideal}, MeanMoodDistance: plan.Quality.MeanMoodDistance, MaxTransitionDistance: plan.Quality.MaxTransitionDistance, TargetGap: plan.Quality.TargetGap, GenreDiversity: float64(len(genres)) / float64(k)}
	}
	return output, nil
}

func bootstrap(values []float64, seed int64) Interval {
	mean := 0.0
	for _, v := range values {
		mean += v
	}
	mean /= float64(len(values))
	if len(values) < 2 {
		return Interval{Mean: mean, Lower95: mean, Upper95: mean}
	}
	rng := rand.New(rand.NewSource(seed))
	samples := make([]float64, 1000)
	for i := range samples {
		for range values {
			samples[i] += values[rng.Intn(len(values))]
		}
		samples[i] /= float64(len(values))
	}
	sort.Float64s(samples)
	return Interval{Mean: mean, Lower95: samples[24], Upper95: samples[974]}
}
