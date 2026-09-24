package main

import (
	"bufio"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"math"
	"os"
	"time"

	"github.com/SriVishnu230707/dream-music/internal/taste"
)

type timedEvent struct {
	taste.Event
	OccurredAt  string `json:"occurredAt"`
	IsSynthetic *bool  `json:"isSynthetic"`
}
type relevantEvent struct {
	TrackID     string `json:"trackId"`
	OccurredAt  string `json:"occurredAt"`
	IsSynthetic *bool  `json:"isSynthetic"`
}
type caseRecord struct {
	UserID           string           `json:"userId"`
	CutoffAt         string           `json:"cutoffAt"`
	PreferredGenres  []string         `json:"preferredGenres"`
	PreferencesAsOf  string           `json:"preferencesAsOf"`
	PopularityCounts map[string]int64 `json:"popularityCounts"`
	PopularityAsOf   string           `json:"popularityAsOf"`
	History          []timedEvent     `json:"history"`
	Relevant         []relevantEvent  `json:"relevant"`
	IsSynthetic      *bool            `json:"isSynthetic"`
}
type result struct {
	Precision float64 `json:"precisionAtK"`
	Recall    float64 `json:"recallAtK"`
	NDCG      float64 `json:"ndcgAtK"`
}

func parseTime(value string) (time.Time, error) {
	when, err := time.Parse(time.RFC3339, value)
	if err != nil {
		return time.Time{}, fmt.Errorf("invalid RFC3339 timestamp %q", value)
	}
	return when, nil
}

func evaluate(catalog taste.Catalog, record caseRecord, k int) (map[string]result, error) {
	if record.IsSynthetic == nil || *record.IsSynthetic {
		return nil, errors.New("evaluation case must explicitly be real")
	}
	cutoff, err := parseTime(record.CutoffAt)
	if err != nil {
		return nil, err
	}
	if len(record.PreferredGenres) > 0 {
		asOf, err := parseTime(record.PreferencesAsOf)
		if err != nil || asOf.After(cutoff) {
			return nil, errors.New("preferences must be recorded by cutoff")
		}
	}
	if len(record.PopularityCounts) > 0 {
		asOf, err := parseTime(record.PopularityAsOf)
		if err != nil || asOf.After(cutoff) {
			return nil, errors.New("popularity must be recorded by cutoff")
		}
	}
	events := make([]taste.Event, 0, len(record.History))
	for _, item := range record.History {
		when, err := parseTime(item.OccurredAt)
		if err != nil || !when.Before(cutoff) || item.IsSynthetic == nil || *item.IsSynthetic {
			return nil, errors.New("history must explicitly be real and before cutoff")
		}
		events = append(events, item.Event)
	}
	relevant := map[string]bool{}
	for _, item := range record.Relevant {
		when, err := parseTime(item.OccurredAt)
		if err != nil || !when.After(cutoff) || item.IsSynthetic == nil || *item.IsSynthetic {
			return nil, errors.New("relevance must explicitly be real and after cutoff")
		}
		if _, ok := catalog.Track(item.TrackID); !ok {
			return nil, fmt.Errorf("relevant track not playable: %s", item.TrackID)
		}
		relevant[item.TrackID] = true
	}
	if len(relevant) == 0 {
		return nil, errors.New("evaluation case has no relevant playable tracks")
	}
	output := map[string]result{}
	for _, strategy := range []string{"popularity", "taste", "taste-explore"} {
		ranked, err := taste.Rank(catalog, taste.Request{UserID: record.UserID, Strategy: strategy,
			Limit: k, PreferredGenres: record.PreferredGenres, Events: events,
			PopularityCounts: record.PopularityCounts})
		if err != nil {
			return nil, err
		}
		hits, dcg := 0, 0.0
		for i, candidate := range ranked.Candidates {
			if relevant[candidate.TrackID] {
				hits++
				dcg += 1 / math.Log2(float64(i+2))
			}
		}
		ideal := 0.0
		for i := 0; i < min(k, len(relevant)); i++ {
			ideal += 1 / math.Log2(float64(i+2))
		}
		output[strategy] = result{Precision: float64(hits) / float64(k), Recall: float64(hits) / float64(len(relevant)), NDCG: dcg / ideal}
	}
	return output, nil
}

func run(catalog taste.Catalog, reader io.Reader, k int) (map[string]any, error) {
	if k < 1 || k > 20 {
		return nil, errors.New("k must be 1..20")
	}
	sums := map[string]result{}
	count := 0
	scanner := bufio.NewScanner(reader)
	scanner.Buffer(make([]byte, 64*1024), 1024*1024)
	for scanner.Scan() {
		var record caseRecord
		if err := json.Unmarshal(scanner.Bytes(), &record); err != nil {
			return nil, fmt.Errorf("case %d: %w", count+1, err)
		}
		values, err := evaluate(catalog, record, k)
		if err != nil {
			return nil, fmt.Errorf("case %d: %w", count+1, err)
		}
		for name, value := range values {
			current := sums[name]
			current.Precision += value.Precision
			current.Recall += value.Recall
			current.NDCG += value.NDCG
			sums[name] = current
		}
		count++
	}
	if err := scanner.Err(); err != nil {
		return nil, err
	}
	if count == 0 {
		return nil, errors.New("no real evaluation cases supplied")
	}
	averages := map[string]result{}
	for name, value := range sums {
		averages[name] = result{Precision: value.Precision / float64(count), Recall: value.Recall / float64(count), NDCG: value.NDCG / float64(count)}
	}
	return map[string]any{"cases": count, "k": k, "metrics": averages,
		"note": "Offline relevance only; no claim of mood improvement or listener satisfaction."}, nil
}

func main() {
	root := flag.String("root", ".", "repository root")
	input := flag.String("input", "", "JSONL of real time-ordered evaluation cases")
	k := flag.Int("k", 5, "ranking depth")
	flag.Parse()
	if *input == "" {
		fmt.Fprintln(os.Stderr, "--input is required")
		os.Exit(2)
	}
	catalog, err := taste.LoadCatalog(*root)
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	file, err := os.Open(*input)
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	defer file.Close()
	report, err := run(catalog, file, *k)
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	_ = json.NewEncoder(os.Stdout).Encode(report)
}
