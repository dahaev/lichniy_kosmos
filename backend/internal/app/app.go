// Package app is the composition root: it wires platform services and module
// adapters together and owns the process lifecycle of every cosmos role.
package app

import (
	"context"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"time"

	"github.com/dahaev/lichniy_kosmos/backend/internal/httpapi"
	"github.com/dahaev/lichniy_kosmos/backend/internal/platform/config"
	"github.com/dahaev/lichniy_kosmos/backend/internal/platform/postgres"
	"github.com/dahaev/lichniy_kosmos/backend/migrations"
)

var errPendingMigrations = errors.New("database schema has pending migrations")

// Serve runs the HTTP API until ctx is cancelled, then shuts down gracefully.
func Serve(ctx context.Context, cfg config.Config, log *slog.Logger) error {
	pool, err := postgres.Open(ctx, cfg.DatabaseURL, cfg.DBMaxConns)
	if err != nil {
		return err
	}
	defer pool.Close()

	migrator, err := postgres.NewMigrator(pool, migrations.FS)
	if err != nil {
		return err
	}
	defer func() { _ = migrator.Close() }()

	handler := httpapi.NewHandler(httpapi.Options{
		Logger:       log,
		ReadyTimeout: cfg.ReadyTimeout,
		Checks: []httpapi.Check{
			{Name: "postgres", Run: pool.Ping},
			{Name: "migrations", Run: func(ctx context.Context) error {
				pending, err := migrator.HasPending(ctx)
				if err != nil {
					return err
				}
				if pending {
					return errPendingMigrations
				}
				return nil
			}},
		},
		Public: httpapi.PublicConfig{Environment: string(cfg.Env)},
	})

	srv := &http.Server{
		Addr:              cfg.HTTPAddr,
		Handler:           handler,
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       15 * time.Second,
		WriteTimeout:      30 * time.Second,
		IdleTimeout:       60 * time.Second,
		ErrorLog:          slog.NewLogLogger(log.Handler(), slog.LevelError),
	}

	serveErr := make(chan error, 1)
	go func() {
		log.Info("http server listening", slog.String("addr", cfg.HTTPAddr), slog.String("env", string(cfg.Env)))
		serveErr <- srv.ListenAndServe()
	}()

	select {
	case err := <-serveErr:
		if errors.Is(err, http.ErrServerClosed) {
			return nil
		}
		return fmt.Errorf("http server: %w", err)
	case <-ctx.Done():
	}

	log.Info("shutting down", slog.Duration("timeout", cfg.ShutdownTimeout))
	shutdownCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), cfg.ShutdownTimeout)
	defer cancel()
	if err := srv.Shutdown(shutdownCtx); err != nil {
		return fmt.Errorf("http shutdown: %w", err)
	}
	return nil
}

// Migrate runs `migrate up` or `migrate status` and prints the outcome to out.
func Migrate(ctx context.Context, cfg config.Config, out io.Writer, args []string) error {
	if len(args) != 1 || (args[0] != "up" && args[0] != "status") {
		return errors.New("usage: cosmos migrate up|status")
	}

	pool, err := postgres.Open(ctx, cfg.DatabaseURL, cfg.DBMaxConns)
	if err != nil {
		return err
	}
	defer pool.Close()

	migrator, err := postgres.NewMigrator(pool, migrations.FS)
	if err != nil {
		return err
	}
	defer func() { _ = migrator.Close() }()

	if args[0] == "up" {
		applied, err := migrator.Up(ctx)
		if err != nil {
			return err
		}
		if len(applied) == 0 {
			_, err = fmt.Fprintln(out, "no pending migrations")
			return err
		}
		for _, line := range applied {
			if _, err := fmt.Fprintln(out, line); err != nil {
				return err
			}
		}
		return nil
	}

	statuses, err := migrator.Status(ctx)
	if err != nil {
		return err
	}
	for _, s := range statuses {
		state := "pending"
		if s.Applied {
			state = "applied"
		}
		if _, err := fmt.Fprintf(out, "%05d  %-8s %s\n", s.Version, state, s.Source); err != nil {
			return err
		}
	}
	return nil
}
