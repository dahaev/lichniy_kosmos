package postgres

import (
	"context"
	"database/sql"
	"fmt"
	"io/fs"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/jackc/pgx/v5/stdlib"
	"github.com/pressly/goose/v3"
)

// Migrator applies and inspects goose SQL migrations over the shared pool.
type Migrator struct {
	db       *sql.DB
	provider *goose.Provider
}

// NewMigrator builds a migrator for the migration files in fsys.
func NewMigrator(pool *pgxpool.Pool, fsys fs.FS) (*Migrator, error) {
	db := stdlib.OpenDBFromPool(pool)
	provider, err := goose.NewProvider(goose.DialectPostgres, db, fsys)
	if err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("migrations: %w", err)
	}
	return &Migrator{db: db, provider: provider}, nil
}

// Up applies all pending migrations and returns their human-readable results.
func (m *Migrator) Up(ctx context.Context) ([]string, error) {
	results, err := m.provider.Up(ctx)
	if err != nil {
		return nil, fmt.Errorf("migrations up: %w", err)
	}
	out := make([]string, 0, len(results))
	for _, r := range results {
		out = append(out, r.String())
	}
	return out, nil
}

// MigrationStatus describes one migration file and whether it is applied.
type MigrationStatus struct {
	Version int64
	Source  string
	Applied bool
}

// Status lists every known migration in version order.
func (m *Migrator) Status(ctx context.Context) ([]MigrationStatus, error) {
	statuses, err := m.provider.Status(ctx)
	if err != nil {
		return nil, fmt.Errorf("migrations status: %w", err)
	}
	out := make([]MigrationStatus, 0, len(statuses))
	for _, s := range statuses {
		out = append(out, MigrationStatus{
			Version: s.Source.Version,
			Source:  s.Source.Path,
			Applied: s.State == goose.StateApplied,
		})
	}
	return out, nil
}

// HasPending reports whether the database lags behind the embedded migrations.
func (m *Migrator) HasPending(ctx context.Context) (bool, error) {
	pending, err := m.provider.HasPending(ctx)
	if err != nil {
		return false, fmt.Errorf("migrations pending: %w", err)
	}
	return pending, nil
}

// Close releases the database/sql wrapper. The underlying pool stays open.
func (m *Migrator) Close() error {
	return m.db.Close()
}
