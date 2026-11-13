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
    go build -trimpath -ldflags "-s -w -X main.version=${VERSION}" -o /out/jensenomics . && \
    mkdir -p /out/data

FROM alpine:3.24

# Связывает образ в ghcr.io с репозиторием.
LABEL org.opencontainers.image.source="https://github.com/btrvodka/jensenomics" \
      org.opencontainers.image.description="Joke 3D site: the entire world economy as a live-quote treemap spinning on Jensen Huang"

# CA-сертификаты для HTTPS к Yahoo Finance есть в базовом образе (ca-certificates-bundle).
# В финальной стадии нет RUN: multi-arch сборка не требует эмуляции (QEMU).
# Пользователь задан числовым UID, запись в /etc/passwd для этого не нужна.
COPY --from=build /out/jensenomics /usr/local/bin/jensenomics
# Каталог для счётчика крахов; владелец задан через COPY, чтобы обойтись без RUN.
COPY --from=build --chown=10001:10001 /out/data /data
VOLUME /data
EXPOSE 8080
USER 10001:10001
ENTRYPOINT ["/usr/local/bin/jensenomics"]
CMD ["-addr", ":8080", "-crash-file", "/data/crashes"]
