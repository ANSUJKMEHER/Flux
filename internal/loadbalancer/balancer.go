// Package loadbalancer provides pluggable load balancing strategies for upstream selection.
//
// Supported strategies:
//   - Round Robin: simple cyclic distribution
//   - Least Connections: picks the upstream with the fewest active connections
//   - Weighted Round Robin: Nginx-style smooth weighted distribution
//   - Power of Two Choices: picks 2 random upstreams, forwards to the less loaded one
//
// All strategies skip unhealthy upstreams automatically.
package loadbalancer

import (
	"fmt"
	"sync/atomic"
)

// Upstream represents a single backend service instance.
type Upstream struct {
	ID     string
	URL    string
	Weight int

	healthy    atomic.Bool
	activeConn atomic.Int64
}

// SetHealthy atomically sets the upstream's health status.
func (u *Upstream) SetHealthy(h bool) {
	u.healthy.Store(h)
}

// IsHealthy atomically reads the upstream's health status.
func (u *Upstream) IsHealthy() bool {
	return u.healthy.Load()
}

// IncrConns atomically increments the active connection count.
func (u *Upstream) IncrConns() {
	u.activeConn.Add(1)
}

// DecrConns atomically decrements the active connection count.
func (u *Upstream) DecrConns() {
	u.activeConn.Add(-1)
}

// ActiveConns returns the current active connection count.
func (u *Upstream) ActiveConns() int64 {
	return u.activeConn.Load()
}

// Balancer is the interface for all load balancing strategies.
type Balancer interface {
	// Next selects the next healthy upstream from the pool.
	// Returns an error if no healthy upstream is available.
	Next() (*Upstream, error)
}

// ErrNoHealthyUpstream is returned when all upstreams in a pool are unhealthy.
var ErrNoHealthyUpstream = fmt.Errorf("no healthy upstream available")

// New creates a Balancer for the named strategy.
// Valid strategies: "round_robin", "least_conn", "weighted", "power_of_two".
func New(strategy string, upstreams []*Upstream) (Balancer, error) {
	if len(upstreams) == 0 {
		return nil, fmt.Errorf("loadbalancer: at least one upstream is required")
	}

	switch strategy {
	case "round_robin":
		return NewRoundRobin(upstreams), nil
	case "least_conn":
		return NewLeastConn(upstreams), nil
	case "weighted":
		return NewWeighted(upstreams), nil
	case "power_of_two":
		return NewPowerOfTwo(upstreams), nil
	default:
		return nil, fmt.Errorf("loadbalancer: unknown strategy %q", strategy)
	}
}
