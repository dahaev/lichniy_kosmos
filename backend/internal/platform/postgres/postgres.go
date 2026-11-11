// Package postgres owns the pgx connection pool and schema migrations.
package postgres

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/dahaev/lichniy_kosmos/backend/internal/platform/secret"
)

// Open creates a connection pool. Connections are established lazily, so the
// process can start while the database is still unavailable; readiness
// reports the actual state.
func Open(ctx context.Context, url secret.String, maxConns int32) (*pgxpool.Pool, error) {
	cfg, err := pgxpool.ParseConfig(url.Reveal())
	if err != nil {
		// pgx error messages may echo the DSN; do not wrap them.
		return nil, fmt.Errorf("postgres: invalid COSMOS_DATABASE_URL")
	}
	cfg.MaxConns = maxConns

	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		return nil, fmt.Errorf("postgres: create pool: %w", err)
	}
	return pool, nil
}
