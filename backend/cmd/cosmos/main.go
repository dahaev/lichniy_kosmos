// Command cosmos is the single binary of Личный космос 2.0. Roles are selected
// by subcommand; worker and admin arrive with the slices that need them.
package main

import (
	"context"
	"fmt"
	"io"
	"log/slog"
	"os"
	"os/signal"
	"syscall"

	"github.com/dahaev/lichniy_kosmos/backend/internal/app"
	"github.com/dahaev/lichniy_kosmos/backend/internal/platform/config"
	"github.com/dahaev/lichniy_kosmos/backend/internal/platform/observability"
)

// version is set at build time: -ldflags "-X main.version=..."
var version = "dev"

func main() {
	os.Exit(run(os.Args[1:]))
}

func run(args []string) int {
	if len(args) == 0 {
		usage(os.Stderr)
		return 2
	}

	switch args[0] {
	case "help", "-h", "--help":
		usage(os.Stdout)
		return 0
	case "version":
		fmt.Println(version)
		return 0
	case "serve", "migrate":
	default:
		fmt.Fprintf(os.Stderr, "unknown command %q\n\n", args[0])
		usage(os.Stderr)
		return 2
	}

	cfg, err := config.Load(os.Getenv)
	if err != nil {
		fmt.Fprintf(os.Stderr, "configuration error:\n%v\n", err)
		return 1
	}
	log := observability.NewLogger(os.Stdout, cfg.LogLevel, cfg.LogFormat == config.LogText).
		With(slog.String("version", version))

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	switch args[0] {
	case "serve":
		err = app.Serve(ctx, cfg, log)
	case "migrate":
		err = app.Migrate(ctx, cfg, os.Stdout, args[1:])
	}
	if err != nil {
		log.Error("command failed", slog.String("command", args[0]), slog.Any("error", err))
		return 1
	}
	return 0
}

func usage(w io.Writer) {
	fmt.Fprint(w, `Usage: cosmos <command>

Commands:
  serve            run the HTTP API
  migrate up       apply pending database migrations
  migrate status   list migrations and their state
  version          print build version

Configuration is read from COSMOS_* environment variables (see .env.example).
`)
}
