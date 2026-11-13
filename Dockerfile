# --- сборка ---
FROM golang:1.22-alpine AS build
WORKDIR /src
COPY go.mod ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/jensenomics .

# --- рантайм: distroless уже содержит CA-сертификаты для HTTPS к Yahoo ---
FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=build /out/jensenomics /jensenomics
EXPOSE 8080
USER nonroot:nonroot
ENTRYPOINT ["/jensenomics"]
CMD ["-addr", ":8080"]
