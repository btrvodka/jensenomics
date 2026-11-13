# Кросс-компиляция на платформе сборки: мультиарх-образ собирается без эмуляции.
FROM --platform=$BUILDPLATFORM golang:1.27-alpine AS build

WORKDIR /src
COPY go.mod ./
RUN go mod download

COPY . .
ARG VERSION=dev
ARG TARGETOS
ARG TARGETARCH
RUN CGO_ENABLED=0 GOOS=$TARGETOS GOARCH=$TARGETARCH \
    go build -trimpath -ldflags "-s -w -X main.version=${VERSION}" -o /out/jensenomics .

FROM alpine:3.24

# Связывает образ в ghcr.io с репозиторием.
LABEL org.opencontainers.image.source="https://github.com/btrvodka/jensenomics" \
      org.opencontainers.image.description="Joke 3D site: the entire world economy as a live-quote treemap spinning on Jensen Huang"

# CA-сертификаты для HTTPS к Yahoo Finance есть в базовом образе (ca-certificates-bundle).
RUN adduser -D -H -u 10001 jensenomics

COPY --from=build /out/jensenomics /usr/local/bin/jensenomics
EXPOSE 8080
USER jensenomics
ENTRYPOINT ["/usr/local/bin/jensenomics"]
CMD ["-addr", ":8080"]
