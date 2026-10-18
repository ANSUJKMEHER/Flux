package middleware

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestRequestID_GeneratesIfMissing(t *testing.T) {
	var ctxID string
	testHandler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ctxID = GetRequestID(r.Context())
		w.WriteHeader(http.StatusOK)
	})

	handler := RequestID()(testHandler)
	req := httptest.NewRequest("GET", "/", nil)
	rr := httptest.NewRecorder()

	handler.ServeHTTP(rr, req)

	respID := rr.Header().Get("X-Request-ID")
	if respID == "" {
		t.Fatal("expected X-Request-ID header on response")
	}
	if len(respID) != 16 {
		t.Errorf("expected 16-hex char ID, got %q (len %d)", respID, len(respID))
	}
	if ctxID != respID {
		t.Errorf("context ID %q does not match header ID %q", ctxID, respID)
	}
}

func TestRequestID_PreservesValidIncoming(t *testing.T) {
	testHandler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	})

	handler := RequestID()(testHandler)
	req := httptest.NewRequest("GET", "/", nil)
	req.Header.Set("X-Request-ID", "client-trace-1234")
	rr := httptest.NewRecorder()

	handler.ServeHTTP(rr, req)

	if got := rr.Header().Get("X-Request-ID"); got != "client-trace-1234" {
		t.Errorf("got X-Request-ID %q, want client-trace-1234", got)
	}
}

func TestRequestID_SanitizesCRLFLogInjection(t *testing.T) {
	testHandler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	})

	handler := RequestID()(testHandler)
	req := httptest.NewRequest("GET", "/", nil)
	// Malicious header attempting log injection
	req.Header.Set("X-Request-ID", "malicious\r\nInjected-Header: evil")
	rr := httptest.NewRecorder()

	handler.ServeHTTP(rr, req)

	got := rr.Header().Get("X-Request-ID")
	if got == "malicious\r\nInjected-Header: evil" {
		t.Errorf("expected CRLF header to be sanitized, got verbatim: %q", got)
	}
	if len(got) != 16 {
		t.Errorf("expected fresh 16-char generated ID, got: %q", got)
	}
}
