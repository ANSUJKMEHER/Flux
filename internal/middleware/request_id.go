package middleware

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"net/http"
)

// RequestID returns middleware that generates a unique request ID for each request.
// The ID is set on both the request context and the response X-Request-ID header.
// If the incoming request already has an X-Request-ID header, it is preserved.
func RequestID() func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			id := r.Header.Get("X-Request-ID")
			if id == "" {
				id = generateID()
			}

			// Set on response header
			w.Header().Set("X-Request-ID", id)

			// Set in context for downstream middleware (logging, metrics)
			ctx := context.WithValue(r.Context(), RequestIDKey, id)
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

// generateID creates a 16-character hex string (8 random bytes).
func generateID() string {
	b := make([]byte, 8)
	rand.Read(b)
	return hex.EncodeToString(b)
}
