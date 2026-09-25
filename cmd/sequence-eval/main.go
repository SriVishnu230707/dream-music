package main

import (
	"bufio"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"os"

	"github.com/SriVishnu230707/dream-music/internal/sequence"
	"github.com/SriVishnu230707/dream-music/internal/taste"
)

type scenario struct {
	ID      string           `json:"id"`
	Request sequence.Request `json:"request"`
}

func main() {
	root := flag.String("root", ".", "repository root")
	input := flag.String("input", "docs/fixtures/phase4-scenarios.jsonl", "JSONL of deterministic scenarios")
	flag.Parse()
	catalog, err := taste.LoadCatalog(*root)
	if err != nil {
		fail(err)
	}
	file, err := os.Open(*input)
	if err != nil {
		fail(err)
	}
	defer file.Close()
	scanner := bufio.NewScanner(file)
	scanner.Buffer(make([]byte, 16*1024), 1024*1024)
	reports := []map[string]any{}
	seen := map[string]bool{}
	for scanner.Scan() {
		var item scenario
		if err := json.Unmarshal(scanner.Bytes(), &item); err != nil {
			fail(err)
		}
		if item.ID == "" || seen[item.ID] {
			fail(errors.New("missing or duplicate scenario ID"))
		}
		seen[item.ID] = true
		qualities := map[string]sequence.Quality{}
		trackIDs := map[string][]string{}
		for _, strategy := range []string{"popularity", "taste", "drift"} {
			var plan sequence.Plan
			var err error
			if strategy == "drift" {
				plan, err = sequence.Build(catalog, item.Request)
			} else {
				plan, err = sequence.Baseline(catalog, item.Request, strategy)
			}
			if err != nil {
				fail(fmt.Errorf("scenario %s %s: %w", item.ID, strategy, err))
			}
			qualities[strategy] = plan.Quality
			ids := make([]string, len(plan.Queue))
			for i, queueItem := range plan.Queue {
				ids[i] = queueItem.TrackID
			}
			trackIDs[strategy] = ids
		}
		reports = append(reports, map[string]any{"id": item.ID, "quality": qualities, "trackIds": trackIDs})
	}
	if err := scanner.Err(); err != nil {
		fail(err)
	}
	if len(reports) == 0 {
		fail(errors.New("no scenarios"))
	}
	_ = json.NewEncoder(os.Stdout).Encode(map[string]any{"catalogId": catalog.ID,
		"scoringVersion": sequence.ScoringVersion, "scenarios": reports,
		"note": "Synthetic engineering scenarios measure queue properties, not listener mood improvement."})
}

func fail(err error) { fmt.Fprintln(os.Stderr, err); os.Exit(1) }
