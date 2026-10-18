package admin

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/ANSUJKMEHER/rate-limiter-gateway/internal/breaker"
	"github.com/ANSUJKMEHER/rate-limiter-gateway/internal/config"
	"github.com/ANSUJKMEHER/rate-limiter-gateway/internal/loadbalancer"
)

func TestAdmin_SanitizedConfig(t *testing.T) {
	cfg := &config.GatewayConfig{
		Server: config.ServerConfig{ListenAddr: ":8080"},
		Admin:  config.AdminConfig{ListenAddr: ":9091", Enabled: true},
		Redis:  config.RedisConfig{Addr: "localhost:6379", Password: "super-secret-password"},
		Auth: config.AuthConfig{
			Mode:    "api_key",
			APIKeys: map[string]string{"secret-key-1": "pro", "secret-key-2": "enterprise"},
			JWT:     config.JWTConfig{Secret: "top-secret-jwt-signing-key", Issuer: "flux-issuer"},
		},
	}
	holder := config.NewConfigHolder(cfg)
	bReg := breaker.NewRegistry(breaker.Settings{})

	srv := NewServer(holder, nil, bReg, nil)
	handler := srv.Handler()

	req := httptest.NewRequest("GET", "/admin/config", nil)
	rr := httptest.NewRecorder()

	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("got status %d, want 200", rr.Code)
	}

	body := rr.Body.String()
	// Must NOT contain sensitive credentials
	if bytes.Contains([]byte(body), []byte("super-secret-password")) {
		t.Error("CRITICAL: sanitized config leaked Redis password!")
	}
	if bytes.Contains([]byte(body), []byte("secret-key-1")) || bytes.Contains([]byte(body), []byte("secret-key-2")) {
		t.Error("CRITICAL: sanitized config leaked customer API keys!")
	}
	if bytes.Contains([]byte(body), []byte("top-secret-jwt-signing-key")) {
		t.Error("CRITICAL: sanitized config leaked JWT signing secret!")
	}

	var parsed SanitizedConfig
	if err := json.Unmarshal(rr.Body.Bytes(), &parsed); err != nil {
		t.Fatalf("failed to decode sanitized json: %v", err)
	}
	if parsed.Auth.ConfiguredKeys != 2 {
		t.Errorf("got configured_keys_count = %d, want 2", parsed.Auth.ConfiguredKeys)
	}
	if !parsed.Auth.JWTEnabled {
		t.Error("expected JWTEnabled = true")
	}
}

func TestAdmin_CORS_RestrictedOrigins(t *testing.T) {
	cfg := &config.GatewayConfig{
		Admin: config.AdminConfig{
			AllowedOrigins: []string{"https://admin.internal.net"},
		},
	}
	holder := config.NewConfigHolder(cfg)
	srv := NewServer(holder, nil, breaker.NewRegistry(breaker.Settings{}), nil)
	handler := srv.Handler()

	// 1. Untrusted origin should be forbidden (403)
	reqBad := httptest.NewRequest("GET", "/admin/health", nil)
	reqBad.Header.Set("Origin", "https://malicious-site.com")
	rrBad := httptest.NewRecorder()
	handler.ServeHTTP(rrBad, reqBad)
	if rrBad.Code != http.StatusForbidden {
		t.Errorf("untrusted origin: got status %d, want 403 Forbidden", rrBad.Code)
	}

	// 2. Trusted origin should be allowed
	reqGood := httptest.NewRequest("GET", "/admin/health", nil)
	reqGood.Header.Set("Origin", "https://admin.internal.net")
	rrGood := httptest.NewRecorder()
	handler.ServeHTTP(rrGood, reqGood)
	if rrGood.Code != http.StatusOK {
		t.Errorf("trusted origin: got status %d, want 200 OK", rrGood.Code)
	}
	if got := rrGood.Header().Get("Access-Control-Allow-Origin"); got != "https://admin.internal.net" {
		t.Errorf("got allow origin %q, want https://admin.internal.net", got)
	}
}

