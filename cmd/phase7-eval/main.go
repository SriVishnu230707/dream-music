package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"os"

	"github.com/SriVishnu230707/dream-music/internal/evaluation"
	"github.com/SriVishnu230707/dream-music/internal/taste"
)

func main() {
	root := flag.String("root", ".", "repository root")
	input := flag.String("input", "", "frozen test cases in JSONL format")
	study := flag.String("study", "", "consented user-study sessions in JSONL format")
	k := flag.Int("k", 5, "queue length and ranking depth")
	seed := flag.Int64("seed", 7, "deterministic bootstrap seed")
	flag.Parse()
	if *study != "" {
		if *input != "" {
			fail(fmt.Errorf("choose either --input or --study"))
		}
		runStudy(*study)
		return
	}
	if *input == "" {
		fail(fmt.Errorf("--input is required"))
	}
	catalog, err := taste.LoadCatalog(*root)
	if err != nil {
		fail(err)
	}
	file, err := os.Open(*input)
	if err != nil {
		fail(err)
	}
	defer file.Close()
	report, err := evaluation.Evaluate(catalog, file, *k, *seed)
	if err != nil {
		fail(err)
	}
	encoder := json.NewEncoder(os.Stdout)
	encoder.SetIndent("", "  ")
	if err := encoder.Encode(report); err != nil {
		fail(err)
	}
}
func fail(err error) { fmt.Fprintln(os.Stderr, err); os.Exit(1) }
