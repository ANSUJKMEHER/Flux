// Package health implements active and passive health checking for upstream services.
//
// Active checks: periodic HTTP GET to each upstream's health endpoint.
// Passive checks: integrated via the circuit breaker — real traffic errors
// automatically affect upstream health status.
//
// Each upstream runs its own health check goroutine, controlled via context
// cancellation for clean shutdown.
package health

import (
	"context"
	"log"
	"net/http"
	"sync"
	"time"

	"github.com/ANSUJKMEHER/rate-limiter-gateway/internal/loadbalancer"
)

// CheckerConfig configures the health checker behavior.
type CheckerConfig struct {
	Interval  time.Duration // how often to probe each upstream
	Timeout   time.Duration // per-probe HTTP timeout
	Path      string        // HTTP path to check (e.g., "/health")
	Threshold int           // consecutive failures to mark unhealthy
}

// Checker performs active health checks on a set of upstreams.
type Checker struct {
	config    CheckerConfig
	client    *http.Client
	upstreams []*loadbalancer.Upstream

	mu             sync.Mutex
	failureCounts  map[string]int // upstream ID -> consecutive failure count
	cancel         context.CancelFunc
}

// NewChecker creates a health checker for the given upstreams.
func NewChecker(cfg CheckerConfig, upstreams []*loadbalancer.Upstream) *Checker {
	if cfg.Interval <= 0 {
		cfg.Interval = 10 * time.Second
	}
	if cfg.Timeout <= 0 {
		cfg.Timeout = 2 * time.Second
	}
	if cfg.Path == "" {
		cfg.Path = "/health"
	}
	if cfg.Threshold <= 0 {
		cfg.Threshold = 3
	}

	return &Checker{
		config:        cfg,
		client:        &http.Client{Timeout: cfg.Timeout},
		upstreams:     upstreams,
		failureCounts: make(map[string]int),
	}
}

// Start begins health checking all upstreams in background goroutines.
// Call Stop() to shut down all checks cleanly.
func (c *Checker) Start() {
	ctx, cancel := context.WithCancel(context.Background())
	c.cancel = cancel

	for _, up := range c.upstreams {
		go c.checkLoop(ctx, up)
	}

	log.Printf("health checker started for %d upstreams (interval=%s, path=%s)",
		len(c.upstreams), c.config.Interval, c.config.Path)
}

// Stop cancels all health check goroutines.
func (c *Checker) Stop() {
	if c.cancel != nil {
		c.cancel()
		log.Println("health checker stopped")
	}
}

// checkLoop runs periodic health checks for a single upstream.
func (c *Checker) checkLoop(ctx context.Context, up *loadbalancer.Upstream) {
	ticker := time.NewTicker(c.config.Interval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			c.probe(ctx, up)
		}
	}
}

// probe performs a single health check against an upstream.
func (c *Checker) probe(ctx context.Context, up *loadbalancer.Upstream) {
	url := up.URL + c.config.Path

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		c.recordFailure(up)
		return
	}

	resp, err := c.client.Do(req)
	if err != nil {
		c.recordFailure(up)
		return
	}
	resp.Body.Close()

	if resp.StatusCode >= 200 && resp.StatusCode < 400 {
		c.recordSuccess(up)
	} else {
		c.recordFailure(up)
	}
}

// recordFailure increments the consecutive failure count and marks unhealthy if threshold hit.
func (c *Checker) recordFailure(up *loadbalancer.Upstream) {
	c.mu.Lock()
	defer c.mu.Unlock()

	c.failureCounts[up.ID]++
	if c.failureCounts[up.ID] >= c.config.Threshold {
		if up.IsHealthy() {
			log.Printf("health: upstream %s marked UNHEALTHY after %d consecutive failures",
				up.ID, c.failureCounts[up.ID])
			up.SetHealthy(false)
		}
	}
}

// recordSuccess resets the failure counter and marks the upstream healthy.
func (c *Checker) recordSuccess(up *loadbalancer.Upstream) {
	c.mu.Lock()
	defer c.mu.Unlock()

	c.failureCounts[up.ID] = 0
	if !up.IsHealthy() {
		log.Printf("health: upstream %s marked HEALTHY (recovered)", up.ID)
		up.SetHealthy(true)
	}
}
