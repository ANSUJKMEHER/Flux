package loadbalancer

import (
	"fmt"
	"sync"
	"testing"
)

func makeUpstreams(n int) []*Upstream {
	ups := make([]*Upstream, n)
	for i := 0; i < n; i++ {
		ups[i] = &Upstream{
			ID:     fmt.Sprintf("upstream-%d", i),
			URL:    fmt.Sprintf("http://localhost:%d", 9001+i),
			Weight: 1,
		}
		ups[i].SetHealthy(true)
	}
	return ups
}

// --- Round Robin Tests ---

func TestRoundRobin_Distribution(t *testing.T) {
	ups := makeUpstreams(3)
	rr := NewRoundRobin(ups)

	counts := make(map[string]int)
	for i := 0; i < 300; i++ {
		u, err := rr.Next()
		if err != nil {
			t.Fatal(err)
		}
		counts[u.ID]++
	}

	for _, up := range ups {
		if counts[up.ID] != 100 {
			t.Errorf("%s got %d requests, want 100", up.ID, counts[up.ID])
		}
	}
}

func TestRoundRobin_SkipsUnhealthy(t *testing.T) {
	ups := makeUpstreams(3)
	ups[1].SetHealthy(false)
	rr := NewRoundRobin(ups)

	for i := 0; i < 10; i++ {
		u, err := rr.Next()
		if err != nil {
			t.Fatal(err)
		}
		if u.ID == ups[1].ID {
			t.Errorf("selected unhealthy upstream %s", u.ID)
		}
	}
}

func TestRoundRobin_AllUnhealthy(t *testing.T) {
	ups := makeUpstreams(2)
	ups[0].SetHealthy(false)
	ups[1].SetHealthy(false)
	rr := NewRoundRobin(ups)

	_, err := rr.Next()
	if err != ErrNoHealthyUpstream {
		t.Errorf("got err=%v, want ErrNoHealthyUpstream", err)
	}
}

// --- Least Connections Tests ---

func TestLeastConn_SelectsLeastLoaded(t *testing.T) {
	ups := makeUpstreams(3)
	ups[0].IncrConns() // 1 conn
	ups[0].IncrConns() // 2 conns
	ups[1].IncrConns() // 1 conn
	// ups[2] has 0 conns

	lc := NewLeastConn(ups)
	u, err := lc.Next()
	if err != nil {
		t.Fatal(err)
	}
	if u.ID != ups[2].ID {
		t.Errorf("selected %s (conns=%d), want %s (conns=0)", u.ID, u.ActiveConns(), ups[2].ID)
	}
}

func TestLeastConn_SkipsUnhealthy(t *testing.T) {
	ups := makeUpstreams(2)
	ups[0].SetHealthy(false) // 0 conns but unhealthy
	ups[1].IncrConns()       // 1 conn but healthy

	lc := NewLeastConn(ups)
	u, err := lc.Next()
	if err != nil {
		t.Fatal(err)
	}
	if u.ID != ups[1].ID {
		t.Errorf("selected %s, want %s (only healthy)", u.ID, ups[1].ID)
	}
}

// --- Weighted Tests ---

func TestWeighted_SmoothDistribution(t *testing.T) {
	ups := makeUpstreams(3)
	ups[0].Weight = 5
	ups[1].Weight = 1
	ups[2].Weight = 1

	w := NewWeighted(ups)
	counts := make(map[string]int)
	total := 700 // 7 * 100 rounds

	for i := 0; i < total; i++ {
		u, err := w.Next()
		if err != nil {
			t.Fatal(err)
		}
		counts[u.ID]++
	}

	// With weights 5:1:1, expect ~71% / ~14% / ~14%
	for _, up := range ups {
		pct := float64(counts[up.ID]) / float64(total) * 100
		t.Logf("%s (weight=%d): %d requests (%.1f%%)", up.ID, up.Weight, counts[up.ID], pct)
	}

	// upstream-0 should get significantly more than the others
	if counts[ups[0].ID] < counts[ups[1].ID]*3 {
		t.Error("weighted distribution not proportional: upstream-0 should get ~5x upstream-1")
	}
}

