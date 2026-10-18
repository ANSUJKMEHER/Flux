package middleware

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/ANSUJKMEHER/rate-limiter-gateway/internal/config"
)

func TestAuth_MissingKey_DefaultsToFree(t *testing.T) {
	cfg := &config.GatewayConfig{
		Auth: config.AuthConfig{
			Mode:    "api_key",
			APIKeys: map[string]string{"secret-key": "pro"},
		},
	}
	holder := config.NewConfigHolder(cfg)

	var recordedTier string
	var recordedKey string
	testHandler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		recordedTier = GetTier(r.Context())
		recordedKey = GetAPIKey(r.Context())
		w.WriteHeader(http.StatusOK)
	})

	handler := Auth(holder)(testHandler)
	req := httptest.NewRequest("GET", "/test", nil)
	rr := httptest.NewRecorder()

	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Errorf("got status %d, want 200", rr.Code)
	}
	if recordedTier != "free" {
		t.Errorf("got tier %q, want free", recordedTier)
	}
	if recordedKey != "" {
		t.Errorf("got key %q, want empty", recordedKey)
	}
}

func TestAuth_ValidKey_Header(t *testing.T) {
	cfg := &config.GatewayConfig{
		Auth: config.AuthConfig{
			Mode:    "api_key",
			APIKeys: map[string]string{"pro-key-123": "pro", "ent-key-456": "enterprise"},
		},
	}
	holder := config.NewConfigHolder(cfg)

	var recordedTier string
	testHandler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		recordedTier = GetTier(r.Context())
		w.WriteHeader(http.StatusOK)
	})

	handler := Auth(holder)(testHandler)

	req := httptest.NewRequest("GET", "/test", nil)
	req.Header.Set("X-API-Key", "pro-key-123")
	rr := httptest.NewRecorder()

	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Errorf("got status %d, want 200", rr.Code)
	}
	if recordedTier != "pro" {
		t.Errorf("got tier %q, want pro", recordedTier)
	}
}

func TestAuth_BearerTokenFallback(t *testing.T) {
	cfg := &config.GatewayConfig{
		Auth: config.AuthConfig{
			Mode:    "api_key",
			APIKeys: map[string]string{"bearer-key": "enterprise"},
		},
	}
	holder := config.NewConfigHolder(cfg)

	var recordedTier string
	testHandler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		recordedTier = GetTier(r.Context())
		w.WriteHeader(http.StatusOK)
	})

	handler := Auth(holder)(testHandler)

	req := httptest.NewRequest("GET", "/test", nil)
	req.Header.Set("Authorization", "Bearer bearer-key")
	rr := httptest.NewRecorder()

	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Errorf("got status %d, want 200", rr.Code)
	}
	if recordedTier != "enterprise" {
		t.Errorf("got tier %q, want enterprise", recordedTier)
	}
}

func TestAuth_InvalidKey_Returns401(t *testing.T) {
	cfg := &config.GatewayConfig{
		Auth: config.AuthConfig{
			Mode:    "api_key",
			APIKeys: map[string]string{"real-key": "pro"},
		},
	}
	holder := config.NewConfigHolder(cfg)

	testHandler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	})

	handler := Auth(holder)(testHandler)

	req := httptest.NewRequest("GET", "/test", nil)
	req.Header.Set("X-API-Key", "attacker-bogus-key")
	rr := httptest.NewRecorder()

	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusUnauthorized {
		t.Errorf("got status %d, want 401 Unauthorized", rr.Code)
	}
}
