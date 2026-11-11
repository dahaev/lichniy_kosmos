// Package observability builds the process logger and carries request-scoped
// identifiers through context.
package observability

import (
	"context"
	"io"
	"log/slog"
)

// NewLogger returns a JSON or text slog logger writing to w.
func NewLogger(w io.Writer, level slog.Level, text bool) *slog.Logger {
	opts := &slog.HandlerOptions{Level: level}
	if text {
		return slog.New(slog.NewTextHandler(w, opts))
	}
	return slog.New(slog.NewJSONHandler(w, opts))
}

type requestIDKey struct{}

// WithRequestID stores the request id in ctx.
func WithRequestID(ctx context.Context, id string) context.Context {
	return context.WithValue(ctx, requestIDKey{}, id)
}

// RequestID returns the request id stored in ctx, or an empty string.
func RequestID(ctx context.Context) string {
	id, _ := ctx.Value(requestIDKey{}).(string)
	return id
}
