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
	"io"
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
	onReload       func(*config.GatewayConfig) error
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
	s.mux.HandleFunc("PUT /admin/config", s.handlePutConfig)
	s.mux.HandleFunc("GET /admin/health", s.handleHealth)
	s.mux.HandleFunc("GET /admin/upstreams", s.handleListUpstreams)
	s.mux.HandleFunc("GET /admin/breakers", s.handleListBreakers)
	s.mux.HandleFunc("GET /admin/stats", s.handleStats)

	// Serve the static dashboard
	fs := http.FileServer(http.Dir("web/dashboard/dist"))
	s.mux.Handle("/dashboard/", http.StripPrefix("/dashboard/", fs))

	return s
}

// SetOnReload sets an optional callback invoked when configuration is reloaded via PUT /admin/config.
func (s *Server) SetOnReload(fn func(*config.GatewayConfig) error) {
	s.onReload = fn
}

// Handler returns the admin API HTTP handler with authenticated and restricted CORS middleware.
func (s *Server) Handler() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		cfg := s.cfgHolder.Get()

		// 1. CORS validation: restrict to configured allowed origins or same-origin
		origin := r.Header.Get("Origin")
		if origin != "" {
			allowed := false
			if len(cfg.Admin.AllowedOrigins) == 0 {
				// Default to local/dashboard same-origin
				allowed = true
			} else {
				for _, o := range cfg.Admin.AllowedOrigins {
					if o == "*" || o == origin {
						allowed = true
						break
					}
				}
			}
			if allowed {
				w.Header().Set("Access-Control-Allow-Origin", origin)
				w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, OPTIONS")
				w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")
				w.Header().Set("Vary", "Origin")
			} else {
				w.WriteHeader(http.StatusForbidden)
				return
			}
		}

		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}

		// 2. Authentication check if Admin.Token is configured
		if cfg.Admin.Token != "" && (r.URL.Path != "/admin/health" && r.URL.Path != "/dashboard/") {
			authHeader := r.Header.Get("Authorization")
			expected := "Bearer " + cfg.Admin.Token
			if authHeader != expected {
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(http.StatusUnauthorized)
				fmt.Fprint(w, `{"error":"unauthorized: invalid or missing admin token"}`)
				return
			}
		}

		s.mux.ServeHTTP(w, r)
	})
}

// SanitizedConfig protects plaintext credentials from public exposure.
type SanitizedConfig struct {
	Server     config.ServerConfig             `json:"server"`
	Admin      config.AdminConfig              `json:"admin"`
	Routes     []config.RouteConfig            `json:"routes"`
	Pools      map[string]config.UpstreamPool  `json:"pools"`
	RateLimits map[string]config.RateLimitTier `json:"rate_limits"`
	Breaker    config.BreakerConfig            `json:"breaker"`
	Health     config.HealthConfig             `json:"health"`
	Auth       SanitizedAuthConfig             `json:"auth"`
	RedisAddr  string                          `json:"redis_addr"`
}

// SanitizedAuthConfig summarizes auth state without leaking keys or secrets.
type SanitizedAuthConfig struct {
	Mode           string `json:"mode"`
	ConfiguredKeys int    `json:"configured_keys_count"`
	JWTEnabled     bool   `json:"jwt_enabled"`
	JWTIssuer      string `json:"jwt_issuer"`
}

func (s *Server) handleGetConfig(w http.ResponseWriter, r *http.Request) {
	cfg := s.cfgHolder.Get()
	sanitized := SanitizedConfig{
		Server:     cfg.Server,
		Admin:      config.AdminConfig{ListenAddr: cfg.Admin.ListenAddr, Enabled: cfg.Admin.Enabled, AllowedOrigins: cfg.Admin.AllowedOrigins},
		Routes:     cfg.Routes,
		Pools:      cfg.Pools,
		RateLimits: cfg.RateLimits,
		Breaker:    cfg.Breaker,
		Health:     cfg.Health,
		Auth: SanitizedAuthConfig{
			Mode:           cfg.Auth.Mode,
			ConfiguredKeys: len(cfg.Auth.APIKeys),
			JWTEnabled:     cfg.Auth.JWT.Secret != "",
			JWTIssuer:      cfg.Auth.JWT.Issuer,
		},
		RedisAddr: cfg.Redis.Addr,
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(sanitized)
}

func (s *Server) handlePutConfig(w http.ResponseWriter, r *http.Request) {
	defer r.Body.Close()
	var body []byte
	var err error
	if r.Body != nil {
		body, err = io.ReadAll(r.Body)
	}
	if err != nil || len(body) == 0 {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		fmt.Fprint(w, `{"error":"missing or unreadable request body"}`)
		return
	}

	newCfg, err := config.ParseYAML(body)
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		fmt.Fprintf(w, `{"error":"invalid configuration: %s"}`, err.Error())
		return
	}

	if s.onReload != nil {
		if err := s.onReload(newCfg); err != nil {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusInternalServerError)
			fmt.Fprintf(w, `{"error":"reload hook failed: %s"}`, err.Error())
			return
		}
	}

	s.cfgHolder.Swap(newCfg)
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	fmt.Fprint(w, `{"status":"reloaded"}`)
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