func TestAdmin_TokenAuthentication(t *testing.T) {
	cfg := &config.GatewayConfig{
		Admin: config.AdminConfig{
			Token: "secure-admin-token-12345",
		},
	}
	holder := config.NewConfigHolder(cfg)
	srv := NewServer(holder, nil, breaker.NewRegistry(breaker.Settings{}), nil)
	handler := srv.Handler()

	// 1. Missing token -> 401 Unauthorized
	reqNoAuth := httptest.NewRequest("GET", "/admin/stats", nil)
	rrNoAuth := httptest.NewRecorder()
	handler.ServeHTTP(rrNoAuth, reqNoAuth)
	if rrNoAuth.Code != http.StatusUnauthorized {
		t.Errorf("missing token: got status %d, want 401", rrNoAuth.Code)
	}

	// 2. Valid token -> 200 OK
	reqAuth := httptest.NewRequest("GET", "/admin/stats", nil)
	reqAuth.Header.Set("Authorization", "Bearer secure-admin-token-12345")
	rrAuth := httptest.NewRecorder()
	handler.ServeHTTP(rrAuth, reqAuth)
	if rrAuth.Code != http.StatusOK {
		t.Errorf("valid token: got status %d, want 200", rrAuth.Code)
	}
}

func TestAdmin_PutConfig_HotReload(t *testing.T) {
	cfg := &config.GatewayConfig{
		Server: config.ServerConfig{ListenAddr: ":8080"},
		Routes: []config.RouteConfig{{PathPrefix: "/initial", Pool: "default"}},
		Pools:  map[string]config.UpstreamPool{"default": {Strategy: "round_robin", Upstreams: []config.UpstreamConfig{{ID: "u1", URL: "http://localhost"}}}},
	}
	holder := config.NewConfigHolder(cfg)
	srv := NewServer(holder, nil, breaker.NewRegistry(breaker.Settings{}), nil)
	handler := srv.Handler()

	newYAML := `
server:
  listen_addr: ":9000"
routes:
  - path_prefix: "/reloaded"
    pool: "default"
pools:
  default:
    strategy: "round_robin"
    upstreams:
      - id: "u1"
        url: "http://localhost"
`
	req := httptest.NewRequest("PUT", "/admin/config", bytes.NewBufferString(newYAML))
	rr := httptest.NewRecorder()
	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("PUT /admin/config failed: %d, body: %s", rr.Code, rr.Body.String())
	}

	updated := holder.Get()
	if updated.Server.ListenAddr != ":9000" {
		t.Errorf("got updated listen addr %q, want :9000", updated.Server.ListenAddr)
	}
	if len(updated.Routes) != 1 || updated.Routes[0].PathPrefix != "/reloaded" {
		t.Errorf("routes not updated properly: %+v", updated.Routes)
	}
}

func TestAdmin_ListUpstreams(t *testing.T) {
	up := &loadbalancer.Upstream{ID: "up-a", URL: "http://localhost:9001"}
	up.SetHealthy(true)
	upstreams := map[string][]*loadbalancer.Upstream{
		"pool-1": {up},
	}
	srv := NewServer(config.NewConfigHolder(&config.GatewayConfig{}), upstreams, breaker.NewRegistry(breaker.Settings{}), nil)

	req := httptest.NewRequest("GET", "/admin/upstreams", nil)
	rr := httptest.NewRecorder()
	srv.Handler().ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Errorf("got status %d, want 200", rr.Code)
	}
	var statuses []upstreamStatus
	if err := json.Unmarshal(rr.Body.Bytes(), &statuses); err != nil {
		t.Fatalf("failed to decode upstreams JSON: %v", err)
	}
	if len(statuses) != 1 || statuses[0].ID != "up-a" {
		t.Errorf("unexpected upstreams response: %+v", statuses)
	}
}
