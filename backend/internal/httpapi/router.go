// Package httpapi is the HTTP transport: routing, middleware, DTOs and
// problem+json errors over module services. Business rules live in modules.
package httpapi

import (
	"log/slog"
	"net/http"
	"time"
)

// Options configures the HTTP handler.
type Options struct {
	Logger       *slog.Logger
	Checks       []Check
	ReadyTimeout time.Duration
	Public       PublicConfig
}

// NewHandler returns the root handler for health probes and /api/v1.
func NewHandler(opts Options) http.Handler {
	mux := http.NewServeMux()

	mux.HandleFunc("GET /healthz", handleHealthz)
	mux.HandleFunc("GET /readyz", handleReadyz(opts.Logger, opts.Checks, opts.ReadyTimeout))
	mux.HandleFunc("GET /api/v1/config", handleConfig(opts.Public))

	mux.HandleFunc("/api/", func(w http.ResponseWriter, r *http.Request) {
		writeProblem(w, r, http.StatusNotFound, codeNotFound, "Ресурс не найден.")
	})

	return chain(mux,
		withRequestID,
		withAccessLog(opts.Logger),
		withRecover(opts.Logger),
		withSecurityHeaders,
		withBodyLimit,
	)
}
