package httpapi

import (
	"encoding/json"
	"net/http"

	"github.com/dahaev/lichniy_kosmos/backend/internal/platform/observability"
)

// Stable machine-readable error codes (ARCHITECTURE_MVP_v2 §15.3). Domain codes
// are added together with the slices that produce them.
const (
	codeNotFound      = "not_found"
	codeInternalError = "internal_error"
)

// Problem is an RFC 9457 problem details body with the project-specific code.
type Problem struct {
	Type      string `json:"type"`
	Title     string `json:"title"`
	Status    int    `json:"status"`
	Detail    string `json:"detail,omitempty"`
	Code      string `json:"code"`
	RequestID string `json:"request_id,omitempty"`
}

func writeProblem(w http.ResponseWriter, r *http.Request, status int, code, detail string) {
	p := Problem{
		Type:      "about:blank",
		Title:     http.StatusText(status),
		Status:    status,
		Detail:    detail,
		Code:      code,
		RequestID: observability.RequestID(r.Context()),
	}
	w.Header().Set("Content-Type", "application/problem+json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(p)
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}
