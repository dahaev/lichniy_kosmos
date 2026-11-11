// Package config loads process configuration from environment variables.
package config

import (
	"errors"
	"fmt"
	"log/slog"
	"strconv"
	"strings"
	"time"

	"github.com/dahaev/lichniy_kosmos/backend/internal/platform/secret"
)

// Environment names the deployment the process runs in.
type Environment string

// Supported environments.
const (
	EnvLocal      Environment = "local"
	EnvTest       Environment = "test"
	EnvStaging    Environment = "staging"
	EnvProduction Environment = "production"
)

// LogFormat selects the slog handler.
type LogFormat string

// Supported log formats.
const (
	LogJSON LogFormat = "json"
	LogText LogFormat = "text"
)

// Config is the full process configuration. It is built once in main and
// passed down explicitly.
type Config struct {
	Env             Environment
	HTTPAddr        string
	DatabaseURL     secret.String
	DBMaxConns      int32
	LogLevel        slog.Level
	LogFormat       LogFormat
	ShutdownTimeout time.Duration
	ReadyTimeout    time.Duration
}

// Load reads configuration through getenv (os.Getenv in production, a map in tests).
// All problems are reported together so a misconfigured deploy fails once, loudly.
func Load(getenv func(string) string) (Config, error) {
	cfg := Config{
		Env:             Environment(valueOr(getenv, "COSMOS_ENV", string(EnvLocal))),
		HTTPAddr:        valueOr(getenv, "COSMOS_HTTP_ADDR", ":8080"),
		DatabaseURL:     secret.New(getenv("COSMOS_DATABASE_URL")),
		LogFormat:       LogFormat(valueOr(getenv, "COSMOS_LOG_FORMAT", string(LogJSON))),
		DBMaxConns:      10,
		ShutdownTimeout: 30 * time.Second,
		ReadyTimeout:    2 * time.Second,
	}

	var errs []error

	switch cfg.Env {
	case EnvLocal, EnvTest, EnvStaging, EnvProduction:
	default:
		errs = append(errs, fmt.Errorf("COSMOS_ENV: unknown environment %q", cfg.Env))
	}

	if cfg.DatabaseURL.IsZero() {
		errs = append(errs, errors.New("COSMOS_DATABASE_URL: required"))
	}

	switch cfg.LogFormat {
	case LogJSON, LogText:
	default:
		errs = append(errs, fmt.Errorf("COSMOS_LOG_FORMAT: want json or text, got %q", cfg.LogFormat))
	}

	if err := cfg.LogLevel.UnmarshalText([]byte(valueOr(getenv, "COSMOS_LOG_LEVEL", "info"))); err != nil {
		errs = append(errs, fmt.Errorf("COSMOS_LOG_LEVEL: %w", err))
	}

	if v := getenv("COSMOS_DB_MAX_CONNS"); v != "" {
		n, err := strconv.ParseInt(v, 10, 32)
		if err != nil || n < 1 {
			errs = append(errs, fmt.Errorf("COSMOS_DB_MAX_CONNS: want positive integer, got %q", v))
		} else {
			cfg.DBMaxConns = int32(n)
		}
	}

	durations := []struct {
		key string
		dst *time.Duration
	}{
		{key: "COSMOS_SHUTDOWN_TIMEOUT", dst: &cfg.ShutdownTimeout},
		{key: "COSMOS_READY_TIMEOUT", dst: &cfg.ReadyTimeout},
	}
	for _, d := range durations {
		v := getenv(d.key)
		if v == "" {
			continue
		}
		parsed, err := time.ParseDuration(v)
		if err != nil || parsed <= 0 {
			errs = append(errs, fmt.Errorf("%s: want positive duration, got %q", d.key, v))
			continue
		}
		*d.dst = parsed
	}

	if err := errors.Join(errs...); err != nil {
		return Config{}, err
	}
	return cfg, nil
}

func valueOr(getenv func(string) string, key, fallback string) string {
	if v := strings.TrimSpace(getenv(key)); v != "" {
		return v
	}
	return fallback
}
