package middleware

import (
	"net/http"
	"strconv"
	"time"

	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promauto"
)

// Prometheus metrics for the gateway.
var (
	// RequestsTotal counts all HTTP requests by method, path, status, and tier.
	RequestsTotal = promauto.NewCounterVec(
		prometheus.CounterOpts{
			Namespace: "gateway",
			Name:      "requests_total",
			Help:      "Total number of HTTP requests processed by the gateway.",
		},
		[]string{"method", "path", "status", "tier"},
	)

	// RequestDuration observes request latency by method and path.
	RequestDuration = promauto.NewHistogramVec(
		prometheus.HistogramOpts{
			Namespace: "gateway",
			Name:      "request_duration_seconds",
			Help:      "Latency of HTTP requests in seconds.",
			Buckets:   []float64{0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1.0, 2.5, 5.0},
		},
		[]string{"method", "path"},
	)

	// RateLimitDecisions counts rate limiter allow/deny decisions.
	RateLimitDecisions = promauto.NewCounterVec(
		prometheus.CounterOpts{
			Namespace: "gateway",
			Name:      "rate_limit_decisions_total",
			Help:      "Total rate limiter decisions (allowed or denied).",
		},
		[]string{"decision", "tier", "algorithm"},
	)

	// CircuitBreakerState tracks the current state of each upstream's circuit breaker.
	CircuitBreakerState = promauto.NewGaugeVec(
		prometheus.GaugeOpts{
			Namespace: "gateway",
			Name:      "circuit_breaker_state",
			Help:      "Circuit breaker state (0=closed, 1=open, 2=half-open).",
		},
		[]string{"upstream"},
	)

	// UpstreamActiveConnections tracks active connections per upstream.
	UpstreamActiveConnections = promauto.NewGaugeVec(
		prometheus.GaugeOpts{
			Namespace: "gateway",
			Name:      "upstream_active_connections",
			Help:      "Number of active connections to each upstream.",
		},
		[]string{"upstream"},
	)
)

// Metrics returns middleware that records Prometheus metrics for each request.
func Metrics() func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			start := time.Now()
			rc := newResponseCapture(w)

			next.ServeHTTP(rc, r)

			duration := time.Since(start).Seconds()
			tier := GetTier(r.Context())

			// Normalize path to avoid cardinality explosion
			// In production you'd use a route template, but for the demo
			// we use the matched route prefix (set by the handler)
			path := r.URL.Path

			RequestsTotal.WithLabelValues(
				r.Method,
				path,
				strconv.Itoa(rc.statusCode),
				tier,
			).Inc()

			RequestDuration.WithLabelValues(
				r.Method,
				path,
			).Observe(duration)
		})
	}
}
