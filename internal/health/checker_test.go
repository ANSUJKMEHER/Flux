package health

import (
	"context"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"

	"github.com/ANSUJKMEHER/rate-limiter-gateway/internal/loadbalancer"
)

func TestChecker_ProbeAndHysteresis(t *testing.T) {
	var statusCode atomic.Int32
	statusCode.Store(http.StatusOK)

	// Mock upstream server
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		code := int(statusCode.Load())
		w.WriteHeader(code)
		if code == http.StatusOK {
			w.Write([]byte(`{"status":"healthy"}`))
		}
	}))
	defer ts.Close()

	up := &loadbalancer.Upstream{
		ID:  "mock-upstream-1",
		URL: ts.URL,
	}
	up.SetHealthy(true)

	cfg := CheckerConfig{
		Interval:  20 * time.Millisecond,
		Timeout:   100 * time.Millisecond,
		Path:      "/health",
		Threshold: 3,
	}

	checker := NewChecker(cfg, []*loadbalancer.Upstream{up})

	// 1. Initial manual probe should keep it healthy
	checker.probe(context.Background(), up)
	if !up.IsHealthy() {
		t.Error("upstream should be healthy initially")
	}

	// 2. Simulate 2 failures: should NOT yet be marked unhealthy (Threshold = 3)
	statusCode.Store(http.StatusInternalServerError)
	checker.probe(context.Background(), up)
	checker.probe(context.Background(), up)
	if !up.IsHealthy() {
		t.Error("upstream should still be healthy after only 2 failures")
	}

	// 3. Third failure: should be marked UNHEALTHY
	checker.probe(context.Background(), up)
	if up.IsHealthy() {
		t.Error("upstream should be marked UNHEALTHY after 3 consecutive failures")
	}

	// 4. Test Hysteresis: 1 success should NOT restore health immediately
	statusCode.Store(http.StatusOK)
	checker.probe(context.Background(), up)
	if up.IsHealthy() {
		t.Error("upstream should NOT recover on a single success (hysteresis flapping protection)")
	}

	// 5. Second consecutive success: should recover to healthy
	checker.probe(context.Background(), up)
	if !up.IsHealthy() {
		t.Error("upstream should be marked healthy after 2 consecutive successes")
	}
}

func TestChecker_StartStop(t *testing.T) {
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	defer ts.Close()

	up := &loadbalancer.Upstream{
		ID:  "mock-upstream-2",
		URL: ts.URL,
	}
	up.SetHealthy(true)

	cfg := CheckerConfig{
		Interval:  10 * time.Millisecond,
		Timeout:   50 * time.Millisecond,
		Path:      "/health",
		Threshold: 2,
	}

	checker := NewChecker(cfg, []*loadbalancer.Upstream{up})
	checker.Start()
	time.Sleep(30 * time.Millisecond)
	checker.Stop()
	// Should terminate cleanly without hanging or panicking
}
