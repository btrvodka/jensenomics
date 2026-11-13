package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"math/rand/v2"
	"net/http"
	"net/url"
	"sync"
	"time"
)

type Quote struct {
	Symbol    string  `json:"symbol"`
	Name      string  `json:"name"`
	Group     string  `json:"group"`
	Cap       float64 `json:"cap"`
	Price     float64 `json:"price"`
	PrevClose float64 `json:"prevClose"`
	Change    float64 `json:"change"`
	ChangePct float64 `json:"changePct"`
	Time      int64   `json:"time"`
	Live      bool    `json:"live"`
}

type Snapshot struct {
	Updated    int64   `json:"updated"`
	MarketOpen bool    `json:"marketOpen"`
	Demo       bool    `json:"demo"`
	Crashes    int64   `json:"crashes"`
	Quotes     []Quote `json:"quotes"`
}

type Store struct {
	mu     sync.RWMutex
	quotes map[string]Quote
	open   bool
	upd    time.Time
	demo   bool
	client *http.Client
}

func NewStore(demo bool) *Store {
	s := &Store{
		quotes: map[string]Quote{},
		demo:   demo,
		client: &http.Client{Timeout: 10 * time.Second},
	}
	for _, t := range tickers {
		s.quotes[t.Symbol] = Quote{Symbol: t.Symbol, Name: t.Symbol, Group: t.Group, Cap: t.Cap}
	}
	return s
}

func (s *Store) Snapshot() Snapshot {
	s.mu.RLock()
	defer s.mu.RUnlock()
	out := Snapshot{Updated: s.upd.Unix(), MarketOpen: s.open, Demo: s.demo}
	for _, t := range tickers {
		out.Quotes = append(out.Quotes, s.quotes[t.Symbol])
	}
	return out
}

func (s *Store) Run(ctx context.Context, every time.Duration) {
	s.refresh(ctx)
	tk := time.NewTicker(every)
	defer tk.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-tk.C:
			s.refresh(ctx)
		}
	}
}

func (s *Store) refresh(ctx context.Context) {
	if s.demo {
		s.fakeRefresh()
		return
	}
	var (
		wg     sync.WaitGroup
		sem    = make(chan struct{}, 8)
		okCnt  int
		failed []string
		mu     sync.Mutex
		open   bool
	)
	for _, t := range tickers {
		wg.Add(1)
		go func(t Ticker) {
			defer wg.Done()
			sem <- struct{}{}
			defer func() { <-sem }()
			q, isOpen, err := s.fetch(ctx, t)
			mu.Lock()
			defer mu.Unlock()
			if err != nil {
				failed = append(failed, t.Symbol)
				return
			}
			okCnt++
			open = open || isOpen
			s.mu.Lock()
			s.quotes[t.Symbol] = q
			s.mu.Unlock()
		}(t)
	}
	wg.Wait()
	s.mu.Lock()
	if okCnt > 0 {
		s.upd = time.Now()
		s.open = open
	}
	s.mu.Unlock()
	if len(failed) > 0 {
		log.Printf("quotes: %d ok, failed: %v", okCnt, failed)
	} else {
		log.Printf("quotes: %d ok", okCnt)
	}
}

type chartResp struct {
	Chart struct {
		Result []struct {
			Meta struct {
				Symbol                     string  `json:"symbol"`
				ShortName                  string  `json:"shortName"`
				LongName                   string  `json:"longName"`
				RegularMarketPrice         float64 `json:"regularMarketPrice"`
				RegularMarketTime          int64   `json:"regularMarketTime"`
				RegularMarketChangePercent float64 `json:"regularMarketChangePercent"`
				ChartPreviousClose         float64 `json:"chartPreviousClose"`
				PreviousClose              float64 `json:"previousClose"`
				CurrentTradingPeriod       struct {
					Regular struct {
						Start int64 `json:"start"`
						End   int64 `json:"end"`
					} `json:"regular"`
				} `json:"currentTradingPeriod"`
			} `json:"meta"`
		} `json:"result"`
		Error *struct {
			Description string `json:"description"`
		} `json:"error"`
	} `json:"chart"`
}

func (s *Store) fetch(ctx context.Context, t Ticker) (Quote, bool, error) {
	u := "https://query1.finance.yahoo.com/v8/finance/chart/" + url.PathEscape(t.Symbol) + "?range=1d&interval=1d"
	req, _ := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
	req.Header.Set("User-Agent", "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36")
	resp, err := s.client.Do(req)
	if err != nil {
		return Quote{}, false, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return Quote{}, false, fmt.Errorf("%s: http %d", t.Symbol, resp.StatusCode)
	}
	var cr chartResp
	if err := json.NewDecoder(resp.Body).Decode(&cr); err != nil {
		return Quote{}, false, err
	}
	if cr.Chart.Error != nil || len(cr.Chart.Result) == 0 {
		return Quote{}, false, fmt.Errorf("%s: empty result", t.Symbol)
	}
	m := cr.Chart.Result[0].Meta
	prev := m.ChartPreviousClose
	if prev == 0 {
		prev = m.PreviousClose
	}
	pct := m.RegularMarketChangePercent
	if pct == 0 && prev > 0 {
		pct = (m.RegularMarketPrice/prev - 1) * 100
	}
	name := m.ShortName
	if name == "" {
		name = m.LongName
	}
	now := time.Now().Unix()
	isOpen := now >= m.CurrentTradingPeriod.Regular.Start && now < m.CurrentTradingPeriod.Regular.End
	return Quote{
		Symbol:    t.Symbol,
		Name:      name,
		Group:     t.Group,
		Cap:       t.Cap,
		Price:     m.RegularMarketPrice,
		PrevClose: prev,
		Change:    m.RegularMarketPrice - prev,
		ChangePct: pct,
		Time:      m.RegularMarketTime,
		Live:      true,
	}, isOpen, nil
}

// fakeRefresh — режим -demo без интернета: случайное блуждание.
func (s *Store) fakeRefresh() {
	s.mu.Lock()
	defer s.mu.Unlock()
	for sym, q := range s.quotes {
		if q.Price == 0 {
			q.Price = 50 + rand.Float64()*400
			q.PrevClose = q.Price
		}
		q.Price *= 1 + rand.NormFloat64()*0.01
		q.Change = q.Price - q.PrevClose
		q.ChangePct = q.Change / q.PrevClose * 100
		q.Time = time.Now().Unix()
		q.Live = true
		s.quotes[sym] = q
	}
	s.upd = time.Now()
	s.open = true
}
