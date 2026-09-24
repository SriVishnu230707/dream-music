package taste

import (
	"errors"
	"fmt"
	"hash/fnv"
	"math"
	"sort"
	"strings"
)

const FeatureVersion = "content-v1"

type Event struct {
	EventID         string   `json:"eventId"`
	TrackID         string   `json:"trackId"`
	Type            string   `json:"type"`
	ListenedSeconds *float64 `json:"listenedSeconds,omitempty"`
}

type Request struct {
	UserID           string           `json:"userId"`
	Strategy         string           `json:"strategy"`
	Limit            int              `json:"limit"`
	PreferredGenres  []string         `json:"preferredGenres"`
	LikedTrackIDs    []string         `json:"likedTrackIds"`
	ExcludeTrackIDs  []string         `json:"excludeTrackIds"`
	Events           []Event          `json:"events"`
	PopularityCounts map[string]int64 `json:"popularityCounts"`
}

type Scores struct {
	Genre            float64 `json:"genreAffinity"`
	History          float64 `json:"historyAffinity"`
	Negative         float64 `json:"negativePenalty"`
	Popularity       float64 `json:"popularity"`
	Novelty          float64 `json:"novelty"`
	Taste            float64 `json:"tasteTotal"`
	Total            float64 `json:"total"`
	Selection        float64 `json:"selectionScore"`
	DiversityPenalty float64 `json:"diversityPenalty"`
	Exploration      float64 `json:"explorationTieBreak"`
}

type Candidate struct {
	TrackID   string `json:"trackId"`
	AudioPath string `json:"audioPath"`
	Genre     string `json:"genre"`
	Scores    Scores `json:"scores"`
	Reason    string `json:"reason"`
}

type Response struct {
	CatalogID           string          `json:"catalogId"`
	FeatureVersion      string          `json:"featureVersion"`
	Strategy            string          `json:"strategy"`
	ColdStart           bool            `json:"coldStart"`
	Available           int             `json:"available"`
	UnsupportedGenres   []string        `json:"unsupportedGenres"`
	FeatureAvailability map[string]bool `json:"featureAvailability"`
	Candidates          []Candidate     `json:"candidates"`
}

