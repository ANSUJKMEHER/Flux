package loadbalancer

import (
	"math/rand"
	"sync"
)

// PowerOfTwo implements the "power of two random choices" strategy.
//
// Instead of tracking global state or scanning all upstreams, it picks two
// random healthy upstreams and forwards to the one with fewer active
// connections. This achieves near-optimal load distribution with O(1) selection
// and minimal coordination — the key insight from the seminal Mitzenmacher paper.
//
// Why it works: exponential improvement in max load vs. random selection.
// With 1 random choice, max load is O(log n / log log n).
// With 2 random choices, max load drops to O(log log n).
type PowerOfTwo struct {
	mu        sync.Mutex
	upstreams []*Upstream
	rng       *rand.Rand
}

// NewPowerOfTwo creates a power-of-two-choices balancer.
func NewPowerOfTwo(upstreams []*Upstream) *PowerOfTwo {
	return &PowerOfTwo{
		upstreams: upstreams,
		rng:       rand.New(rand.NewSource(rand.Int63())),
	}
}

// Next picks two random healthy upstreams and returns the less loaded one.
func (p *PowerOfTwo) Next() (*Upstream, error) {
	p.mu.Lock()
	defer p.mu.Unlock()

	// Collect healthy upstreams
	healthy := make([]*Upstream, 0, len(p.upstreams))
	for _, up := range p.upstreams {
		if up.IsHealthy() {
			healthy = append(healthy, up)
		}
	}

	switch len(healthy) {
	case 0:
		return nil, ErrNoHealthyUpstream
	case 1:
		return healthy[0], nil
	}

	// Pick two distinct random indices
	i := p.rng.Intn(len(healthy))
	j := p.rng.Intn(len(healthy) - 1)
	if j >= i {
		j++ // ensure j != i
	}

	a, b := healthy[i], healthy[j]
	if a.ActiveConns() <= b.ActiveConns() {
		return a, nil
	}
	return b, nil
}
