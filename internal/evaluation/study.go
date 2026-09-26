package evaluation

import (
	"bufio"
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"math"

	"github.com/SriVishnu230707/dream-music/internal/sequence"
)

type StudyRow struct {
	ParticipantID   string         `json:"participantId"`
	SessionID       string         `json:"sessionId"`
	Strategy        string         `json:"strategy"`
	Order           int            `json:"order"`
	Consent         bool           `json:"consent"`
	IsSynthetic     *bool          `json:"isSynthetic"`
	RelevanceRating int            `json:"relevanceRating"`
	CoherenceRating int            `json:"coherenceRating"`
	Before          *sequence.Mood `json:"beforeMood,omitempty"`
	After           *sequence.Mood `json:"afterMood,omitempty"`
}
type StudySummary struct {
	Sessions          int      `json:"sessions"`
	MeanRelevance     float64  `json:"meanRelevance"`
	MeanCoherence     float64  `json:"meanCoherence"`
	MoodPairs         int      `json:"moodPairs"`
	MeanValenceChange *float64 `json:"meanValenceChange,omitempty"`
	MeanArousalChange *float64 `json:"meanArousalChange,omitempty"`
}
type StudyReport struct {
	InputSHA256      string                  `json:"inputSha256"`
	Synthetic        bool                    `json:"synthetic"`
	Participants     int                     `json:"participants"`
	CompleteTriplets int                     `json:"completeTriplets"`
	ByStrategy       map[string]StudySummary `json:"byStrategy"`
	OrderCounts      map[string][3]int       `json:"orderCounts"`
	Note             string                  `json:"note"`
}

func AnalyzeStudy(reader io.Reader) (StudyReport, error) {
	raw, err := io.ReadAll(io.LimitReader(reader, (8<<20)+1))
	if err != nil {
		return StudyReport{}, err
	}
	if len(raw) > 8<<20 {
		return StudyReport{}, errors.New("study input exceeds 8 MiB")
	}
	digest := sha256.Sum256(raw)
	output := StudyReport{InputSHA256: hex.EncodeToString(digest[:]), ByStrategy: map[string]StudySummary{}, OrderCounts: map[string][3]int{}}
	scanner := bufio.NewScanner(bytes.NewReader(raw))
	scanner.Buffer(make([]byte, 64<<10), 1<<20)
	participants := map[string]map[string]StudyRow{}
	sessions := map[string]bool{}
	var cohort *bool
	for scanner.Scan() {
		if len(bytes.TrimSpace(scanner.Bytes())) == 0 {
			continue
		}
		var row StudyRow
		dec := json.NewDecoder(bytes.NewReader(scanner.Bytes()))
		dec.DisallowUnknownFields()
		if err := dec.Decode(&row); err != nil {
			return StudyReport{}, err
		}
		if dec.Decode(new(any)) != io.EOF {
			return StudyReport{}, errors.New("trailing study row data")
		}
		if row.ParticipantID == "" || row.SessionID == "" || sessions[row.SessionID] || !row.Consent || row.IsSynthetic == nil || row.Order < 1 || row.Order > 3 || row.RelevanceRating < 1 || row.RelevanceRating > 5 || row.CoherenceRating < 1 || row.CoherenceRating > 5 {
			return StudyReport{}, errors.New("invalid or unconsented study row")
		}
		if row.Strategy != "popularity" && row.Strategy != "taste" && row.Strategy != "drift" {
			return StudyReport{}, errors.New("unknown study strategy")
		}
		if (row.Before == nil) != (row.After == nil) || (row.Before != nil && (!validStudyMood(*row.Before) || !validStudyMood(*row.After))) {
			return StudyReport{}, errors.New("invalid or unpaired mood rating")
		}
		if cohort != nil && *cohort != *row.IsSynthetic {
			return StudyReport{}, errors.New("mixed real and synthetic study rows")
		}
		cohort = row.IsSynthetic
		if participants[row.ParticipantID] == nil {
			participants[row.ParticipantID] = map[string]StudyRow{}
		}
		for _, prior := range participants[row.ParticipantID] {
			if prior.Strategy == row.Strategy || prior.Order == row.Order {
				return StudyReport{}, errors.New("repeated strategy or order for participant")
			}
		}
		participants[row.ParticipantID][row.Strategy] = row
		sessions[row.SessionID] = true
		summary := output.ByStrategy[row.Strategy]
		summary.Sessions++
		summary.MeanRelevance += float64(row.RelevanceRating)
		summary.MeanCoherence += float64(row.CoherenceRating)
		if row.Before != nil {
			summary.MoodPairs++
			if summary.MeanValenceChange == nil {
				summary.MeanValenceChange = new(float64)
				summary.MeanArousalChange = new(float64)
			}
			*summary.MeanValenceChange += row.After.Valence - row.Before.Valence
			*summary.MeanArousalChange += row.After.Arousal - row.Before.Arousal
		}
		output.ByStrategy[row.Strategy] = summary
		counts := output.OrderCounts[row.Strategy]
		counts[row.Order-1]++
		output.OrderCounts[row.Strategy] = counts
	}
	if err := scanner.Err(); err != nil {
		return StudyReport{}, err
	}
	if len(sessions) == 0 {
		return StudyReport{}, errors.New("no study sessions")
	}
	output.Synthetic = *cohort
	output.Participants = len(participants)
	for _, rows := range participants {
		if len(rows) == 3 {
			output.CompleteTriplets++
		}
	}
	for name, summary := range output.ByStrategy {
		summary.MeanRelevance /= float64(summary.Sessions)
		summary.MeanCoherence /= float64(summary.Sessions)
		if summary.MoodPairs > 0 {
			*summary.MeanValenceChange /= float64(summary.MoodPairs)
			*summary.MeanArousalChange /= float64(summary.MoodPairs)
		}
		output.ByStrategy[name] = summary
	}
	if output.Synthetic {
		output.Note = "Synthetic study-format check only; no participant outcome can be inferred."
	} else {
		output.Note = "Descriptive, self-reported outcomes; no causal or therapeutic claim. Inspect order balance and dropout before interpretation."
	}
	return output, nil
}
func validStudyMood(m sequence.Mood) bool {
	return !math.IsNaN(m.Valence) && !math.IsInf(m.Valence, 0) && m.Valence >= 0 && m.Valence <= 1 && !math.IsNaN(m.Arousal) && !math.IsInf(m.Arousal, 0) && m.Arousal >= 0 && m.Arousal <= 1
}
