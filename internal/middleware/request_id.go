package middleware

import (
	"context"
	"crypto/rand"
	"encoding/binary"
	"encoding/hex"
	"net/http"
	"regexp"
	"sync/atomic"
	"time"
)

var validRequestIDPattern = regexp.MustCompile(`^[a-zA-Z0-9_\-]{1,64}$`)
var fallbackReqSeq atomic.Uint64

// RequestID returns middleware that generates a unique request ID for each request.
// The ID is set on both the request context and the response X-Request-ID header.
// If the incoming request already has a valid X-Request-ID header, it is preserved.
func RequestID() func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			id := r.Header.Get("X-Request-ID")
			if id == "" || !validRequestIDPattern.MatchString(id) {
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

// generateID creates a 16-character hex string (8 random bytes), with fallback on entropy error.
func generateID() string {
	b := make([]byte, 8)
	if _, err := rand.Read(b); err != nil {
		// Fallback to timestamp + atomic sequence
		nowNano := uint64(time.Now().UnixNano())
		seq := fallbackReqSeq.Add(1)
		binary.BigEndian.PutUint64(b, nowNano^seq)
	}
	return hex.EncodeToString(b)
}
