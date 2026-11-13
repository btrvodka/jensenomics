package main

import (
	"context"
	"embed"
	"encoding/json"
	"flag"
	"io/fs"
	"log"
	"net/http"
	"os/signal"
	"syscall"
	"time"
)

//go:embed web
var webFS embed.FS

// version задаётся при сборке: -ldflags "-X main.version=v1.2.3".
var version = "dev"

func main() {
	addr := flag.String("addr", ":8080", "адрес HTTP-сервера")
	every := flag.Duration("refresh", time.Minute, "как часто обновлять котировки")
	demo := flag.Bool("demo", false, "случайные котировки без обращения к Yahoo")
	flag.Parse()

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	store := NewStore(*demo)
	go store.Run(ctx, *every)

	static, _ := fs.Sub(webFS, "web")
	mux := http.NewServeMux()
	mux.Handle("/", http.FileServerFS(static))
	mux.HandleFunc("/api/quotes", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Cache-Control", "no-store")
		_ = json.NewEncoder(w).Encode(store.Snapshot())
	})

	srv := &http.Server{Addr: *addr, Handler: mux}
	go func() {
		<-ctx.Done()
		shCtx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
		defer cancel()
		_ = srv.Shutdown(shCtx)
	}()
	log.Printf("jensenomics %s: мировая экономика крутится на http://localhost%s", version, *addr)
	if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		log.Fatal(err)
	}
}