func TestWeighted_SkipsUnhealthy(t *testing.T) {
	ups := makeUpstreams(2)
	ups[0].Weight = 10
	ups[0].SetHealthy(false)
	ups[1].Weight = 1

	w := NewWeighted(ups)
	for i := 0; i < 10; i++ {
		u, err := w.Next()
		if err != nil {
			t.Fatal(err)
		}
		if u.ID == ups[0].ID {
			t.Error("selected unhealthy high-weight upstream")
		}
	}
}

// --- Power of Two Tests ---

func TestPowerOfTwo_SelectsFromPool(t *testing.T) {
	ups := makeUpstreams(5)
	p := NewPowerOfTwo(ups)

	validIDs := make(map[string]bool)
	for _, u := range ups {
		validIDs[u.ID] = true
	}

	for i := 0; i < 100; i++ {
		u, err := p.Next()
		if err != nil {
			t.Fatal(err)
		}
		if !validIDs[u.ID] {
			t.Errorf("selected unknown upstream %s", u.ID)
		}
	}
}

func TestPowerOfTwo_PrefersLessLoaded(t *testing.T) {
	ups := makeUpstreams(2)
	// Load up upstream-0 heavily
	for i := 0; i < 100; i++ {
		ups[0].IncrConns()
	}
	// upstream-1 has 0 conns

	p := NewPowerOfTwo(ups)
	counts := make(map[string]int)
	for i := 0; i < 100; i++ {
		u, err := p.Next()
		if err != nil {
			t.Fatal(err)
		}
		counts[u.ID]++
	}

	// upstream-1 should be selected every time (always less loaded)
	if counts[ups[1].ID] != 100 {
		t.Errorf("upstream-1 selected %d/100 times, want 100 (always less loaded)", counts[ups[1].ID])
	}
}

func TestPowerOfTwo_SingleUpstream(t *testing.T) {
	ups := makeUpstreams(1)
	p := NewPowerOfTwo(ups)

	u, err := p.Next()
	if err != nil {
		t.Fatal(err)
	}
	if u.ID != ups[0].ID {
		t.Errorf("got %s, want %s", u.ID, ups[0].ID)
	}
}

// --- Factory Tests ---

func TestNew_ValidStrategies(t *testing.T) {
	ups := makeUpstreams(2)
	strategies := []string{"round_robin", "least_conn", "weighted", "power_of_two"}

	for _, s := range strategies {
		b, err := New(s, ups)
		if err != nil {
			t.Errorf("New(%q) error: %v", s, err)
			continue
		}
		if b == nil {
			t.Errorf("New(%q) returned nil", s)
		}
	}
}

func TestNew_InvalidStrategy(t *testing.T) {
	ups := makeUpstreams(1)
	_, err := New("unknown", ups)
	if err == nil {
		t.Error("expected error for unknown strategy")
	}
}

func TestNew_EmptyUpstreams(t *testing.T) {
	_, err := New("round_robin", nil)
	if err == nil {
		t.Error("expected error for empty upstreams")
	}
}

// --- Concurrent Safety ---

func TestRoundRobin_ConcurrentSafety(t *testing.T) {
	ups := makeUpstreams(3)
	rr := NewRoundRobin(ups)

	var wg sync.WaitGroup
	for i := 0; i < 100; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for j := 0; j < 100; j++ {
				_, err := rr.Next()
				if err != nil {
					t.Errorf("concurrent Next() error: %v", err)
				}
			}
		}()
	}
	wg.Wait()
}

// --- Benchmarks ---

func BenchmarkRoundRobin(b *testing.B) {
	ups := makeUpstreams(5)
	rr := NewRoundRobin(ups)
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		rr.Next()
	}
}

func BenchmarkLeastConn(b *testing.B) {
	ups := makeUpstreams(5)
	lc := NewLeastConn(ups)
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		lc.Next()
	}
}

func BenchmarkWeighted(b *testing.B) {
	ups := makeUpstreams(5)
	for i, u := range ups {
		u.Weight = i + 1
	}
	w := NewWeighted(ups)
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		w.Next()
	}
}

func BenchmarkPowerOfTwo(b *testing.B) {
	ups := makeUpstreams(5)
	p := NewPowerOfTwo(ups)
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		p.Next()
	}
}
