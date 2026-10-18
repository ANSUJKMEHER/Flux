// Package middleware provides HTTP middleware for the API gateway.
//
// Available middleware:
//   - Auth: API-key / JWT validation
//   - Logging: structured request/response logging
//   - Metrics: Prometheus instrumentation
//   - RequestID: UUID generation for request tracing
package middleware

import (
	"context"
	"crypto/subtle"
	"fmt"
	"net/http"
	"strings"

	"github.com/ANSUJKMEHER/rate-limiter-gateway/internal/config"
)

// contextKey is an unexported type for context keys in this package.
type contextKey string

const (
	// TierKey is the context key for the authenticated rate-limit tier.
	TierKey contextKey = "tier"
	// APIKeyKey is the context key for the raw API key.
	APIKeyKey contextKey = "api_key"
	// RequestIDKey is the context key for the request ID.
	RequestIDKey contextKey = "request_id"
)

// GetTier extracts the rate-limit tier from the request context.
func GetTier(ctx context.Context) string {
	if v, ok := ctx.Value(TierKey).(string); ok {
		return v
	}
	return "free"
}

// GetAPIKey extracts the API key from the request context.
func GetAPIKey(ctx context.Context) string {
	if v, ok := ctx.Value(APIKeyKey).(string); ok {
		return v
	}
	return ""
}

// GetRequestID extracts the request ID from the request context.
func GetRequestID(ctx context.Context) string {
	if v, ok := ctx.Value(RequestIDKey).(string); ok {
		return v
	}
	return ""
}

// matchAPIKey performs constant-time comparison against configured API keys.
func matchAPIKey(provided string, keys map[string]string) (string, bool) {
	if provided == "" || len(keys) == 0 {
		return "", false
	}
	var matchedTier string
	var found bool
	providedBytes := []byte(provided)
	for k, t := range keys {
		kBytes := []byte(k)
		if subtle.ConstantTimeCompare(kBytes, providedBytes) == 1 {
			matchedTier = t
			found = true
		}
	}
	return matchedTier, found
}

// Auth returns middleware that validates API keys and sets the tier in context.
// Requests without an API key default to "free" tier.
// Invalid keys are rejected with 401 Unauthorized.
func Auth(cfgHolder *config.ConfigHolder) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			cfg := cfgHolder.Get()

			apiKey := r.Header.Get("X-API-Key")
			// Also check Bearer token if X-API-Key is not set
			if apiKey == "" {
				authHeader := r.Header.Get("Authorization")
				if strings.HasPrefix(authHeader, "Bearer ") {
					apiKey = strings.TrimPrefix(authHeader, "Bearer ")
				}
			}

			tier := "free"

			if apiKey != "" {
				if t, ok := matchAPIKey(apiKey, cfg.Auth.APIKeys); ok {
					tier = t
				} else {
					w.Header().Set("Content-Type", "application/json")
					w.WriteHeader(http.StatusUnauthorized)
					fmt.Fprint(w, `{"error":"invalid API key or credentials"}`)
					return
				}
			}

			ctx := context.WithValue(r.Context(), TierKey, tier)
			ctx = context.WithValue(ctx, APIKeyKey, apiKey)
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}
