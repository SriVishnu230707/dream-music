package evaluation

import (
	"bytes"
	"encoding/json"
	"os"
	"reflect"
	"strings"
	"testing"

	"github.com/SriVishnu230707/dream-music/internal/taste"
)

func TestSyntheticSmokeDeterministic(t *testing.T) {
	c, err := taste.LoadCatalog("../..")
	if err != nil {
		t.Fatal(err)
	}
	input, err := os.ReadFile("../../docs/fixtures/phase7-smoke.jsonl")
	if err != nil {
		t.Fatal(err)
	}
	first, err := Evaluate(c, bytes.NewReader(input), 5, 7)
	if err != nil {
		t.Fatal(err)
	}
	second, err := Evaluate(c, bytes.NewReader(input), 5, 7)
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(first, second) || !first.Synthetic || first.Cases != 3 {
		t.Fatal("smoke report is not reproducible")
	}
	for _, row := range first.PerCase {
		for _, strategy := range []string{"popularity", "taste", "drift"} {
			if len(row.TrackIDs[strategy]) != 5 {
				t.Fatalf("incomplete %s queue", strategy)
			}
		}
	}
}
func TestRejectsLeakageAndFalseProvenance(t *testing.T) {
	c, err := taste.LoadCatalog("../..")
	if err != nil {
		t.Fatal(err)
	}
	input, err := os.ReadFile("../../docs/fixtures/phase7-smoke.jsonl")
	if err != nil {
		t.Fatal(err)
	}
	first := strings.Split(strings.TrimSpace(string(input)), "\n")[0]
	var row map[string]any
	if err := json.Unmarshal([]byte(first), &row); err != nil {
		t.Fatal(err)
	}
	cases := []func(map[string]any){
		func(v map[string]any) { v["isSynthetic"] = false },
		func(v map[string]any) { v["split"] = "train" },
		func(v map[string]any) { v["moodAsOf"] = "2026-01-04T00:00:00Z" },
		func(v map[string]any) { v["popularityAsOf"] = "2026-01-04T00:00:00Z" },
		func(v map[string]any) { v["request"].(map[string]any)["checkInText"] = "private mood disclosure" },
	}
	for _, change := range cases {
		var candidate map[string]any
		_ = json.Unmarshal([]byte(first), &candidate)
		change(candidate)
		raw, _ := json.Marshal(candidate)
		if _, err := Evaluate(c, bytes.NewReader(raw), 5, 7); err == nil {
			t.Fatalf("unsafe case accepted: %s", raw)
		}
	}
	if _, err := Evaluate(c, strings.NewReader(first+"\n"+first), 5, 7); err == nil {
		t.Fatal("duplicate user/case accepted")
	}
}
