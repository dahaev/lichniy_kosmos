# Личный космос 2.0 — developer commands. `make help` lists targets.

SHELL := /bin/bash
.DEFAULT_GOAL := help

ENV_FILE := $(firstword $(wildcard .env) .env.example)
include $(ENV_FILE)
export

GOLANGCI_LINT_VERSION := v2.15.0
BIN := $(CURDIR)/bin
GOLANGCI_LINT := $(BIN)/golangci-lint
VERSION ?= $(shell git describe --tags --always --dirty 2>/dev/null || echo dev)
LDFLAGS := -s -w -X main.version=$(VERSION)
COMPOSE_DEV := docker compose -f deploy/compose.dev.yaml

.PHONY: help
help: ## Show this help
	@awk 'BEGIN {FS = ":.*## "} /^[a-zA-Z_-]+:.*## / {printf "  \033[36m%-18s\033[0m %s\n", $$1, $$2}' $(MAKEFILE_LIST)

## --- Setup ---------------------------------------------------------------

.PHONY: tools
tools: $(GOLANGCI_LINT) ## Install pinned Go tools into ./bin

$(GOLANGCI_LINT):
	cd backend && GOBIN=$(BIN) go install github.com/golangci/golangci-lint/v2/cmd/golangci-lint@$(GOLANGCI_LINT_VERSION)

.PHONY: deps
deps: ## Install Go modules and npm packages
	cd backend && go mod download
	cd frontend && npm ci
	cd e2e && npm ci

## --- Local environment ---------------------------------------------------

.PHONY: dev-up
dev-up: ## Start dev PostgreSQL and Mailpit
	$(COMPOSE_DEV) up -d --wait

.PHONY: dev-down
dev-down: ## Stop dev containers (data volume is kept)
	$(COMPOSE_DEV) down

.PHONY: migrate
migrate: ## Apply migrations to the dev database
	cd backend && go run ./cmd/cosmos migrate up

.PHONY: migrate-status
migrate-status: ## Show migration status of the dev database
	cd backend && go run ./cmd/cosmos migrate status

.PHONY: run
run: ## Run the API server against the dev database
	cd backend && go run ./cmd/cosmos serve

.PHONY: fe-dev
fe-dev: ## Vite dev server with MSW mocks (no backend needed)
	cd frontend && npm run dev

.PHONY: fe-dev-api
fe-dev-api: ## Vite dev server proxying to the real backend
	cd frontend && npm run dev:api

## --- Backend checks ------------------------------------------------------

.PHONY: lint
lint: $(GOLANGCI_LINT) ## golangci-lint (includes module-graph depguard rules)
	cd backend && $(GOLANGCI_LINT) run ./...

.PHONY: test
test: ## Go unit tests with the race detector (integration tests skip)
	cd backend && env -u COSMOS_TEST_DATABASE_URL go test -race -count=1 ./...

.PHONY: test-integration
test-integration: ## Go tests including PostgreSQL integration (needs dev-up)
	cd backend && go test -race -count=1 ./...

.PHONY: vuln
vuln: ## govulncheck on the backend
	cd backend && go run golang.org/x/vuln/cmd/govulncheck@latest ./...

## --- Contract ------------------------------------------------------------

.PHONY: gen
gen: ## Regenerate TS types from api/openapi.yaml
	cd frontend && npm run gen:api

.PHONY: check-gen
check-gen: gen ## Fail if generated TS types are out of date
	git diff --exit-code -- frontend/src/api/schema.d.ts

## --- Frontend checks -----------------------------------------------------

.PHONY: fe-lint
fe-lint: ## ESLint
	cd frontend && npm run lint

.PHONY: fe-typecheck
fe-typecheck: ## vue-tsc
	cd frontend && npm run typecheck

.PHONY: fe-test
fe-test: ## Vitest
	cd frontend && npm run test

.PHONY: fe-build
fe-build: ## Production build and mock-free bundle check
	cd frontend && npm run build && npm run check:bundle

## --- E2E and visual stand ------------------------------------------------

.PHONY: e2e
e2e: ## Playwright smoke tests against Vite + MSW
	cd e2e && npm run typecheck && npm test

.PHONY: visual
visual: ## Snapshots at 4 viewports and comparison with the hero reference
	cd e2e && npm run visual

## --- Build ---------------------------------------------------------------

.PHONY: build
build: fe-build ## Build backend binary into ./bin and the frontend bundle
	cd backend && CGO_ENABLED=0 go build -trimpath -ldflags "$(LDFLAGS)" -o $(BIN)/cosmos ./cmd/cosmos

.PHONY: docker-build
docker-build: ## Build production images (app and web)
	docker build -f deploy/Dockerfile --target app --build-arg VERSION=$(VERSION) -t lichniy-kosmos/app:$(VERSION) .
	docker build -f deploy/Dockerfile --target web -t lichniy-kosmos/web:$(VERSION) .

## --- Aggregate -----------------------------------------------------------

.PHONY: ci
ci: lint test check-gen fe-lint fe-typecheck fe-test fe-build e2e ## Everything CI runs, except integration and Docker
