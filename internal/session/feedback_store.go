package session

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/SriVishnu230707/dream-music/internal/taste"
)

var ErrInvalid = errors.New("invalid session input")

func (s *Postgres) ApplyEvent(ctx context.Context, c taste.Catalog, input EventInput) (EventResult, error) {
	payload, err := json.Marshal(input)
	if err != nil {
		return EventResult{}, err
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return EventResult{}, err
	}
	defer tx.Rollback()
	r, err := scanRecord(tx.QueryRowContext(ctx, `SELECT `+columns+` FROM listening_sessions WHERE id=$1 AND expires_at>now() FOR UPDATE`, input.SessionID))
	if err != nil {
		return EventResult{}, err
	}
	var same bool
	var saved []byte
	err = tx.QueryRowContext(ctx, `SELECT payload=$3::jsonb,result FROM session_events WHERE session_id=$1 AND event_id=$2`, r.ID, input.EventID, payload).Scan(&same, &saved)
	if err == nil {
		if !same {
			return EventResult{}, ErrConflict
		}
		var result EventResult
		if err := json.Unmarshal(saved, &result); err != nil {
			return EventResult{}, err
		}
		// A retry must never disclose a check-in that has since been deleted.
		result.Session = r
		result.Revision = r.Revision
		return result, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return EventResult{}, err
	}
	history, err := eventsTx(ctx, tx, r.ID)
	if err != nil {
		return EventResult{}, err
	}
	updated, result, err := applyEvent(c, r, history, input)
	if err != nil {
		if errors.Is(err, ErrConflict) {
			return EventResult{}, err
		}
		return EventResult{}, fmt.Errorf("%w: %v", ErrInvalid, err)
	}
	queue, err := json.Marshal(updated.Queue)
	if err != nil {
		return EventResult{}, err
	}
	err = tx.QueryRowContext(ctx, `UPDATE listening_sessions SET queue=$2,current_index=$3,status=$4,last_action=$5,revision=$6,updated_at=now() WHERE id=$1 RETURNING updated_at`, r.ID, queue, updated.CurrentIndex, updated.Status, updated.LastAction, updated.Revision).Scan(&updated.UpdatedAt)
	if err != nil {
		return EventResult{}, err
	}
	result.Session = updated
	storedResult := result
	storedResult.Session = Record{}
	output, err := json.Marshal(storedResult)
	if err != nil {
		return EventResult{}, err
	}
	_, err = tx.ExecContext(ctx, `INSERT INTO session_events(session_id,event_id,track_id,event_type,payload,result) VALUES($1,$2,$3,$4,$5,$6)`, r.ID, input.EventID, input.TrackID, input.Type, payload, output)
	if err != nil {
		return EventResult{}, err
	}
	if err := tx.Commit(); err != nil {
		return EventResult{}, err
	}
	return result, nil
}

