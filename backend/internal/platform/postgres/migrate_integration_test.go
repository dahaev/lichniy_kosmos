package postgres

import (
	"context"
	"os"
	"testing"
	"time"

	"github.com/dahaev/lichniy_kosmos/backend/internal/platform/secret"
	"github.com/dahaev/lichniy_kosmos/backend/migrations"
)

// TestMigrationsAgainstPostgres needs a disposable database:
// COSMOS_TEST_DATABASE_URL=postgres://cosmos:cosmos@localhost:55432/cosmos_test?sslmode=disable
func TestMigrationsAgainstPostgres(t *testing.T) {
	url := os.Getenv("COSMOS_TEST_DATABASE_URL")
	if url == "" {
		t.Skip("COSMOS_TEST_DATABASE_URL not set; run `make test-integration`")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	pool, err := Open(ctx, secret.New(url), 2)
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	defer pool.Close()
	if err := pool.Ping(ctx); err != nil {
		t.Fatalf("Ping: %v", err)
	}

	m, err := NewMigrator(pool, migrations.FS)
	if err != nil {
		t.Fatalf("NewMigrator: %v", err)
	}
	defer func() { _ = m.Close() }()

	if _, err := m.Up(ctx); err != nil {
		t.Fatalf("Up: %v", err)
	}
	again, err := m.Up(ctx)
	if err != nil {
		t.Fatalf("second Up: %v", err)
	}
	if len(again) != 0 {
		t.Errorf("second Up applied %v, want nothing", again)
	}

	pending, err := m.HasPending(ctx)
	if err != nil || pending {
		t.Fatalf("HasPending = %v, %v; want false, nil", pending, err)
	}

	statuses, err := m.Status(ctx)
	if err != nil {
		t.Fatalf("Status: %v", err)
	}
	for _, s := range statuses {
		if !s.Applied {
			t.Errorf("migration %d not applied", s.Version)
		}
	}

	wantSchemas := []string{"identity", "access", "intake", "places", "orders", "generation", "artifacts", "audit", "ops"}
	var count int
	err = pool.QueryRow(ctx,
		`SELECT count(*) FROM information_schema.schemata WHERE schema_name = ANY($1)`, wantSchemas,
	).Scan(&count)
	if err != nil {
		t.Fatalf("query schemas: %v", err)
	}
	if count != len(wantSchemas) {
		t.Errorf("found %d module schemas, want %d", count, len(wantSchemas))
	}
}
