// Package secret provides a string wrapper that never leaks its value
// through formatting, logging or JSON encoding.
package secret

import "log/slog"

const redacted = "[REDACTED]"

// String holds a sensitive value such as a DSN, API key or HMAC key.
// The zero value is an empty secret.
type String struct {
	value string
}

// New wraps a sensitive value.
func New(value string) String {
	return String{value: value}
}

// Reveal returns the raw value. Call it only at the point of use.
func (s String) Reveal() string {
	return s.value
}

// IsZero reports whether the secret is empty.
func (s String) IsZero() bool {
	return s.value == ""
}

// String implements fmt.Stringer and always returns a redacted marker.
func (s String) String() string {
	return redacted
}

// GoString keeps %#v from printing the value.
func (s String) GoString() string {
	return redacted
}

// LogValue implements slog.LogValuer.
func (s String) LogValue() slog.Value {
	return slog.StringValue(redacted)
}

// MarshalJSON keeps the value out of JSON output.
func (s String) MarshalJSON() ([]byte, error) {
	return []byte(`"` + redacted + `"`), nil
}
