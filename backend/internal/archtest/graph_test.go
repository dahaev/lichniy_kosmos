// Package archtest verifies the module dependency graph from
// ARCHITECTURE_MVP_v2 §5.1a against the real imports of the module.
package archtest

import (
	"bufio"
	"bytes"
	"os/exec"
	"sort"
	"strings"
	"testing"
)

const modulePath = "github.com/dahaev/lichniy_kosmos/backend"

// allowed lists, for every top-level internal unit, the internal units it may
// import. platform is infrastructure and may be used by everyone except astro.
var allowed = map[string][]string{
	"cmd":           {"app", "platform"},
	"app":           {"*"},
	"httpapi":       {"results", "orders", "access", "identity", "places", "intake", "platform"},
	"results":       {"orders", "generation", "artifacts", "platform"},
	"orders":        {"access", "intake", "places", "astro", "generation", "audit", "platform"},
	"intake":        {"places", "platform"},
	"places":        {"platform"},
	"generation":    {"astro", "artifacts", "platform"},
	"artifacts":     {"astro", "platform"},
	"identity":      {"mail", "platform"},
	"access":        {"audit", "platform"},
	"audit":         {"platform"},
	"mail":          {"platform"},
	"astro":         {},
	"platform":      {"platform"},
	"migrations":    {},
	"internal/test": {"*"},
}

// unit maps an import path to its architectural unit, or "" for external packages.
func unit(importPath string) string {
	rest, ok := strings.CutPrefix(importPath, modulePath+"/")
	if !ok {
		return ""
	}
	parts := strings.Split(rest, "/")
	switch parts[0] {
	case "cmd", "migrations":
		return parts[0]
	case "internal":
		if len(parts) < 2 {
			return ""
		}
		if parts[1] == "archtest" {
			return "internal/test"
		}
		return parts[1]
	}
	return ""
}

func TestModuleGraph(t *testing.T) {
	cmd := exec.Command("go", "list", "-f", `{{.ImportPath}} {{join .Imports " "}}`, modulePath+"/...")
	cmd.Dir = "../.."
	out, err := cmd.Output()
	if err != nil {
		t.Fatalf("go list: %v", err)
	}

	var violations []string
	sc := bufio.NewScanner(bytes.NewReader(out))
	for sc.Scan() {
		fields := strings.Fields(sc.Text())
		if len(fields) == 0 {
			continue
		}
		from := unit(fields[0])
		rules, known := allowed[from]
		if !known {
			violations = append(violations, fields[0]+": package is not part of the declared module graph")
			continue
		}
		for _, imp := range fields[1:] {
			to := unit(imp)
			if to == "" || to == from || permitted(rules, to) {
				continue
			}
			violations = append(violations, fields[0]+" -> "+imp)
		}
	}
	if err := sc.Err(); err != nil {
		t.Fatal(err)
	}

	sort.Strings(violations)
	for _, v := range violations {
		t.Errorf("forbidden dependency: %s", v)
	}
}

func permitted(rules []string, to string) bool {
	for _, r := range rules {
		if r == "*" || r == to {
			return true
		}
	}
	return false
}

func TestUnit(t *testing.T) {
	tests := map[string]string{
		modulePath + "/cmd/cosmos":                    "cmd",
		modulePath + "/internal/platform/postgres":    "platform",
		modulePath + "/internal/generation/providers": "generation",
		modulePath + "/internal/archtest":             "internal/test",
		modulePath + "/migrations":                    "migrations",
		"github.com/jackc/pgx/v5":                     "",
		"net/http":                                    "",
	}
	for in, want := range tests {
		if got := unit(in); got != want {
			t.Errorf("unit(%q) = %q, want %q", in, got, want)
		}
	}
}
