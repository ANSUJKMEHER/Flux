package loadbalancer

import (
	"math/rand/v2"
)

// PowerOfTwo implements the "power of two random choices" strategy.
//
// Instead of tracking global state or scanning all upstreams, it picks two
// random healthy upstreams and forwards to the one with fewer active
// connections. This achieves near-optimal load distribution with O(1) selection
// and minimal coordination — the key insight from the seminal Mitzenmacher paper.
type PowerOfTwo struct {
	upstreams []*Upstream
}

// NewPowerOfTwo creates a power-of-two-choices balancer.
func NewPowerOfTwo(upstreams []*Upstream) *PowerOfTwo {
	return &PowerOfTwo{
		upstreams: upstreams,
	}
}

// Next picks two random upstreams and returns the less loaded healthy one.
// Runs completely lock-free with zero heap allocations per call.
func (p *PowerOfTwo) Next() (*Upstream, error) {
	n := len(p.upstreams)
	if n == 0 {
		return nil, ErrNoHealthyUpstream
	}
	if n == 1 {
		if p.upstreams[0].IsHealthy() {
			return p.upstreams[0], nil
		}
		return nil, ErrNoHealthyUpstream
	}

	// Pick two distinct random indices using thread-safe, lock-free PRNG
	i := rand.IntN(n)
	j := rand.IntN(n - 1)
	if j >= i {
		j++
	}

	a, b := p.upstreams[i], p.upstreams[j]
	aOk, bOk := a.IsHealthy(), b.IsHealthy()

	if aOk && bOk {
		if a.ActiveConns() <= b.ActiveConns() {
			return a, nil
		}
		return b, nil
	}
	if aOk {
		return a, nil
	}
	if bOk {
		return b, nil
	}

	// Fallback scan if both randomly sampled nodes were unhealthy
	for _, up := range p.upstreams {
		if up.IsHealthy() {
			return up, nil
		}
	}

	return nil, ErrNoHealthyUpstream
}
