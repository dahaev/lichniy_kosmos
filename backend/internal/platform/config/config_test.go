package config

import (
	"log/slog"
	"strings"
	"testing"
	"time"
)

func env(m map[string]string) func(string) string {
	return func(k string) string { return m[k] }
}

func TestLoadDefaults(t *testing.T) {
	cfg, err := Load(env(map[string]string{"COSMOS_DATABASE_URL": "postgres://localhost/cosmos"}))
	if err != nil {
		t.Fatalf("Load: %v", err)
	}

	if cfg.Env != EnvLocal {
		t.Errorf("Env = %q, want local", cfg.Env)
	}
	if cfg.HTTPAddr != ":8080" {
		t.Errorf("HTTPAddr = %q", cfg.HTTPAddr)
	}
	if cfg.DBMaxConns != 10 {
		t.Errorf("DBMaxConns = %d", cfg.DBMaxConns)
	}
	if cfg.LogLevel != slog.LevelInfo || cfg.LogFormat != LogJSON {
		t.Errorf("log = %v/%v", cfg.LogLevel, cfg.LogFormat)
	}
	if cfg.ShutdownTimeout != 30*time.Second || cfg.ReadyTimeout != 2*time.Second {
		t.Errorf("timeouts = %v/%v", cfg.ShutdownTimeout, cfg.ReadyTimeout)
	}
}

func TestLoadOverrides(t *testing.T) {
	cfg, err := Load(env(map[string]string{
		"COSMOS_ENV":              "staging",
		"COSMOS_HTTP_ADDR":        "127.0.0.1:9000",
		"COSMOS_DATABASE_URL":     "postgres://localhost/cosmos",
		"COSMOS_DB_MAX_CONNS":     "4",
		"COSMOS_LOG_LEVEL":        "debug",
		"COSMOS_LOG_FORMAT":       "text",
		"COSMOS_SHUTDOWN_TIMEOUT": "90s",
		"COSMOS_READY_TIMEOUT":    "500ms",
	}))
	if err != nil {
		t.Fatalf("Load: %v", err)
	}

	if cfg.Env != EnvStaging || cfg.HTTPAddr != "127.0.0.1:9000" || cfg.DBMaxConns != 4 {
		t.Errorf("unexpected cfg: %+v", cfg)
	}
	if cfg.LogLevel != slog.LevelDebug || cfg.LogFormat != LogText {
		t.Errorf("log = %v/%v", cfg.LogLevel, cfg.LogFormat)
	}
	if cfg.ShutdownTimeout != 90*time.Second || cfg.ReadyTimeout != 500*time.Millisecond {
		t.Errorf("timeouts = %v/%v", cfg.ShutdownTimeout, cfg.ReadyTimeout)
	}
}

func TestLoadErrors(t *testing.T) {
	tests := []struct {
		name string
		env  map[string]string
		want []string
	}{
		{
			name: "missing database url",
			env:  map[string]string{},
			want: []string{"COSMOS_DATABASE_URL"},
		},
		{
			name: "all invalid values reported together",
			env: map[string]string{
				"COSMOS_DATABASE_URL":     "postgres://localhost/cosmos",
				"COSMOS_ENV":              "prod",
				"COSMOS_LOG_FORMAT":       "xml",
				"COSMOS_LOG_LEVEL":        "loud",
				"COSMOS_DB_MAX_CONNS":     "0",
				"COSMOS_SHUTDOWN_TIMEOUT": "-1s",
				"COSMOS_READY_TIMEOUT":    "soon",
			},
			want: []string{
				"COSMOS_ENV", "COSMOS_LOG_FORMAT", "COSMOS_LOG_LEVEL",
				"COSMOS_DB_MAX_CONNS", "COSMOS_SHUTDOWN_TIMEOUT", "COSMOS_READY_TIMEOUT",
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			_, err := Load(env(tt.env))
			if err == nil {
				t.Fatal("expected error")
			}
			for _, key := range tt.want {
				if !strings.Contains(err.Error(), key) {
					t.Errorf("error %q does not mention %s", err, key)
				}
			}
		})
	}
}

func TestDatabaseURLIsRedacted(t *testing.T) {
	cfg, err := Load(env(map[string]string{"COSMOS_DATABASE_URL": "postgres://u:topsecret@db/cosmos"}))
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if strings.Contains(cfg.DatabaseURL.String(), "topsecret") {
		t.Error("DatabaseURL leaks through String()")
	}
}
