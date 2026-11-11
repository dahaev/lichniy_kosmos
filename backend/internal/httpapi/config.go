package httpapi

import "net/http"

// PublicConfig is the client-visible runtime configuration (GET /api/v1/config).
// Consent version and support contacts join it in the slices that define them.
type PublicConfig struct {
	Environment string   `json:"environment"`
	Features    Features `json:"features"`
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
