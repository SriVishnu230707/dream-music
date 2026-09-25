package session

import (
	"context"
	"database/sql"
	"embed"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/SriVishnu230707/dream-music/internal/sequence"
	"github.com/SriVishnu230707/dream-music/internal/taste"
	_ "github.com/jackc/pgx/v5/stdlib"
)

//go:embed schema.sql
var schema embed.FS

var ErrNotFound = errors.New("session not found")
var ErrConflict = errors.New("session revision conflict")

type Record struct {
	ID            string               `json:"sessionId"`
	UserID        string               `json:"userId"`
	CatalogID     string               `json:"catalogId"`
	Queue         []sequence.QueueItem `json:"queue"`
	CurrentIndex  int                  `json:"currentIndex"`
	Status        string               `json:"status"`
	LastAction    *string              `json:"lastAction"`
	TargetMood    *sequence.Mood       `json:"targetMood,omitempty"`
	Taste         sequence.TasteInput  `json:"taste"`
	LastCheckIn   *sequence.StartMood  `json:"lastCheckIn,omitempty"`
	RetentionDays int                  `json:"retentionDays"`
	ExpiresAt     time.Time            `json:"expiresAt"`
	Revision      int                  `json:"revision"`
	CreatedAt     time.Time            `json:"createdAt"`
	UpdatedAt     time.Time            `json:"updatedAt"`
}

type Store interface {
	Create(context.Context, Record) (Record, error)
	Get(context.Context, string) (Record, error)
	ApplyEvent(context.Context, taste.Catalog, EventInput) (EventResult, error)
	ListEvents(context.Context, string) ([]AuditEvent, error)
	AddCheckIn(context.Context, taste.Catalog, string, CheckInInput) (Record, error)
	ListCheckIns(context.Context, string) ([]AuditCheckIn, error)
	ClearCheckIns(context.Context, taste.Catalog, string, int) (Record, error)
	DeleteSession(context.Context, string) error
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
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		db.Close()
		return nil, fmt.Errorf("begin migration: %w", err)
	}
	for _, statement := range strings.Split(string(migration), ";") {
		statement = strings.TrimSpace(statement)
		if statement == "" {
			continue
		}
		if _, err = tx.ExecContext(ctx, statement); err != nil {
			tx.Rollback()
			db.Close()
			return nil, fmt.Errorf("migrate: %w", err)
		}
	}
	if err = tx.Commit(); err != nil {
		db.Close()
		return nil, fmt.Errorf("commit migration: %w", err)
	}
	if _, err = db.ExecContext(ctx, `DELETE FROM listening_sessions WHERE expires_at <= now()`); err != nil {
		db.Close()
		return nil, fmt.Errorf("purge expired sessions: %w", err)
	}
	return &Postgres{db: db}, nil
}
func (s *Postgres) Close() error { return s.db.Close() }

func (s *Postgres) Create(ctx context.Context, r Record) (Record, error) {
	raw, err := json.Marshal(r.Queue)
	if err != nil {
		return Record{}, err
	}
	if r.RetentionDays == 0 {
		r.RetentionDays = 30
	}
	target, err := json.Marshal(r.TargetMood)
	if err != nil {
		return Record{}, err
	}
	tasteInput, err := json.Marshal(r.Taste)
	if err != nil {
		return Record{}, err
	}
	err = s.db.QueryRowContext(ctx, `INSERT INTO listening_sessions(id,user_id,catalog_id,queue,current_index,status,revision,target_mood,taste_input,retention_days,expires_at)
 VALUES($1,$2,$3,$4,0,'ready',1,$5,$6,$7,now()+$7*interval '1 day') RETURNING created_at,updated_at,expires_at`, r.ID, r.UserID, r.CatalogID, raw, target, tasteInput, r.RetentionDays).Scan(&r.CreatedAt, &r.UpdatedAt, &r.ExpiresAt)
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
	var raw, target, tasteInput, checkIn []byte
	err := row.Scan(&r.ID, &r.UserID, &r.CatalogID, &raw, &r.CurrentIndex, &r.Status, &r.LastAction, &r.Revision, &target, &tasteInput, &checkIn, &r.RetentionDays, &r.ExpiresAt, &r.CreatedAt, &r.UpdatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return Record{}, ErrNotFound
	}
	if err != nil {
		return Record{}, err
	}
	if err = json.Unmarshal(raw, &r.Queue); err != nil {
		return Record{}, err
	}
	if len(target) > 0 {
		if err = json.Unmarshal(target, &r.TargetMood); err != nil {
			return Record{}, err
		}
	}
	if len(tasteInput) > 0 {
		if err = json.Unmarshal(tasteInput, &r.Taste); err != nil {
			return Record{}, err
		}
	}
	if len(checkIn) > 0 {
		if err = json.Unmarshal(checkIn, &r.LastCheckIn); err != nil {
			return Record{}, err
		}
	}
	if r.Taste.PreferredGenres == nil {
		r.Taste.PreferredGenres = []string{}
	}
	if r.Taste.LikedTrackIDs == nil {
		r.Taste.LikedTrackIDs = []string{}
	}
	return r, nil
}

const columns = `id,user_id,catalog_id,queue,current_index,status,last_action,revision,target_mood,taste_input,last_check_in,retention_days,expires_at,created_at,updated_at`

func (s *Postgres) Get(ctx context.Context, id string) (Record, error) {
	return scanRecord(s.db.QueryRowContext(ctx, `SELECT `+columns+` FROM listening_sessions WHERE id=$1 AND expires_at>now()`, id))
}

func (s *Postgres) PurgeExpired(ctx context.Context) error {
	_, err := s.db.ExecContext(ctx, `DELETE FROM listening_sessions WHERE expires_at<=now()`)
	return err
}
