# syntax=docker/dockerfile:1
# Build context: repository root.  docker build -f deploy/Dockerfile --target app .

FROM golang:1.27.4-alpine AS backend-build
WORKDIR /src/backend
COPY backend/go.mod backend/go.sum ./
RUN go mod download
COPY backend/ ./
ARG VERSION=dev
RUN CGO_ENABLED=0 go build -trimpath -ldflags "-s -w -X main.version=${VERSION}" -o /out/cosmos ./cmd/cosmos

FROM node:24-alpine AS frontend-build
WORKDIR /src/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY api/ /src/api/
COPY frontend/ ./
RUN npm run build

# API + migrations. Static, non-root, read-only friendly.
FROM gcr.io/distroless/static-debian12:nonroot AS app
COPY --from=backend-build /out/cosmos /usr/local/bin/cosmos
USER nonroot:nonroot
EXPOSE 8080
ENTRYPOINT ["/usr/local/bin/cosmos"]
CMD ["serve"]

# TLS, static SPA and /api reverse proxy.
FROM caddy:2-alpine AS web
COPY deploy/Caddyfile /etc/caddy/Caddyfile
COPY --from=frontend-build /src/frontend/dist /srv
