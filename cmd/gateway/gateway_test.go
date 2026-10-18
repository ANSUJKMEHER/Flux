package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"

	"github.com/ANSUJKMEHER/rate-limiter-gateway/internal/breaker"
	"github.com/ANSUJKMEHER/rate-limiter-gateway/internal/config"
	"github.com/ANSUJKMEHER/rate-limiter-gateway/internal/hashring"
	"github.com/ANSUJKMEHER/rate-limiter-gateway/internal/loadbalancer"
	"github.com/ANSUJKMEHER/rate-limiter-gateway/internal/middleware"
	"github.com/ANSUJKMEHER/rate-limiter-gateway/internal/router"
)

func TestGateway_EndToEndSuccess(t *testing.T) {
	// Mock upstream server
	upstreamReceivedPath := ""
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		upstreamReceivedPath = r.URL.Path
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		w.Write([]byte(`{"message":"hello from upstream"}`))
	}))
	defer ts.Close()

	cfg := &config.GatewayConfig{
		Server: config.ServerConfig{ListenAddr: ":8080"},
		Auth: config.AuthConfig{
			Mode:    "api_key",
			APIKeys: map[string]string{"valid-key": "pro"},
		},
		Routes: []config.RouteConfig{
			{
				PathPrefix:  "/api/v1/users",
				Pool:        "users-pool",
				StripPrefix: true,
			},
		},
		Pools: map[string]config.UpstreamPool{
			"users-pool": {
				Strategy: "round_robin",
				Upstreams: []config.UpstreamConfig{
					{ID: "up-users", URL: ts.URL},
				},
			},
		},
	}
	cfgHolder := config.NewConfigHolder(cfg)

	rt := router.New()
	rt.AddRoute(router.Route{
		PathPrefix:  "/api/v1/users",
		Pool:        "users-pool",
		StripPrefix: true,
	})

	up := &loadbalancer.Upstream{ID: "up-users", URL: ts.URL}
	up.SetHealthy(true)
	balancers := map[string]loadbalancer.Balancer{
		"users-pool": loadbalancer.NewRoundRobin([]*loadbalancer.Upstream{up}),
	}
	breakerReg := breaker.NewRegistry(breaker.Settings{FailureThreshold: 3, OpenTimeout: 5 * time.Second})

	sharedTransport := &http.Transport{}
	coreHandler := buildHandler(cfgHolder, nil, hashring.NewRing(10), nil, nil, rt, balancers, breakerReg, nil, sharedTransport)
	handler := middleware.Auth(cfgHolder)(coreHandler)

	req := httptest.NewRequest("GET", "/api/v1/users/profile", nil)
	req.Header.Set("X-API-Key", "valid-key")
	rr := httptest.NewRecorder()

	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200 OK, got %d. Body: %s", rr.Code, rr.Body.String())
	}
	// ARCH-08 verification: path stripped must begin with /
	if upstreamReceivedPath != "/profile" {
		t.Errorf("upstream received path %q, want /profile", upstreamReceivedPath)
	}
}

