package httpapi

import "net/http"

// PublicConfig is the client-visible runtime configuration (GET /api/v1/config).
// Support contacts join it in the slice that defines them.
//
// The zero value is the closed state: LegalReady is false and ConsentVersion
// is empty until the approved consent text exists (Q12). The orders handler
// that enforces the same gate on the server is a later slice.
type PublicConfig struct {
	Environment    string   `json:"environment"`
	Features       Features `json:"features"`
	ConsentVersion string   `json:"consent_version"`
	LegalReady     bool     `json:"legal_ready"`
}

// Features tells the client which user flows the server currently serves.
type Features struct {
	CodeLogin  bool `json:"code_login"`
	EmailLogin bool `json:"email_login"`
	Generation bool `json:"generation"`
}

func handleConfig(cfg PublicConfig) http.HandlerFunc {
	return func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, http.StatusOK, cfg)
	}
}
