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

# distroless уже содержит CA-сертификаты для HTTPS к Yahoo Finance.
FROM gcr.io/distroless/static-debian12:nonroot

# Связывает образ в ghcr.io с репозиторием.
LABEL org.opencontainers.image.source="https://github.com/btrvodka/jensenomics" \
      org.opencontainers.image.description="Joke 3D site: the entire world economy as a live-quote treemap spinning on Jensen Huang"

COPY --from=build /out/jensenomics /jensenomics
EXPOSE 8080
USER nonroot:nonroot
ENTRYPOINT ["/jensenomics"]
CMD ["-addr", ":8080"]