func Rank(c Catalog, request Request) (Response, error) {
	if strings.TrimSpace(request.UserID) == "" || len(request.UserID) > 128 ||
		(request.Strategy != "popularity" && request.Strategy != "taste" && request.Strategy != "taste-explore") ||
		request.Limit < 1 || request.Limit > 20 || len(request.Events) > 200 || len(request.LikedTrackIDs) > 100 ||
		len(request.PreferredGenres) > 30 || len(request.ExcludeTrackIDs) > 100 {
		return Response{}, errors.New("invalid request size, strategy, or user ID")
	}
	known := func(id string) error {
		if _, ok := c.Track(id); !ok {
			return fmt.Errorf("unknown track ID: %s", id)
		}
		return nil
	}
	catalogGenres := map[string]bool{}
	for _, track := range c.Tracks {
		catalogGenres[strings.ToLower(track.Genre)] = true
	}
	preferred := map[string]bool{}
	unsupported := map[string]bool{}
	for _, genre := range request.PreferredGenres {
		genre = strings.TrimSpace(strings.ToLower(genre))
		if genre == "" || len(genre) > 80 {
			return Response{}, errors.New("invalid preferred genre")
		}
		if catalogGenres[genre] {
			preferred[genre] = true
		} else {
			unsupported[genre] = true
		}
	}
	excluded, seen := map[string]bool{}, map[string]bool{}
	positive, negative := map[string]float64{}, map[string]float64{}
	for _, id := range request.ExcludeTrackIDs {
		if err := known(id); err != nil {
			return Response{}, err
		}
		excluded[id] = true
	}
	for _, id := range request.LikedTrackIDs {
		if err := known(id); err != nil {
			return Response{}, err
		}
		seen[id] = true
		positive[id] = 2 // Duplicates cannot amplify a stated preference.
	}
	eventIDs := map[string]Event{}
	for _, event := range request.Events {
		if event.EventID == "" || len(event.EventID) > 128 || (event.ListenedSeconds != nil && !unitSeconds(*event.ListenedSeconds)) {
			return Response{}, errors.New("invalid event")
		}
		if err := known(event.TrackID); err != nil {
			return Response{}, err
		}
		if old, exists := eventIDs[event.EventID]; exists {
			if !sameEvent(old, event) {
				return Response{}, fmt.Errorf("conflicting event ID: %s", event.EventID)
			}
			continue
		}
		eventIDs[event.EventID] = event
		track, _ := c.Track(event.TrackID)
		switch event.Type {
		case "start":
		case "like":
			positive[event.TrackID] = math.Min(3, positive[event.TrackID]+2)
			seen[event.TrackID] = true
		case "replay":
			positive[event.TrackID] = math.Min(3, positive[event.TrackID]+1.5)
			seen[event.TrackID] = true
		case "complete":
			positive[event.TrackID] = math.Min(3, positive[event.TrackID]+0.75)
			seen[event.TrackID] = true
		case "skip":
			seen[event.TrackID] = true
			if event.ListenedSeconds != nil && *event.ListenedSeconds < float64(track.Audio.DurationSeconds)*0.5 {
				negative[event.TrackID] = math.Min(0.6, negative[event.TrackID]+0.2)
			}
		default:
			return Response{}, fmt.Errorf("unknown event type: %s", event.Type)
		}
	}
	maxPopularity := int64(0)
	for id, count := range request.PopularityCounts {
		if err := known(id); err != nil {
			return Response{}, err
		}
		if count < 0 {
			return Response{}, errors.New("negative popularity count")
		}
		if count > maxPopularity {
			maxPopularity = count
		}
	}
	artistSet := map[string]bool{}
	for _, track := range c.Tracks {
		artistSet[track.Artist] = true
	}
	artistUseful := len(artistSet) > 1
	cold := len(positive) == 0 && len(preferred) == 0 && len(negative) == 0
	response := Response{
		CatalogID: c.ID, FeatureVersion: FeatureVersion, Strategy: request.Strategy, ColdStart: cold,
		FeatureAvailability: map[string]bool{"genre": true, "tempo": true, "artist": artistUseful, "language": false},
		Candidates:          []Candidate{},
	}
	response.UnsupportedGenres = make([]string, 0, len(unsupported))
	for genre := range unsupported {
		response.UnsupportedGenres = append(response.UnsupportedGenres, genre)
	}
	sort.Strings(response.UnsupportedGenres)
	pool := make([]Candidate, 0, len(c.Tracks))
	for _, track := range c.Tracks {
		if excluded[track.ID] {
			continue
		}
		genre := 0.0
		if preferred[strings.ToLower(track.Genre)] {
			genre = 1
		}
		history := affinity(c, track, positive, artistUseful)
		penalty := affinity(c, track, negative, artistUseful)
		popularity := 0.5 // Uniform fallback when no real aggregate counts exist.
		if maxPopularity > 0 {
			popularity = math.Log1p(float64(request.PopularityCounts[track.ID])) / math.Log1p(float64(maxPopularity))
		}
		novelty := 1.0
		if seen[track.ID] {
			novelty = 0
		}
		taste := 0.5
		if !cold {
			if len(positive) == 0 && len(preferred) == 0 {
				taste = clamp(0.5 - 0.2*penalty)
			} else {
				taste = clamp(0.6*history + 0.35*genre + 0.05*popularity - 0.2*penalty)
			}
		}
		total := taste
		if request.Strategy == "popularity" {
			total = popularity
		}
		candidate := Candidate{TrackID: track.ID, AudioPath: track.Audio.Path, Genre: track.Genre,
			Scores: Scores{Genre: round(genre), History: round(history), Negative: round(penalty),
				Popularity: round(popularity), Novelty: novelty, Taste: round(taste), Total: round(total)},
			Reason: "Content affinity and stated preferences"}
		if cold {
			candidate.Reason = "Cold-start catalog coverage"
		}
		if request.Strategy == "popularity" {
			candidate.Reason = "Aggregate popularity baseline"
		}
		pool = append(pool, candidate)
	}
	response.Available = len(pool)
	if len(pool) == 0 {
		return response, errors.New("no playable candidates after exclusions")
	}
	limit := min(request.Limit, len(pool))
	base := limit
	if request.Strategy == "taste-explore" && !cold && limit > 1 {
		base = limit - max(1, int(math.Ceil(float64(limit)*0.2)))
	}
	selected := map[string]bool{}
	genreSelected := map[string]int{}
	for len(response.Candidates) < base {
		i, selection := bestIndex(pool, selected, genreSelected, cold && request.Strategy != "popularity", false, request.UserID)
		if i < 0 {
			break
		}
		pick := pool[i]
		pick.Scores.Selection = round(selection)
		if cold && request.Strategy != "popularity" {
			pick.Scores.DiversityPenalty = round(0.16 * float64(genreSelected[pick.Genre]))
		}
		response.Candidates = append(response.Candidates, pick)
		selected[pick.TrackID] = true
		genreSelected[pick.Genre]++
	}
	for len(response.Candidates) < limit {
		explore := request.Strategy == "taste-explore" && !cold
		i, selection := bestIndex(pool, selected, genreSelected, cold && request.Strategy != "popularity", explore, request.UserID)
		if i < 0 {
			break
		}
		pick := pool[i]
		pick.Scores.Selection = round(selection)
		if explore {
			pick.Scores.Exploration = round(stableUnit(request.UserID + ":" + pick.TrackID))
		}
		if cold && request.Strategy != "popularity" {
			pick.Scores.DiversityPenalty = round(0.16 * float64(genreSelected[pick.Genre]))
		}
		if explore && pick.Scores.Novelty == 1 {
			pick.Reason = "Exploration of an unseen track"
		}
		response.Candidates = append(response.Candidates, pick)
		selected[pick.TrackID] = true
		genreSelected[pick.Genre]++
	}
	return response, nil
}

