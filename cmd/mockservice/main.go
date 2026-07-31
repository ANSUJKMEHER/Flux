// Mock upstream service for development and testing.
//
// Features:
//   - Configurable port, service name, and latency via environment variables
//   - Static error rate at startup (MOCK_ERROR_RATE env var) for deterministic testing
//   - Runtime chaos endpoint (POST /chaos) to change error rate without restart
//   - Health endpoint (/health) for the gateway's active health checker
//
// Environment variables:
//   MOCK_PORT         - HTTP port (default: "9001")
//   MOCK_SERVICE_NAME - service name returned in responses (default: "mock-service")
//   MOCK_LATENCY_MIN  - minimum artificial latency in ms (default: "10")
//   MOCK_LATENCY_MAX  - maximum artificial latency in ms (default: "50")
//   MOCK_ERROR_RATE   - fraction of requests that return 500 (default: "0.0")
package main

import (
	"encoding/json"
	"fmt"
	"log"
	"math/rand"
	"net/http"
	"os"
	"strconv"
	"sync"
	"time"
)

type mockConfig struct {
	mu          sync.RWMutex
	port        string
	serviceName string
	latencyMin  time.Duration
	latencyMax  time.Duration
	errorRate   float64
}

func (c *mockConfig) getErrorRate() float64 {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return c.errorRate
}

func (c *mockConfig) setErrorRate(rate float64) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.errorRate = rate
}

func main() {
	cfg := &mockConfig{
		port:        envOrDefault("MOCK_PORT", "9001"),
		serviceName: envOrDefault("MOCK_SERVICE_NAME", "mock-service"),
		latencyMin:  parseDurationMs(envOrDefault("MOCK_LATENCY_MIN", "10")),
		latencyMax:  parseDurationMs(envOrDefault("MOCK_LATENCY_MAX", "50")),
		errorRate:   parseFloat(envOrDefault("MOCK_ERROR_RATE", "0.0")),
	}

	mux := http.NewServeMux()

	corsMiddleware := func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Access-Control-Allow-Origin", "*")
			w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
			w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
			if r.Method == "OPTIONS" {
				w.WriteHeader(http.StatusOK)
				return
			}
			next.ServeHTTP(w, r)
		})
	}

	// Health endpoint for the gateway's active health checker
	mux.HandleFunc("GET /health", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		fmt.Fprintf(w, `{"status":"ok","service":"%s"}`, cfg.serviceName)
	})

	// Chaos endpoint: change error rate at runtime without restart
	mux.HandleFunc("POST /chaos", func(w http.ResponseWriter, r *http.Request) {
		var req struct {
			ErrorRate float64 `json:"error_rate"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, `{"error":"invalid JSON"}`, http.StatusBadRequest)
			return
		}
		if req.ErrorRate < 0 || req.ErrorRate > 1 {
			http.Error(w, `{"error":"error_rate must be between 0 and 1"}`, http.StatusBadRequest)
			return
		}

		old := cfg.getErrorRate()
		cfg.setErrorRate(req.ErrorRate)
		log.Printf("chaos: error rate changed from %.2f to %.2f", old, req.ErrorRate)

		w.Header().Set("Content-Type", "application/json")
		fmt.Fprintf(w, `{"error_rate":%.2f,"previous":%.2f}`, req.ErrorRate, old)
	})

	// GET /chaos — read current chaos config
	mux.HandleFunc("GET /chaos", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		fmt.Fprintf(w, `{"error_rate":%.2f}`, cfg.getErrorRate())
	})

	// Catch-all handler for all other requests
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		// Simulate latency
		latency := cfg.latencyMin
		if cfg.latencyMax > cfg.latencyMin {
			jitter := time.Duration(rand.Int63n(int64(cfg.latencyMax - cfg.latencyMin)))
			latency += jitter
		}
		time.Sleep(latency)

		// Simulate errors based on configured error rate
		if cfg.getErrorRate() > 0 && rand.Float64() < cfg.getErrorRate() {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusInternalServerError)
			fmt.Fprintf(w, `{"error":"simulated failure","service":"%s"}`, cfg.serviceName)
			return
		}

		// Success response
		w.Header().Set("Content-Type", "application/json")
		fmt.Fprintf(w, `{"service":"%s","path":"%s","method":"%s","latency_ms":%d,"timestamp":"%s"}`,
			cfg.serviceName,
			r.URL.Path,
			r.Method,
			latency.Milliseconds(),
			time.Now().Format(time.RFC3339),
		)
	})

	addr := ":" + cfg.port
	log.Printf("mock service %q starting on %s (latency=%s-%s, error_rate=%.2f)",
		cfg.serviceName, addr, cfg.latencyMin, cfg.latencyMax, cfg.errorRate)

	if err := http.ListenAndServe(addr, corsMiddleware(mux)); err != nil {
		log.Fatalf("mock service error: %v", err)
	}
}

func envOrDefault(key, defaultVal string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return defaultVal
}

func parseDurationMs(ms string) time.Duration {
	n, err := strconv.Atoi(ms)
	if err != nil {
		return 10 * time.Millisecond
	}
	return time.Duration(n) * time.Millisecond
}

func parseFloat(s string) float64 {
	f, err := strconv.ParseFloat(s, 64)
	if err != nil {
		return 0.0
	}
	return f
}
