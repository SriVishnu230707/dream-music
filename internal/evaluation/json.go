package evaluation

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"strings"
)

// Reject ambiguous JSON before Go's struct decoder silently accepts the last key.
func uniqueJSON(raw []byte) error {
	dec := json.NewDecoder(bytes.NewReader(raw))
	if err := walkJSON(dec); err != nil {
		return err
	}
	if _, err := dec.Token(); !errors.Is(err, io.EOF) {
		return errors.New("trailing JSON data")
	}
	return nil
}

func walkJSON(dec *json.Decoder) error {
	token, err := dec.Token()
	if err != nil {
		return err
	}
	delim, ok := token.(json.Delim)
	if !ok {
		return nil
	}
	switch delim {
	case '{':
		seen := map[string]bool{}
		for dec.More() {
			keyToken, err := dec.Token()
			if err != nil {
				return err
			}
			key, ok := keyToken.(string)
			if !ok {
				return errors.New("invalid object key")
			}
			folded := strings.ToLower(key)
			if seen[folded] {
				return errors.New("duplicate JSON field")
			}
			seen[folded] = true
			if err := walkJSON(dec); err != nil {
				return err
			}
		}
	case '[':
		for dec.More() {
			if err := walkJSON(dec); err != nil {
				return err
			}
		}
	default:
		return errors.New("unexpected JSON delimiter")
	}
	_, err = dec.Token()
	return err
}