func eventsTx(ctx context.Context, tx *sql.Tx, id string) ([]EventInput, error) {
	rows, err := tx.QueryContext(ctx, `SELECT payload FROM session_events WHERE session_id=$1 ORDER BY accepted_at DESC,event_id DESC LIMIT 200`, id)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []EventInput{}
	for rows.Next() {
		var raw []byte
		var item EventInput
		if err := rows.Scan(&raw); err != nil {
			return nil, err
		}
		if err := json.Unmarshal(raw, &item); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	for left, right := 0, len(items)-1; left < right; left, right = left+1, right-1 {
		items[left], items[right] = items[right], items[left]
	}
	return items, nil
}

func (s *Postgres) ListEvents(ctx context.Context, id string) ([]AuditEvent, error) {
	if _, err := s.Get(ctx, id); err != nil {
		return nil, err
	}
	rows, err := s.db.QueryContext(ctx, `SELECT payload,accepted_at FROM session_events WHERE session_id=$1 ORDER BY accepted_at,event_id`, id)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	events := []AuditEvent{}
	for rows.Next() {
		var raw []byte
		var accepted time.Time
		var event EventInput
		if err := rows.Scan(&raw, &accepted); err != nil {
			return nil, err
		}
		if err := json.Unmarshal(raw, &event); err != nil {
			return nil, err
		}
		events = append(events, AuditEvent{EventInput: event, AcceptedAt: accepted})
	}
	return events, rows.Err()
}

func (s *Postgres) AddCheckIn(ctx context.Context, c taste.Catalog, id string, input CheckInInput) (Record, error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return Record{}, err
	}
	defer tx.Rollback()
	r, err := scanRecord(tx.QueryRowContext(ctx, `SELECT `+columns+` FROM listening_sessions WHERE id=$1 AND expires_at>now() FOR UPDATE`, id))
	if err != nil {
		return Record{}, err
	}
	history, err := eventsTx(ctx, tx, id)
	if err != nil {
		return Record{}, err
	}
	updated, err := applyCheckIn(c, r, history, input)
	if err != nil {
		if errors.Is(err, ErrConflict) {
			return Record{}, err
		}
		return Record{}, fmt.Errorf("%w: %v", ErrInvalid, err)
	}
	queue, err := json.Marshal(updated.Queue)
	if err != nil {
		return Record{}, err
	}
	mood, err := json.Marshal(updated.LastCheckIn)
	if err != nil {
		return Record{}, err
	}
	err = tx.QueryRowContext(ctx, `UPDATE listening_sessions SET queue=$2,last_check_in=$3,revision=$4,updated_at=now() WHERE id=$1 RETURNING updated_at`, id, queue, mood, updated.Revision).Scan(&updated.UpdatedAt)
	if err != nil {
		return Record{}, err
	}
	checkInID, err := sessionID()
	if err != nil {
		return Record{}, err
	}
	if _, err = tx.ExecContext(ctx, `INSERT INTO session_check_ins(id,session_id,mood) VALUES($1,$2,$3)`, "checkin-"+checkInID[8:], id, mood); err != nil {
		return Record{}, err
	}
	if err := tx.Commit(); err != nil {
		return Record{}, err
	}
	return updated, nil
}

func (s *Postgres) ListCheckIns(ctx context.Context, id string) ([]AuditCheckIn, error) {
	if _, err := s.Get(ctx, id); err != nil {
		return nil, err
	}
	rows, err := s.db.QueryContext(ctx, `SELECT id,mood,created_at FROM session_check_ins WHERE session_id=$1 ORDER BY created_at,id`, id)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []AuditCheckIn{}
	for rows.Next() {
		var item AuditCheckIn
		var raw []byte
		if err := rows.Scan(&item.ID, &raw, &item.CreatedAt); err != nil {
			return nil, err
		}
		if err := json.Unmarshal(raw, &item.Mood); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func (s *Postgres) ClearCheckIns(ctx context.Context, c taste.Catalog, id string, revision int) (Record, error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return Record{}, err
	}
	defer tx.Rollback()
	r, err := scanRecord(tx.QueryRowContext(ctx, `SELECT `+columns+` FROM listening_sessions WHERE id=$1 AND expires_at>now() FOR UPDATE`, id))
	if err != nil {
		return Record{}, err
	}
	history, err := eventsTx(ctx, tx, id)
	if err != nil {
		return Record{}, err
	}
	updated, err := clearCheckIns(c, r, history, revision)
	if err != nil {
		return Record{}, err
	}
	queue, err := json.Marshal(updated.Queue)
	if err != nil {
		return Record{}, err
	}
	if _, err = tx.ExecContext(ctx, `DELETE FROM session_check_ins WHERE session_id=$1`, id); err != nil {
		return Record{}, err
	}
	// Remove historical full-session snapshots saved by older builds.
	if _, err = tx.ExecContext(ctx, `UPDATE session_events SET result=result-'session' WHERE session_id=$1`, id); err != nil {
		return Record{}, err
	}
	err = tx.QueryRowContext(ctx, `UPDATE listening_sessions SET queue=$2,last_check_in=NULL,revision=$3,updated_at=now() WHERE id=$1 RETURNING updated_at`, id, queue, updated.Revision).Scan(&updated.UpdatedAt)
	if err != nil {
		return Record{}, err
	}
	if err := tx.Commit(); err != nil {
		return Record{}, err
	}
	return updated, nil
}

func (s *Postgres) DeleteSession(ctx context.Context, id string) error {
	result, err := s.db.ExecContext(ctx, `DELETE FROM listening_sessions WHERE id=$1`, id)
	if err != nil {
		return err
	}
	count, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if count == 0 {
		return ErrNotFound
	}
	return nil
}
