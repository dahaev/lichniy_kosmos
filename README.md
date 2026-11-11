# Личный космос 2.0

Новый проект с нуля: Go (модульный монолит) + Vue 3 / TypeScript + PostgreSQL. Сейчас реализован технический срез **S0**: каркас, инфраструктура, контракт, CI. Бизнес-логики и финального дизайна ещё нет — экраны являются заглушками. Отчёт: [`docs/reports/S0_IMPLEMENTATION_REPORT.md`](docs/reports/S0_IMPLEMENTATION_REPORT.md).

Архитектура: [`docs/architecture/ARCHITECTURE_MVP_v2.md`](docs/architecture/ARCHITECTURE_MVP_v2.md). Решения: [`docs/PROJECT_DECISIONS.md`](docs/PROJECT_DECISIONS.md). Правила агентов: [`AGENTS.md`](AGENTS.md).

## Структура

| Путь | Что внутри |
|---|---|
| `api/openapi.yaml` | Контракт frontend ↔ backend (OpenAPI 3.1), источник истины |
| `backend/` | Go-модуль: `cmd/cosmos` (serve, migrate, version), `internal/<модуль>`, `migrations/` (goose) |
| `frontend/` | Vite + Vue 3 + TS strict, Vue Router, Pinia, motion-v, Three.js, MSW |
| `e2e/` | Playwright: smoke-тесты и визуальный стенд сравнения с эталоном |
| `deploy/` | Docker Compose (dev и production), Dockerfile, Caddyfile, runbook'и |
| `assets-src/` | Мастер-файлы сцены (Git LFS, с лицензиями) — появятся в V1 |
| `docs/` | Продукт, архитектура, спецификации экранов, журналы экранов, отчёты |

## Требования

- Go 1.27 (toolchain 1.27.4 подтягивается автоматически из `backend/go.mod`)
- Node.js ≥ 22.12 (проверено на 23.11; в CI и Docker — 24), npm 11
- Docker с Compose v2 — для dev-PostgreSQL и Mailpit
- GNU make

## Быстрый старт

```bash
make deps        # go mod download + npm ci во frontend/ и e2e/
make tools       # golangci-lint v2.15.0 в ./bin

# Вариант 1: только интерфейс на MSW-моках, без backend и БД
make fe-dev      # http://127.0.0.1:5173 ; внизу справа панель «данные: MSW-моки»

# Вариант 2: настоящий backend
make dev-up      # PostgreSQL 18 на 127.0.0.1:55432 и Mailpit (UI http://127.0.0.1:8025)
make migrate     # применить миграции к dev-БД
make run         # API на http://127.0.0.1:8080
make fe-dev-api  # Vite проксирует /api, /healthz, /readyz на backend; панель «реальный API»
```

Проверка backend:

```bash
curl -s http://127.0.0.1:8080/healthz        # {"status":"ok"}
curl -s http://127.0.0.1:8080/readyz         # 200 ready или 503 not_ready (БД, миграции)
curl -s http://127.0.0.1:8080/api/v1/config  # публичная конфигурация, все флаги false
```

Конфигурация — переменные `COSMOS_*` (см. [`.env.example`](.env.example)). Makefile читает `.env`, если он есть, иначе `.env.example`. В `.env.example` только значения одноразовой локальной БД. Настоящие секреты в репозиторий не попадают.

## Команды

| Команда | Что делает |
|---|---|
| `make lint` | golangci-lint, включая правила графа модулей (depguard) |
| `make test` | Go-тесты с `-race`; интеграционные пропускаются |
| `make test-integration` | Go-тесты вместе с миграциями на реальном PostgreSQL (нужен `make dev-up`) |
| `make vuln` | govulncheck |
| `make gen` / `make check-gen` | Генерация TS-типов из `api/openapi.yaml` / проверка, что они актуальны |
| `make fe-lint`, `fe-typecheck`, `fe-test` | ESLint, vue-tsc, Vitest |
| `make fe-build` | Production-сборка и проверка, что в бандле нет кода моков |
| `make e2e` | Playwright smoke на Vite + MSW (браузер: `cd e2e && npm run install-browsers`) |
| `make visual` | Снимки 1440×900, 390×844, 768×1024, 1920×1080 и сравнение с эталоном → `e2e/visual/output/` |
| `make build` | Бинарник `./bin/cosmos` и `frontend/dist` |
| `make docker-build` | Образы `app` (distroless) и `web` (Caddy со статикой) |
| `make ci` | Всё, что запускает CI, кроме интеграционных тестов и Docker |
| `make migrate-status` | Статус миграций |

Бинарник: `cosmos serve | migrate up | migrate status | version | help`.

## Контракт API

Эндпоинт сначала появляется в `api/openapi.yaml`, затем: `make gen` → обработчик Go → MSW-мок во `frontend/src/mocks/handlers.ts`. Контрактный тест (`backend/internal/httpapi/contract_test.go`) проверяет ответы Go-обработчиков по спецификации. Ошибки — RFC 9457 `application/problem+json` со стабильным полем `code`.

## MSW-моки

Включаются только в dev при `VITE_API_MOCKS=1` (`npm run dev`). Ответы мока помечены заголовком `x-cosmos-mock: 1`. Production-сборка удаляет `mockServiceWorker.js`, а `check:bundle` падает, если код моков попал в `dist/`. Фикстуры только синтетические.

## Визуальный стенд

`make visual` строит производный кадр из `docs/frontend/references/hero-approved.png` (обрезает рамку, маскирует чужую панель снизу; оригинал не меняется), снимает главную в детерминированном режиме `?scene=freeze` и кладёт в `e2e/visual/output/` изображения рядом, наложением и разницей, а также `summary.json`. В S0 стенд ничего не блокирует: главная пока заглушка, пороги появятся в V1.

## Production

`deploy/compose.yaml` (web + app + postgres, миграции через профиль `ops`) и `deploy/ops/README.md`. Новый проект разворачивается рядом с legacy, не трогая его (ARCHITECTURE_MVP_v2 §26). В S0 ничего не развёрнуто.
