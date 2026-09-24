package main

import (
	"bytes"
	"encoding/json"
	"testing"

	"github.com/SriVishnu230707/dream-music/internal/taste"
)

func boolPtr(value bool) *bool { return &value }

func TestEvaluationTimeAndSyntheticGuards(t *testing.T) {
	catalog, err := taste.LoadCatalog("../..")
	if err != nil {
		t.Fatal(err)
	}
	row := caseRecord{UserID: "user-1", CutoffAt: "2026-01-02T00:00:00Z", IsSynthetic: boolPtr(false),
		History: []timedEvent{{Event: taste.Event{EventID: "e1", TrackID: "night-rain", Type: "like"},
			OccurredAt: "2026-01-01T00:00:00Z", IsSynthetic: boolPtr(false)}},
		Relevant: []relevantEvent{{TrackID: "soft-shadow", OccurredAt: "2026-01-03T00:00:00Z", IsSynthetic: boolPtr(false)}},
	}
	if _, err := evaluate(catalog, row, 5); err != nil {
		t.Fatalf("valid time split rejected: %v", err)
	}
	row.IsSynthetic = boolPtr(true)
	if _, err := evaluate(catalog, row, 5); err == nil {
		t.Fatal("synthetic row accepted")
	}
	row.IsSynthetic = boolPtr(false)
	row.History[0].OccurredAt = "2026-01-04T00:00:00Z"
	if _, err := evaluate(catalog, row, 5); err == nil {
		t.Fatal("future history accepted")
	}
	row.History[0].OccurredAt = "2026-01-01T00:00:00Z"
	row.Relevant[0].IsSynthetic = nil
	if _, err := evaluate(catalog, row, 5); err == nil {
		t.Fatal("unmarked relevance accepted")
	}
}

func TestEvaluationReportAndEmptyInput(t *testing.T) {
	catalog, err := taste.LoadCatalog("../..")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := run(catalog, bytes.NewReader(nil), 5); err == nil {
		t.Fatal("empty evaluation accepted")
	}
	row := caseRecord{UserID: "user-1", CutoffAt: "2026-01-02T00:00:00Z", IsSynthetic: boolPtr(false),
		PopularityCounts: map[string]int64{"night-rain": 100}, PopularityAsOf: "2026-01-01T00:00:00Z",
		Relevant: []relevantEvent{{TrackID: "night-rain", OccurredAt: "2026-01-03T00:00:00Z", IsSynthetic: boolPtr(false)}}}
	encoded, _ := json.Marshal(row)
	report, err := run(catalog, bytes.NewReader(append(encoded, '\n')), 1)
	if err != nil {
		t.Fatal(err)
	}
	if report["cases"] != 1 {
		t.Fatalf("wrong case count: %+v", report)
	}
	metrics := report["metrics"].(map[string]result)
	if len(metrics) != 3 {
		t.Fatalf("missing baseline metrics: %+v", metrics)
	}
	if metrics["popularity"].Precision != 1 || metrics["popularity"].Recall != 1 || metrics["popularity"].NDCG != 1 {
		t.Fatalf("incorrect popularity metrics: %+v", metrics["popularity"])
	}
}
