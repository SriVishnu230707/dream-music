package main

import (
	"encoding/json"
	"os"

	"github.com/SriVishnu230707/dream-music/internal/evaluation"
)

func runStudy(path string) {
	file, err := os.Open(path)
	if err != nil {
		fail(err)
	}
	defer file.Close()
	report, err := evaluation.AnalyzeStudy(file)
	if err != nil {
		fail(err)
	}
	encoder := json.NewEncoder(os.Stdout)
	encoder.SetIndent("", "  ")
	if err := encoder.Encode(report); err != nil {
		fail(err)
	}
}