func TestGateway_RouteAuthRequired(t *testing.T) {
	cfg := &config.GatewayConfig{
		Auth: config.AuthConfig{
			Mode:    "api_key",
			APIKeys: map[string]string{"secret-key": "pro"},
		},
	}
	cfgHolder := config.NewConfigHolder(cfg)

	rt := router.New()
	rt.AddRoute(router.Route{
		PathPrefix:   "/protected",
		Pool:         "p1",
		AuthRequired: true,
	})

	up := &loadbalancer.Upstream{ID: "u1", URL: "http://localhost:9999"}
	up.SetHealthy(true)
	balancers := map[string]loadbalancer.Balancer{
		"p1": loadbalancer.NewRoundRobin([]*loadbalancer.Upstream{up}),
	}
	breakerReg := breaker.NewRegistry(breaker.Settings{})

	handler := middleware.Auth(cfgHolder)(buildHandler(cfgHolder, nil, hashring.NewRing(10), nil, nil, rt, balancers, breakerReg, nil, &http.Transport{}))

	// 1. Without API key -> 401 Unauthorized
	reqAnon := httptest.NewRequest("GET", "/protected/secret", nil)
	rrAnon := httptest.NewRecorder()
	handler.ServeHTTP(rrAnon, reqAnon)
	if rrAnon.Code != http.StatusUnauthorized {
		t.Errorf("expected 401 Unauthorized for route requiring auth, got %d", rrAnon.Code)
	}

	// 2. With invalid API key -> 401 Unauthorized
	reqInvalid := httptest.NewRequest("GET", "/protected/secret", nil)
	reqInvalid.Header.Set("X-API-Key", "wrong-key")
	rrInvalid := httptest.NewRecorder()
	handler.ServeHTTP(rrInvalid, reqInvalid)
	if rrInvalid.Code != http.StatusUnauthorized {
		t.Errorf("expected 401 Unauthorized for wrong key, got %d", rrInvalid.Code)
	}
}

func TestGateway_CircuitBreaker_TripsOnUpstreamFailure(t *testing.T) {
	// REL-01 Regression Test:
	// Verify that upstream 500 errors or proxy failures bubble up to cb.Execute,
	// correctly trip the circuit breaker after FailureThreshold, and return 503.
	var failCount atomic.Int32
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		failCount.Add(1)
		w.WriteHeader(http.StatusInternalServerError)
		w.Write([]byte(`{"error":"internal upstream crash"}`))
	}))
	defer ts.Close()

	cfg := &config.GatewayConfig{}
	cfgHolder := config.NewConfigHolder(cfg)

	rt := router.New()
	rt.AddRoute(router.Route{
		PathPrefix: "/failing",
		Pool:       "fail-pool",
	})

	up := &loadbalancer.Upstream{ID: "failing-upstream", URL: ts.URL}
	up.SetHealthy(true)
	balancers := map[string]loadbalancer.Balancer{
		"fail-pool": loadbalancer.NewRoundRobin([]*loadbalancer.Upstream{up}),
	}

	// Set threshold to 3 consecutive failures
	threshold := 3
	breakerReg := breaker.NewRegistry(breaker.Settings{
		FailureThreshold: threshold,
		OpenTimeout:      10 * time.Second,
	})

	handler := buildHandler(cfgHolder, nil, hashring.NewRing(10), nil, nil, rt, balancers, breakerReg, nil, &http.Transport{})

	// Send 3 requests that fail with 500 from upstream
	for i := 0; i < threshold; i++ {
		req := httptest.NewRequest("GET", "/failing/item", nil)
		rr := httptest.NewRecorder()
		handler.ServeHTTP(rr, req)
		if rr.Code != http.StatusBadGateway {
			t.Errorf("request %d: expected 502 Bad Gateway from failing upstream, got %d", i+1, rr.Code)
		}
	}

	// 4th request: Circuit breaker MUST BE OPEN and return 503 Service Unavailable immediately
	cb := breakerReg.Get("failing-upstream")
	if cb.State() != breaker.StateOpen {
		t.Fatalf("CRITICAL BUG: circuit breaker did not trip! State is %s, want open", cb.State())
	}

	reqBlocked := httptest.NewRequest("GET", "/failing/item", nil)
	rrBlocked := httptest.NewRecorder()
	handler.ServeHTTP(rrBlocked, reqBlocked)

	if rrBlocked.Code != http.StatusServiceUnavailable {
		t.Errorf("expected 503 Service Unavailable when circuit breaker is open, got %d", rrBlocked.Code)
	}

	var errResp map[string]string
	if err := json.Unmarshal(rrBlocked.Body.Bytes(), &errResp); err != nil {
		t.Fatalf("failed to parse json error: %v", err)
	}
	if errResp["error"] != "circuit breaker open for upstream failing-upstream" {
		t.Errorf("unexpected error payload: %v", errResp)
	}
}
