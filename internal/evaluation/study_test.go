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
	changed := strings.Replace(string(raw), `"consent":true`, `"consent":false`, 1)
	if _, err := AnalyzeStudy(strings.NewReader(changed)); err == nil {
		t.Fatal("unconsented study row accepted")
	}
	changed = strings.Replace(string(raw), `"order":2`, `"order":1`, 1)
	if _, err := AnalyzeStudy(strings.NewReader(changed)); err == nil {
		t.Fatal("duplicate participant order accepted")
	}
}
