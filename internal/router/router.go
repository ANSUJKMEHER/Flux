// Package router implements path-based and host-based request routing.
//
// Routes are evaluated in order (first match wins) and support:
//   - Path prefix matching (e.g., "/api/v1/users" matches "/api/v1/users/123")
//   - Optional host-based matching (e.g., "api.example.com")
//   - Prefix stripping before forwarding to upstream
//   - Per-route rate limit tier and algorithm overrides
//
// The route table can be atomically swapped at runtime for hot reload.
package router

import (
	"net/http"
	"strings"
	"sync/atomic"
)

// Route defines a single routing rule.
type Route struct {
	PathPrefix    string // required: matches if request path starts with this
	Host          string // optional: if set, must match request Host header
	StripPrefix   bool   // if true, strip PathPrefix before forwarding
	Pool          string // upstream pool name
	RateLimitTier string // override auth-derived tier (empty = use auth tier)
	Algorithm     string // override tier algorithm (empty = use tier default)
}

// Router performs first-match routing against an ordered list of routes.
type Router struct {
	routes atomic.Value // stores []Route
}

// New creates a Router with an empty route table.
func New() *Router {
	r := &Router{}
	r.routes.Store([]Route{})
	return r
}

// AddRoute appends a route to the table. Not safe for concurrent use during
// request handling — use SwapRoutes for hot reload instead.
func (r *Router) AddRoute(route Route) {
	current := r.getRoutes()
	updated := make([]Route, len(current)+1)
	copy(updated, current)
	updated[len(current)] = route
	r.routes.Store(updated)
}

// SwapRoutes atomically replaces the entire route table (for hot reload).
func (r *Router) SwapRoutes(routes []Route) {
	r.routes.Store(routes)
}

// Match finds the first route that matches the request.
// Returns the matched route and true, or a zero Route and false if no match.
func (r *Router) Match(req *http.Request) (Route, bool) {
	routes := r.getRoutes()
	path := req.URL.Path
	host := req.Host

	for _, route := range routes {
		// Host check (if configured)
		if route.Host != "" {
			// Strip port from host header for comparison
			reqHost := host
			if idx := strings.Index(reqHost, ":"); idx != -1 {
				reqHost = reqHost[:idx]
			}
			if !strings.EqualFold(reqHost, route.Host) {
				continue
			}
		}

		// Path prefix check
		if strings.HasPrefix(path, route.PathPrefix) {
			return route, true
		}
	}

	return Route{}, false
}

// RouteCount returns the number of routes in the table.
func (r *Router) RouteCount() int {
	return len(r.getRoutes())
}

func (r *Router) getRoutes() []Route {
	return r.routes.Load().([]Route)
}
