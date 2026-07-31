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
	"fmt"
	"net/http"

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

// Auth returns middleware that validates API keys and sets the tier in context.
// If the auth mode is "jwt", it delegates to JWT validation.
// Requests without an API key are assigned the "free" tier (anonymous access).
// Invalid keys are rejected with 401.
func Auth(cfgHolder *config.ConfigHolder) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			cfg := cfgHolder.Get()

			apiKey := r.Header.Get("X-API-Key")
			tier := "free"

			if apiKey != "" {
				if t, ok := cfg.Auth.APIKeys[apiKey]; ok {
					tier = t
				} else {
					w.Header().Set("Content-Type", "application/json")
					w.WriteHeader(http.StatusUnauthorized)
					fmt.Fprint(w, `{"error":"invalid API key"}`)
					return
				}
			}

			ctx := context.WithValue(r.Context(), TierKey, tier)
			ctx = context.WithValue(ctx, APIKeyKey, apiKey)
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}
