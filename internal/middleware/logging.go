package middleware

import (
	"log"
	"net/http"
	"time"
)

// responseCapture wraps http.ResponseWriter to capture the status code.
type responseCapture struct {
	http.ResponseWriter
	statusCode int
	written    int64
}

func newResponseCapture(w http.ResponseWriter) *responseCapture {
	return &responseCapture{ResponseWriter: w, statusCode: http.StatusOK}
}

func (rc *responseCapture) WriteHeader(code int) {
	rc.statusCode = code
	rc.ResponseWriter.WriteHeader(code)
}

func (rc *responseCapture) Write(b []byte) (int, error) {
	n, err := rc.ResponseWriter.Write(b)
	rc.written += int64(n)
	return n, err
}

// Logging returns middleware that logs each request with method, path, status,
// latency, and client IP.
func Logging() func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			start := time.Now()
			rc := newResponseCapture(w)

			next.ServeHTTP(rc, r)

			latency := time.Since(start)
			reqID := GetRequestID(r.Context())

			log.Printf("[%s] %s %s %s → %d (%s, %d bytes)",
				reqID,
				r.RemoteAddr,
				r.Method,
				r.URL.Path,
				rc.statusCode,
				latency.Round(time.Microsecond),
				rc.written,
			)
		})
	}
}
