package secret

import (
	"bytes"
	"encoding/json"
	"fmt"
	"log/slog"
	"strings"
	"testing"
)

func TestStringNeverLeaks(t *testing.T) {
	const raw = "postgres://user:hunter2@db/cosmos"
	s := New(raw)

	if got := s.Reveal(); got != raw {
		t.Fatalf("Reveal() = %q, want raw value", got)
	}

	var logBuf bytes.Buffer
	slog.New(slog.NewJSONHandler(&logBuf, nil)).Info("connect", "dsn", s)

	jsonOut, err := json.Marshal(struct{ DSN String }{DSN: s})
	if err != nil {
		t.Fatalf("json.Marshal: %v", err)
	}

	outputs := map[string]string{
		"%s":   fmt.Sprintf("dsn=%s", s),
		"%v":   fmt.Sprintf("dsn=%v", s),
		"%+v":  fmt.Sprintf("%+v", struct{ DSN String }{DSN: s}),
		"%#v":  fmt.Sprintf("%#v", s),
		"slog": logBuf.String(),
		"json": string(jsonOut),
	}
	for name, out := range outputs {
		if strings.Contains(out, "hunter2") {
			t.Errorf("%s output leaks secret: %s", name, out)
		}
		if !strings.Contains(out, redacted) {
			t.Errorf("%s output lacks redaction marker: %s", name, out)
		}
	}
}

func TestIsZero(t *testing.T) {
	if !New("").IsZero() {
		t.Error("empty secret must be zero")
	}
	if New("x").IsZero() {
		t.Error("non-empty secret must not be zero")
	}
}
