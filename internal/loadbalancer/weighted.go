package loadbalancer

import "sync"

// Weighted implements smooth weighted round robin (Nginx algorithm).
//
// Each upstream has a "current weight" that increases by its configured weight
// on each selection round. The upstream with the highest current weight is
// chosen, and its current weight is reduced by the total weight of all upstreams.
// This produces a smooth, interleaved distribution (e.g., with weights 5,1,1
// you get A,A,B,A,A,C,A rather than AAAABC).
type Weighted struct {
	mu        sync.Mutex
	upstreams []*Upstream
	weights   []int // current weights (parallel to upstreams)
}

// NewWeighted creates a weighted round-robin balancer.
func NewWeighted(upstreams []*Upstream) *Weighted {
	weights := make([]int, len(upstreams))
	return &Weighted{
		upstreams: upstreams,
		weights:   weights,
	}
}

// Next returns the next upstream using smooth weighted round robin.
func (w *Weighted) Next() (*Upstream, error) {
	w.mu.Lock()
	defer w.mu.Unlock()

	totalWeight := 0
	bestIdx := -1
	bestWeight := 0

	for i, up := range w.upstreams {
		if !up.IsHealthy() {
			continue
		}

		effectiveWeight := up.Weight
		if effectiveWeight <= 0 {
			effectiveWeight = 1
		}

		w.weights[i] += effectiveWeight
		totalWeight += effectiveWeight

		if bestIdx == -1 || w.weights[i] > bestWeight {
			bestIdx = i
			bestWeight = w.weights[i]
		}
	}

	if bestIdx == -1 {
		return nil, ErrNoHealthyUpstream
	}

	// Reduce the selected upstream's current weight by total
	w.weights[bestIdx] -= totalWeight
	return w.upstreams[bestIdx], nil
}
