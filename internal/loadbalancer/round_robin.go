package loadbalancer

import "sync/atomic"

// RoundRobin distributes requests evenly across healthy upstreams using an
// atomic counter. Unhealthy upstreams are skipped.
type RoundRobin struct {
	upstreams []*Upstream
	counter   atomic.Uint64
}

// NewRoundRobin creates a round-robin balancer.
func NewRoundRobin(upstreams []*Upstream) *RoundRobin {
	return &RoundRobin{upstreams: upstreams}
}

// Next returns the next healthy upstream in rotation.
func (rr *RoundRobin) Next() (*Upstream, error) {
	n := len(rr.upstreams)
	start := rr.counter.Add(1)

	// Try each upstream at most once
	for i := 0; i < n; i++ {
		idx := int((start + uint64(i)) % uint64(n))
		up := rr.upstreams[idx]
		if up.IsHealthy() {
			return up, nil
		}
	}

	return nil, ErrNoHealthyUpstream
}
