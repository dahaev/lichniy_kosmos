// Package migrations embeds the forward-only goose SQL migrations so the
// cosmos binary carries its own schema.
package migrations

import "embed"

// FS holds every *.sql migration in version order.
//
//go:embed *.sql
var FS embed.FS
