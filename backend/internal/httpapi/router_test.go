package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func discardLogger() *slog.Logger {
	return slog.New(slog.NewTextHandler(io.Discard, nil))
}

func okCheck(name string) Check {
	return Check{Name: name, Run: func(context.Context) error { return nil }}
}

func failCheck(name string) Check {
	return Check{Name: name, Run: func(context.Context) error { return errors.New("dial tcp 10.0.0.5:5432: secret-host") }}
}

func newTestHandler(checks ...Check) http.Handler {
	return NewHandler(Options{
		Logger:       discardLogger(),
		Checks:       checks,
		ReadyTimeout: 200 * time.Millisecond,
		Public:       PublicConfig{Environment: "test"},
	})
}

func do(t *testing.T, h http.Handler, method, path string) *httptest.ResponseRecorder {
	t.Helper()
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(method, path, nil))
	return rec
}

func TestHealthz(t *testing.T) {
	rec := do(t, newTestHandler(), http.MethodGet, "/healthz")

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d", rec.Code)
	}
	if body := strings.TrimSpace(rec.Body.String()); body != `{"status":"ok"}` {
		t.Errorf("body = %s", body)
	}
}

func TestReadyz(t *testing.T) {
	tests := []struct {
		name       string
		checks     []Check
		wantStatus int
		wantBody   readinessResponse
	}{
		{
			name:       "all checks pass",
			checks:     []Check{okCheck("postgres"), okCheck("migrations")},
			wantStatus: http.StatusOK,
			wantBody:   readinessResponse{Status: "ready", Checks: map[string]string{"postgres": "ok", "migrations": "ok"}},
		},
		{
			name:       "one check fails",
			checks:     []Check{okCheck("postgres"), failCheck("migrations")},
			wantStatus: http.StatusServiceUnavailable,
			wantBody:   readinessResponse{Status: "not_ready", Checks: map[string]string{"postgres": "ok", "migrations": "fail"}},
		},
		{
			name: "check exceeding timeout fails",
			checks: []Check{{Name: "postgres", Run: func(ctx context.Context) error {
				<-ctx.Done()
				return ctx.Err()
			}}},
			wantStatus: http.StatusServiceUnavailable,
			wantBody:   readinessResponse{Status: "not_ready", Checks: map[string]string{"postgres": "fail"}},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			rec := do(t, newTestHandler(tt.checks...), http.MethodGet, "/readyz")

			if rec.Code != tt.wantStatus {
				t.Fatalf("status = %d, want %d", rec.Code, tt.wantStatus)
			}
			if strings.Contains(rec.Body.String(), "secret-host") {
				t.Error("readiness response leaks error details")
			}
			var got readinessResponse
			if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
				t.Fatalf("decode: %v", err)
			}
			if got.Status != tt.wantBody.Status || len(got.Checks) != len(tt.wantBody.Checks) {
				t.Fatalf("body = %+v, want %+v", got, tt.wantBody)
			}
			for k, v := range tt.wantBody.Checks {
				if got.Checks[k] != v {
					t.Errorf("checks[%s] = %q, want %q", k, got.Checks[k], v)
				}
			}
		})
	}
}

func TestConfig(t *testing.T) {
	rec := do(t, newTestHandler(), http.MethodGet, "/api/v1/config")

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d", rec.Code)
	}
	var got PublicConfig
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if got.Environment != "test" || got.Features != (Features{}) {
		t.Errorf("config = %+v", got)
	}
}

func TestUnknownAPIRouteReturnsProblem(t *testing.T) {
	rec := do(t, newTestHandler(), http.MethodGet, "/api/v1/nope")

	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d", rec.Code)
	}
	if ct := rec.Header().Get("Content-Type"); ct != "application/problem+json" {
		t.Errorf("content-type = %q", ct)
	}
	var p Problem
	if err := json.Unmarshal(rec.Body.Bytes(), &p); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if p.Code != codeNotFound || p.Status != http.StatusNotFound {
		t.Errorf("problem = %+v", p)
	}
	if p.RequestID == "" || p.RequestID != rec.Header().Get("X-Request-Id") {
		t.Errorf("request id mismatch: body %q header %q", p.RequestID, rec.Header().Get("X-Request-Id"))
	}
}

func TestSecurityHeaders(t *testing.T) {
	rec := do(t, newTestHandler(), http.MethodGet, "/healthz")

	want := map[string]string{
		"Cache-Control":          "no-store",
		"X-Content-Type-Options": "nosniff",
		"Referrer-Policy":        "no-referrer",
		"X-Frame-Options":        "DENY",
	}
	for k, v := range want {
		if got := rec.Header().Get(k); got != v {
			t.Errorf("%s = %q, want %q", k, got, v)
		}
	}
}

func TestRequestIDIsNotTakenFromClient(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/healthz", nil)
	req.Header.Set("X-Request-Id", "attacker-chosen")
	rec := httptest.NewRecorder()
	newTestHandler().ServeHTTP(rec, req)

	if got := rec.Header().Get("X-Request-Id"); got == "attacker-chosen" || len(got) != 32 {
		t.Errorf("X-Request-Id = %q", got)
	}
}

func TestPanicIsRecoveredAsProblem(t *testing.T) {
	h := chain(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
		panic("boom")
	}), withRequestID, withRecover(discardLogger()))

	rec := do(t, h, http.MethodGet, "/api/v1/config")

	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d", rec.Code)
	}
	var p Problem
	if err := json.Unmarshal(rec.Body.Bytes(), &p); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if p.Code != codeInternalError || strings.Contains(rec.Body.String(), "boom") {
		t.Errorf("problem = %s", rec.Body.String())
	}
}

func TestBodyLimit(t *testing.T) {
	var readErr error
	h := chain(http.HandlerFunc(func(_ http.ResponseWriter, r *http.Request) {
		_, readErr = io.ReadAll(r.Body)
	}), withBodyLimit)

	req := httptest.NewRequest(http.MethodPost, "/api/v1/x", strings.NewReader(strings.Repeat("a", maxBodyBytes+1)))
	h.ServeHTTP(httptest.NewRecorder(), req)

	var maxErr *http.MaxBytesError
	if !errors.As(readErr, &maxErr) {
		t.Errorf("read error = %v, want MaxBytesError", readErr)
	}
}
