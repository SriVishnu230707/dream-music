package session

import (
	"context"
	"database/sql"
	"embed"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/SriVishnu230707/dream-music/internal/sequence"
	_ "github.com/jackc/pgx/v5/stdlib"
)

//go:embed schema.sql
var schema embed.FS

var ErrNotFound = errors.New("session not found")
var ErrConflict = errors.New("session revision conflict")

type Record struct {
	ID           string               `json:"sessionId"`
	UserID       string               `json:"userId"`
	CatalogID    string               `json:"catalogId"`
	Queue        []sequence.QueueItem `json:"queue"`
	CurrentIndex int                  `json:"currentIndex"`
	Status       string               `json:"status"`
	LastAction   *string              `json:"lastAction"`
	Revision     int                  `json:"revision"`
	CreatedAt    time.Time            `json:"createdAt"`
	UpdatedAt    time.Time            `json:"updatedAt"`
}

type Store interface {
	Create(context.Context, Record) (Record, error)
	Get(context.Context, string) (Record, error)
	Advance(context.Context, string, int, string) (Record, error)
}

type Postgres struct{ db *sql.DB }

func Open(ctx context.Context, dsn string) (*Postgres, error) {
	if dsn == "" {
		return nil, errors.New("DATABASE_URL is required")
	}
	db, err := sql.Open("pgx", dsn)
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(8)
	db.SetMaxIdleConns(4)
	db.SetConnMaxLifetime(30 * time.Minute)
	if err = db.PingContext(ctx); err != nil {
		db.Close()
		return nil, fmt.Errorf("connect PostgreSQL: %w", err)
	}
	migration, _ := schema.ReadFile("schema.sql")
	if _, err = db.ExecContext(ctx, string(migration)); err != nil {
		db.Close()
		return nil, fmt.Errorf("migrate: %w", err)
	}
	return &Postgres{db: db}, nil
}
func (s *Postgres) Close() error { return s.db.Close() }

func (s *Postgres) Create(ctx context.Context, r Record) (Record, error) {
	raw, err := json.Marshal(r.Queue)
	if err != nil {
		return Record{}, err
	}
	err = s.db.QueryRowContext(ctx, `INSERT INTO listening_sessions(id,user_id,catalog_id,queue,current_index,status,revision)
 VALUES($1,$2,$3,$4,0,'ready',1) RETURNING created_at,updated_at`, r.ID, r.UserID, r.CatalogID, raw).Scan(&r.CreatedAt, &r.UpdatedAt)
	if err != nil {
		return Record{}, err
	}
	r.CurrentIndex = 0
	r.Status = "ready"
	r.Revision = 1
	return r, nil
}

func scanRecord(row *sql.Row) (Record, error) {
	var r Record
	var raw []byte
	err := row.Scan(&r.ID, &r.UserID, &r.CatalogID, &raw, &r.CurrentIndex, &r.Status, &r.LastAction, &r.Revision, &r.CreatedAt, &r.UpdatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return Record{}, ErrNotFound
	}
	if err != nil {
		return Record{}, err
	}
	if err = json.Unmarshal(raw, &r.Queue); err != nil {
		return Record{}, err
	}
	return r, nil
}

const columns = `id,user_id,catalog_id,queue,current_index,status,last_action,revision,created_at,updated_at`

func (s *Postgres) Get(ctx context.Context, id string) (Record, error) {
	return scanRecord(s.db.QueryRowContext(ctx, `SELECT `+columns+` FROM listening_sessions WHERE id=$1`, id))
}

func (s *Postgres) Advance(ctx context.Context, id string, revision int, action string) (Record, error) {
	// A conditional update makes retry and double-click safe. Queue content is immutable in Phase 5.
	row := s.db.QueryRowContext(ctx, `UPDATE listening_sessions SET current_index=current_index+1,
 status=CASE WHEN current_index+1>=jsonb_array_length(queue) THEN 'completed' ELSE 'active' END,
 last_action=$3,
 revision=revision+1,updated_at=now()
 WHERE id=$1 AND revision=$2 AND status<>'completed' AND current_index<jsonb_array_length(queue)
 RETURNING `+columns, id, revision, action)
	r, err := scanRecord(row)
	if errors.Is(err, ErrNotFound) {
		_, lookupErr := s.Get(ctx, id)
		if errors.Is(lookupErr, ErrNotFound) {
			return Record{}, ErrNotFound
		}
		if lookupErr != nil {
			return Record{}, lookupErr
		}
		return Record{}, ErrConflict
	}
	return r, err
}
