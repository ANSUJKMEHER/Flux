package loadbalancer

// LeastConn selects the healthy upstream with the fewest active connections.
// This is optimal when request processing times vary significantly.
type LeastConn struct {
	upstreams []*Upstream
}

// NewLeastConn creates a least-connections balancer.
func NewLeastConn(upstreams []*Upstream) *LeastConn {
	return &LeastConn{upstreams: upstreams}
}

// Next returns the healthy upstream with the lowest active connection count.
func (lc *LeastConn) Next() (*Upstream, error) {
	var best *Upstream
	var bestConns int64

	for _, up := range lc.upstreams {
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
