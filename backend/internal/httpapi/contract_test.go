package httpapi

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/getkin/kin-openapi/openapi3"
	"github.com/getkin/kin-openapi/openapi3filter"
	"github.com/getkin/kin-openapi/routers/legacy"
)

const specPath = "../../../api/openapi.yaml"

func loadSpec(t *testing.T) *openapi3.T {
	t.Helper()
	loader := openapi3.NewLoader()
	doc, err := loader.LoadFromFile(specPath)
	if err != nil {
		t.Fatalf("load %s: %v", specPath, err)
	}
	if err := doc.Validate(context.Background()); err != nil {
		t.Fatalf("invalid OpenAPI document: %v", err)
	}
	return doc
}

// TestResponsesMatchContract validates real handler responses against
// api/openapi.yaml, so the hand-written handlers cannot drift from the contract.
func TestResponsesMatchContract(t *testing.T) {
	doc := loadSpec(t)
	router, err := legacy.NewRouter(doc)
	if err != nil {
		t.Fatalf("router: %v", err)
	}

	tests := []struct {
		name   string
		checks []Check
		path   string
	}{
		{name: "healthz", path: "/healthz"},
		{name: "readyz ready", checks: []Check{okCheck("postgres")}, path: "/readyz"},
		{name: "readyz not ready", checks: []Check{failCheck("postgres")}, path: "/readyz"},
		{name: "config", path: "/api/v1/config"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodGet, tt.path, nil)
			rec := httptest.NewRecorder()
			newTestHandler(tt.checks...).ServeHTTP(rec, req)

			route, pathParams, err := router.FindRoute(req)
			if err != nil {
				t.Fatalf("route %s not in contract: %v", tt.path, err)
			}
			input := &openapi3filter.ResponseValidationInput{
				RequestValidationInput: &openapi3filter.RequestValidationInput{
					Request:    req,
					PathParams: pathParams,
					Route:      route,
				},
				Status: rec.Code,
				Header: rec.Header(),
				Body:   io.NopCloser(bytes.NewReader(rec.Body.Bytes())),
				Options: &openapi3filter.Options{
					IncludeResponseStatus: true,
				},
			}
			if err := openapi3filter.ValidateResponse(context.Background(), input); err != nil {
				t.Errorf("response violates contract: %v\nbody: %s", err, rec.Body.String())
			}
		})
	}
}

// TestProblemMatchesContract checks the problem+json shape against the schema
// directly: unknown routes are by definition absent from the paths section.
func TestProblemMatchesContract(t *testing.T) {
	doc := loadSpec(t)
	schema := doc.Components.Schemas["Problem"].Value

	rec := do(t, newTestHandler(), http.MethodGet, "/api/v1/missing")

	var body any
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if err := schema.VisitJSON(body); err != nil {
		t.Errorf("problem violates schema: %v\nbody: %s", err, rec.Body.String())
	}
}
