package loadbalancer

import (
	"sync/atomic"
)

// LeastConn selects the healthy upstream with the fewest active connections.
// Uses an offset counter to break ties fairly and prevent herding under concurrent bursts.
type LeastConn struct {
	upstreams []*Upstream
	offset    atomic.Uint64
}

// NewLeastConn creates a least-connections balancer.
func NewLeastConn(upstreams []*Upstream) *LeastConn {
	return &LeastConn{upstreams: upstreams}
}

// Next returns the healthy upstream with the lowest active connection count.
func (lc *LeastConn) Next() (*Upstream, error) {
	n := len(lc.upstreams)
	if n == 0 {
		return nil, ErrNoHealthyUpstream
	}

	start := int(lc.offset.Add(1) % uint64(n))
	var best *Upstream
	var bestConns int64

	for i := 0; i < n; i++ {
		idx := (start + i) % n
		up := lc.upstreams[idx]
		if !up.IsHealthy() {
			continue
		}
		conns := up.ActiveConns()
		if best == nil || conns < bestConns {
			best = up
			bestConns = conns
		}
	}

	if best == nil {
		return nil, ErrNoHealthyUpstream
	}
	return best, nil
}