func affinity(c Catalog, target Track, weights map[string]float64, artistUseful bool) float64 {
	sum, total := 0.0, 0.0
	ids := make([]string, 0, len(weights))
	for id := range weights {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	for _, id := range ids {
		weight := weights[id]
		if weight <= 0 {
			continue
		}
		other, _ := c.Track(id)
		similarity := 0.0
		if other.Genre == target.Genre {
			similarity += 0.6
		}
		similarity += 0.25 * (1 - math.Min(1, math.Abs(float64(other.BPM-target.BPM))/100))
		denominator := 0.85
		if artistUseful {
			denominator = 1
			if other.Artist == target.Artist {
				similarity += 0.15
			}
		}
		sum += weight * similarity / denominator
		total += weight
	}
	if total == 0 {
		return 0
	}
	return sum / total
}

func bestIndex(pool []Candidate, selected map[string]bool, genres map[string]int, cold, explore bool, userID string) (int, float64) {
	best, score := -1, math.Inf(-1)
	for i, candidate := range pool {
		if selected[candidate.TrackID] {
			continue
		}
		value := candidate.Scores.Total
		if cold {
			value -= 0.16 * float64(genres[candidate.Genre])
		}
		if explore {
			if candidate.Scores.Novelty == 0 {
				continue
			}
			value = 0.7*candidate.Scores.Taste + 0.3*stableUnit(userID+":"+candidate.TrackID)
		}
		if value > score || (value == score && (best < 0 || candidate.TrackID < pool[best].TrackID)) {
			best, score = i, value
		}
	}
	if best < 0 && explore {
		return bestIndex(pool, selected, genres, cold, false, userID)
	}
	return best, score
}

func stableUnit(value string) float64 {
	hash := fnv.New32a()
	_, _ = hash.Write([]byte(value))
	return float64(hash.Sum32()) / float64(math.MaxUint32)
}
func sameEvent(a, b Event) bool {
	if a.EventID != b.EventID || a.TrackID != b.TrackID || a.Type != b.Type {
		return false
	}
	if a.ListenedSeconds == nil || b.ListenedSeconds == nil {
		return a.ListenedSeconds == nil && b.ListenedSeconds == nil
	}
	return *a.ListenedSeconds == *b.ListenedSeconds
}
func unitSeconds(value float64) bool {
	return !math.IsNaN(value) && !math.IsInf(value, 0) && value >= 0 && value <= 3600
}
func clamp(value float64) float64 { return math.Max(0, math.Min(1, value)) }
func round(value float64) float64 { return math.Round(value*10000) / 10000 }
