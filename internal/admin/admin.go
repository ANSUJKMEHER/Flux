// Package admin provides an HTTP admin API for runtime management of the gateway.
//
// Endpoints:
//   - GET  /admin/config    — dump current config as JSON
//   - PUT  /admin/config    — hot reload config from YAML body
//   - GET  /admin/health    — gateway self-health check
//   - GET  /admin/upstreams — list all upstreams with health status
//   - GET  /admin/breakers  — list all circuit breaker states
package admin

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"sync/atomic"

	"github.com/ANSUJKMEHER/rate-limiter-gateway/internal/breaker"
	"github.com/ANSUJKMEHER/rate-limiter-gateway/internal/config"
	"github.com/ANSUJKMEHER/rate-limiter-gateway/internal/loadbalancer"
)

// Stats holds global counters for the admin dashboard.
type Stats struct {
	TotalRequests atomic.Uint64
	Total429s     atomic.Uint64
}

// Server is the admin API server.
type Server struct {
	cfgHolder      *config.ConfigHolder
	upstreamsByPool map[string][]*loadbalancer.Upstream
	breakerRegistry *breaker.BreakerRegistry
	mux            *http.ServeMux
	stats          *Stats
}

// NewServer creates an admin API server.
func NewServer(
	cfgHolder *config.ConfigHolder,
	upstreamsByPool map[string][]*loadbalancer.Upstream,
	breakerRegistry *breaker.BreakerRegistry,
	stats *Stats,
) *Server {
	s := &Server{
		cfgHolder:       cfgHolder,
		upstreamsByPool: upstreamsByPool,
		breakerRegistry: breakerRegistry,
		stats:           stats,
		mux:             http.NewServeMux(),
	}

	s.mux.HandleFunc("GET /admin/config", s.handleGetConfig)
	s.mux.HandleFunc("GET /admin/health", s.handleHealth)
	s.mux.HandleFunc("GET /admin/upstreams", s.handleListUpstreams)
	s.mux.HandleFunc("GET /admin/breakers", s.handleListBreakers)
	s.mux.HandleFunc("GET /admin/stats", s.handleStats)

	// Serve the	// Static dashboard
	fs := http.FileServer(http.Dir("web/dashboard/dist"))
	s.mux.Handle("/dashboard/", http.StripPrefix("/dashboard/", fs))

	return s
}

// Handler returns the admin API HTTP handler with CORS.
func (s *Server) Handler() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
		if r.Method == "OPTIONS" {
			w.WriteHeader(http.StatusOK)
			return
		}
		s.mux.ServeHTTP(w, r)
	})
}

func (s *Server) handleGetConfig(w http.ResponseWriter, r *http.Request) {
	cfg := s.cfgHolder.Get()
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(cfg)
}

func (s *Server) handleStats(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	if s.stats == nil {
		fmt.Fprint(w, `{"total_requests":0,"total_429s":0}`)
		return
	}
	fmt.Fprintf(w, `{"total_requests":%d,"total_429s":%d}`, s.stats.TotalRequests.Load(), s.stats.Total429s.Load())
}

func (s *Server) handleHealth(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	fmt.Fprint(w, `{"status":"ok"}`)
}

type upstreamStatus struct {
	ID          string `json:"id"`
	URL         string `json:"url"`
	Pool        string `json:"pool"`
	Healthy     bool   `json:"healthy"`
	ActiveConns int64  `json:"active_connections"`
}

func (s *Server) handleListUpstreams(w http.ResponseWriter, r *http.Request) {
	result := []upstreamStatus{}
	for poolName, upstreams := range s.upstreamsByPool {
		for _, up := range upstreams {
			result = append(result, upstreamStatus{
				ID:          up.ID,
				URL:         up.URL,
				Pool:        poolName,
				Healthy:     up.IsHealthy(),
				ActiveConns: up.ActiveConns(),
			})
		}
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(result)
}

type breakerStatus struct {
	Upstream string `json:"upstream"`
	State    string `json:"state"`
	Stats    string `json:"stats"`
}

func (s *Server) handleListBreakers(w http.ResponseWriter, r *http.Request) {
	allStats := s.breakerRegistry.All()
	result := []breakerStatus{}
	for id, stats := range allStats {
		result = append(result, breakerStatus{
			Upstream: id,
			State:    stats.State.String(),
			Stats:    stats.String(),
		})
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(result)
}

// ListenAndServe starts the admin API server on the configured address.
func ListenAndServe(addr string, srv *Server) {
	adminServer := &http.Server{
		Addr:    addr,
		Handler: srv.Handler(),
	}
	log.Printf("admin API listening on %s", addr)
	if err := adminServer.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		log.Printf("admin server error: %v", err)
	}
}
