package evaluation

import (
	"bytes"
	"os"
	"strings"
	"testing"
)

func TestStudyAnalysisAndConsent(t *testing.T) {
	raw, err := os.ReadFile("../../docs/fixtures/phase7-study-smoke.jsonl")
	if err != nil {
		t.Fatal(err)
	}
	report, err := AnalyzeStudy(bytes.NewReader(raw))
	if err != nil {
		t.Fatal(err)
	}
	if !report.Synthetic || report.Participants != 1 || report.CompleteTriplets != 1 || report.ByStrategy["drift"].MoodPairs != 1 {
		t.Fatalf("wrong report: %+v", report)
	}
	partial := strings.Split(strings.TrimSpace(string(raw)), "\n")[0]
	partial = strings.Replace(partial, "synthetic-p1", "synthetic-p2", 1)
	partial = strings.Replace(partial, "synthetic-s1", "synthetic-s4", 1)
	withPartial, err := AnalyzeStudy(strings.NewReader(string(raw) + partial + "\n"))
	if err != nil {
		t.Fatal(err)
	}
	if withPartial.Participants != 2 || withPartial.CompleteTriplets != 1 || withPartial.ByStrategy["popularity"].Sessions != 2 || withPartial.CompleteByStrategy["popularity"].Sessions != 1 {
		t.Fatal("partial participant distorted paired summary")
	}
	changed := strings.Replace(string(raw), `"consent":true`, `"consent":false`, 1)
	if _, err := AnalyzeStudy(strings.NewReader(changed)); err == nil {
		t.Fatal("unconsented study row accepted")
	}
	changed = strings.Replace(string(raw), `"order":2`, `"order":1`, 1)
	if _, err := AnalyzeStudy(strings.NewReader(changed)); err == nil {
		t.Fatal("duplicate participant order accepted")
	}
	changed = strings.Replace(string(raw), "synthetic-p1", "name@example.com", 1)
	if _, err := AnalyzeStudy(strings.NewReader(changed)); err == nil {
		t.Fatal("personal identifier accepted")
	}
	changed = strings.Replace(string(raw), `"consent":true`, `"consent":true,"consent":false`, 1)
	if _, err := AnalyzeStudy(strings.NewReader(changed)); err == nil {
		t.Fatal("duplicate consent key accepted")
	}
}
