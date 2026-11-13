package main

import (
	"log"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"
)

// Crashes — общий для всех посетителей счётчик «обрушений мировой экономики».
// Хранится в памяти; если задан файл, переживает перезапуск.
type Crashes struct {
	mu    sync.Mutex
	n     int64
	file  string
	seen  map[string]time.Time // антиспам: не чаще одного краха с IP раз в minGap
	dirty chan struct{}
}

const minGap = 3 * time.Second

func NewCrashes(file string) *Crashes {
	c := &Crashes{file: file, seen: map[string]time.Time{}, dirty: make(chan struct{}, 1)}
	if file != "" {
		if b, err := os.ReadFile(file); err == nil {
			c.n, _ = strconv.ParseInt(strings.TrimSpace(string(b)), 10, 64)
		} else if !os.IsNotExist(err) {
			log.Printf("crashes: %v", err)
		}
		go c.saver()
	}
	return c
}

func (c *Crashes) Count() int64 {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.n
}

// Add засчитывает крах, если с этого IP недавно не было другого.
func (c *Crashes) Add(ip string) int64 {
	c.mu.Lock()
	defer c.mu.Unlock()
	now := time.Now()
	if t, ok := c.seen[ip]; ok && now.Sub(t) < minGap {
		return c.n
	}
	if len(c.seen) > 10000 {
		for k, t := range c.seen {
			if now.Sub(t) > minGap {
				delete(c.seen, k)
			}
		}
	}
	c.seen[ip] = now
	c.n++
	select {
	case c.dirty <- struct{}{}:
	default:
	}
	return c.n
}

func (c *Crashes) saver() {
	for range c.dirty {
		n := c.Count()
		tmp := c.file + ".tmp"
		if err := os.MkdirAll(filepath.Dir(c.file), 0o755); err != nil {
			log.Printf("crashes: %v", err)
			continue
		}
		if err := os.WriteFile(tmp, []byte(strconv.FormatInt(n, 10)+"\n"), 0o644); err != nil {
			log.Printf("crashes: %v", err)
			continue
		}
		if err := os.Rename(tmp, c.file); err != nil {
			log.Printf("crashes: %v", err)
		}
		time.Sleep(time.Second) // не чаще раза в секунду
	}
}

func clientIP(r *http.Request) string {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}
