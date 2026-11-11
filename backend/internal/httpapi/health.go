package httpapi

import (
	"context"
	"log/slog"
	"net/http"
	"sync"
	"time"
)

// Check is one readiness probe, e.g. a PostgreSQL ping.
type Check struct {
	Name string
	Run  func(ctx context.Context) error
}

type healthResponse struct {
	Status string `json:"status"`
}

type readinessResponse struct {
	Status string            `json:"status"`
	Checks map[string]string `json:"checks"`
}

const (
	checkOK   = "ok"
	checkFail = "fail"
)

func handleHealthz(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, healthResponse{Status: "ok"})
}

// handleReadyz runs all checks concurrently under one timeout. Failure details
// go to the log only: the endpoint is public.
func handleReadyz(log *slog.Logger, checks []Check, timeout time.Duration) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ctx, cancel := context.WithTimeout(r.Context(), timeout)
		defer cancel()

		results := make(map[string]string, len(checks))
		var (
			mu sync.Mutex
			wg sync.WaitGroup
		)
		for _, c := range checks {
			wg.Go(func() {
				state := checkOK
				if err := c.Run(ctx); err != nil {
					state = checkFail
					log.WarnContext(ctx, "readiness check failed", slog.String("check", c.Name), slog.Any("error", err))
				}
				mu.Lock()
				results[c.Name] = state
				mu.Unlock()
			})
		}
		wg.Wait()

		resp := readinessResponse{Status: "ready", Checks: results}
		status := http.StatusOK
		for _, state := range results {
			if state != checkOK {
				resp.Status = "not_ready"
				status = http.StatusServiceUnavailable
				break
			}
		}
		writeJSON(w, status, resp)
	}
}
