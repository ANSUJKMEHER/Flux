package router

import (
	"net/http"
	"testing"
)

func TestMatch_PathPrefix(t *testing.T) {
	r := New()
	r.AddRoute(Route{PathPrefix: "/api/v1/users", Pool: "users"})
	r.AddRoute(Route{PathPrefix: "/api/v1/orders", Pool: "orders"})

	tests := []struct {
		path     string
		wantPool string
		wantOk   bool
	}{
		{"/api/v1/users", "users", true},
		{"/api/v1/users/123", "users", true},
		{"/api/v1/orders", "orders", true},
		{"/api/v1/orders/456/items", "orders", true},
		{"/api/v2/users", "", false},
		{"/", "", false},
		{"/api/v1/products", "", false},
	}

	for _, tt := range tests {
		req, _ := http.NewRequest("GET", "http://localhost"+tt.path, nil)
		got, ok := r.Match(req)
		if ok != tt.wantOk {
			t.Errorf("Match(%q): ok=%v, want %v", tt.path, ok, tt.wantOk)
			continue
		}
		if ok && got.Pool != tt.wantPool {
			t.Errorf("Match(%q): pool=%q, want %q", tt.path, got.Pool, tt.wantPool)
		}
	}
}

func TestMatch_FirstMatchWins(t *testing.T) {
	r := New()
	r.AddRoute(Route{PathPrefix: "/api", Pool: "catch-all"})
	r.AddRoute(Route{PathPrefix: "/api/v1/users", Pool: "users"})

	req, _ := http.NewRequest("GET", "http://localhost/api/v1/users", nil)
	got, ok := r.Match(req)
	if !ok || got.Pool != "catch-all" {
		t.Errorf("expected catch-all (first match), got pool=%q ok=%v", got.Pool, ok)
	}
}

func TestMatch_HostBased(t *testing.T) {
	r := New()
	r.AddRoute(Route{PathPrefix: "/api", Host: "api.example.com", Pool: "api"})
	r.AddRoute(Route{PathPrefix: "/api", Pool: "default"})

	// Match with correct host
	req, _ := http.NewRequest("GET", "http://api.example.com/api/v1", nil)
	got, ok := r.Match(req)
	if !ok || got.Pool != "api" {
		t.Errorf("host match: pool=%q ok=%v, want api", got.Pool, ok)
	}

	// Wrong host should fall through to default
	req, _ = http.NewRequest("GET", "http://other.com/api/v1", nil)
	got, ok = r.Match(req)
	if !ok || got.Pool != "default" {
		t.Errorf("host fallthrough: pool=%q ok=%v, want default", got.Pool, ok)
	}
}

func TestMatch_HostWithPort(t *testing.T) {
	r := New()
	r.AddRoute(Route{PathPrefix: "/api", Host: "api.example.com", Pool: "api"})

	// Host header with port should still match
	req, _ := http.NewRequest("GET", "http://api.example.com:8080/api/v1", nil)
	got, ok := r.Match(req)
	if !ok || got.Pool != "api" {
		t.Errorf("host+port match: pool=%q ok=%v, want api", got.Pool, ok)
	}
}

func TestSwapRoutes(t *testing.T) {
	r := New()
	r.AddRoute(Route{PathPrefix: "/old", Pool: "old-pool"})

	// Swap to new routes
	r.SwapRoutes([]Route{
		{PathPrefix: "/new", Pool: "new-pool"},
	})

	req, _ := http.NewRequest("GET", "http://localhost/old", nil)
	_, ok := r.Match(req)
	if ok {
		t.Error("old route should not match after swap")
	}

	req, _ = http.NewRequest("GET", "http://localhost/new", nil)
	got, ok := r.Match(req)
	if !ok || got.Pool != "new-pool" {
		t.Errorf("new route: pool=%q ok=%v, want new-pool", got.Pool, ok)
	}
}

func TestRouteCount(t *testing.T) {
	r := New()
	if r.RouteCount() != 0 {
		t.Errorf("initial RouteCount = %d, want 0", r.RouteCount())
	}
	r.AddRoute(Route{PathPrefix: "/a", Pool: "a"})
	r.AddRoute(Route{PathPrefix: "/b", Pool: "b"})
	if r.RouteCount() != 2 {
		t.Errorf("RouteCount = %d, want 2", r.RouteCount())
	}
}

func BenchmarkMatch(b *testing.B) {
	r := New()
	for i := 0; i < 20; i++ {
		r.AddRoute(Route{PathPrefix: "/api/v1/service" + string(rune('A'+i)), Pool: "pool"})
	}

	req, _ := http.NewRequest("GET", "http://localhost/api/v1/serviceT/resource", nil)
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		r.Match(req)
	}
}
