package middleware

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestMetrics_PathNormalization(t *testing.T) {
	ctx := context.Background()
	if GetMatchedPath(ctx) != "unmatched" {
		t.Errorf("expected default unmatched, got %q", GetMatchedPath(ctx))
	}

	ctx = SetMatchedPath(ctx, "/api/v1/users")
	if GetMatchedPath(ctx) != "/api/v1/users" {
		t.Errorf("expected /api/v1/users, got %q", GetMatchedPath(ctx))
	}
}

func TestMetrics_MiddlewareExecution(t *testing.T) {
	called := false
	baseHandler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		called = true
		w.WriteHeader(http.StatusOK)
	})

	handler := Metrics()(baseHandler)

	req := httptest.NewRequest("GET", "/some/random/uuid-12345", nil)
	// Normal route matching sets matched prefix
	req = req.WithContext(SetMatchedPath(req.Context(), "/some/random"))
	rr := httptest.NewRecorder()

	handler.ServeHTTP(rr, req)

	if !called {
		t.Error("inner handler was not called")
	}
	if rr.Code != http.StatusOK {
		t.Errorf("got status %d, want 200", rr.Code)
	}
}
