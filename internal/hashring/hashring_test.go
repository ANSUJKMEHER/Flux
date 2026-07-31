package hashring

import (
	"fmt"
	"math"
	"testing"
)

func TestGetNode_EmptyRing(t *testing.T) {
	r := NewRing(10)
	if got := r.GetNode("any-key"); got != "" {
		t.Errorf("GetNode on empty ring = %q, want empty string", got)
	}
}

func TestGetNode_SingleNode(t *testing.T) {
	r := NewRing(100)
	r.AddNode("node-A")

	// Every key should map to the only node
	for i := 0; i < 100; i++ {
		key := fmt.Sprintf("key-%d", i)
		if got := r.GetNode(key); got != "node-A" {
			t.Errorf("GetNode(%q) = %q, want node-A", key, got)
		}
	}
}

func TestGetNode_Deterministic(t *testing.T) {
	r := NewRing(150)
	r.AddNode("node-A")
	r.AddNode("node-B")
	r.AddNode("node-C")

	// Same key should always map to the same node
	for i := 0; i < 50; i++ {
		first := r.GetNode("stable-key")
		second := r.GetNode("stable-key")
		if first != second {
			t.Fatalf("GetNode not deterministic: %q vs %q", first, second)
		}
	}
}

func TestDistribution_Uniformity(t *testing.T) {
	r := NewRing(150)
	nodes := []string{"node-A", "node-B", "node-C"}
	for _, n := range nodes {
		r.AddNode(n)
	}

	counts := make(map[string]int)
	total := 10000
	for i := 0; i < total; i++ {
		key := fmt.Sprintf("user:%d:requests", i)
		node := r.GetNode(key)
		counts[node]++
	}

	// Each node should get roughly 1/3 of keys.
	// With 150 vnodes per node, standard deviation should be < 10%.
	expected := float64(total) / float64(len(nodes))
	for _, n := range nodes {
		deviation := math.Abs(float64(counts[n])-expected) / expected
		if deviation > 0.15 { // allow 15% deviation
			t.Errorf("node %s: got %d keys (%.1f%% deviation), expected ~%.0f",
				n, counts[n], deviation*100, expected)
		}
		t.Logf("node %s: %d keys (%.1f%% deviation)", n, counts[n], deviation*100)
	}
}

func TestMinimalRemapping_AddNode(t *testing.T) {
	r := NewRing(150)
	r.AddNode("node-A")
	r.AddNode("node-B")

	// Record initial mapping
	total := 5000
	before := make(map[string]string)
	for i := 0; i < total; i++ {
		key := fmt.Sprintf("key-%d", i)
		before[key] = r.GetNode(key)
	}

	// Add a third node
	r.AddNode("node-C")

	// Count how many keys moved
	moved := 0
	for i := 0; i < total; i++ {
		key := fmt.Sprintf("key-%d", i)
		if r.GetNode(key) != before[key] {
			moved++
		}
	}

	// With 3 nodes, ~1/3 of keys should move (the ones now owned by node-C).
	// Allow some slack: 15%–50% is reasonable.
	movedPct := float64(moved) / float64(total)
	t.Logf("keys moved after adding node-C: %d/%d (%.1f%%)", moved, total, movedPct*100)
	if movedPct > 0.50 {
		t.Errorf("too many keys moved: %.1f%% (expected < 50%%)", movedPct*100)
	}
}

func TestMinimalRemapping_RemoveNode(t *testing.T) {
	r := NewRing(150)
	r.AddNode("node-A")
	r.AddNode("node-B")
	r.AddNode("node-C")

	total := 5000
	before := make(map[string]string)
	for i := 0; i < total; i++ {
		key := fmt.Sprintf("key-%d", i)
		before[key] = r.GetNode(key)
	}

	// Remove one node
	r.RemoveNode("node-B")

	moved := 0
	for i := 0; i < total; i++ {
		key := fmt.Sprintf("key-%d", i)
		after := r.GetNode(key)
		if after != before[key] {
			moved++
			// Keys that moved should have originally been on node-B
			if before[key] != "node-B" {
				t.Errorf("key %q moved from %s to %s (should only move from node-B)",
					key, before[key], after)
			}
		}
	}

	movedPct := float64(moved) / float64(total)
	t.Logf("keys moved after removing node-B: %d/%d (%.1f%%)", moved, total, movedPct*100)
}

func TestAddNode_Idempotent(t *testing.T) {
	r := NewRing(50)
	r.AddNode("node-A")
	r.AddNode("node-A") // duplicate

	if r.NodeCount() != 1 {
		t.Errorf("NodeCount = %d, want 1 (duplicate add should be no-op)", r.NodeCount())
	}
}

func TestRemoveNode_NotPresent(t *testing.T) {
	r := NewRing(50)
	r.AddNode("node-A")
	r.RemoveNode("node-B") // not present, should not panic

	if r.NodeCount() != 1 {
		t.Errorf("NodeCount = %d, want 1", r.NodeCount())
	}
}

func TestGetNodes_MultipleDistinct(t *testing.T) {
	r := NewRing(100)
	r.AddNode("node-A")
	r.AddNode("node-B")
	r.AddNode("node-C")

	nodes := r.GetNodes("some-key", 2)
	if len(nodes) != 2 {
		t.Fatalf("GetNodes returned %d nodes, want 2", len(nodes))
	}
	if nodes[0] == nodes[1] {
		t.Errorf("GetNodes returned duplicate: %v", nodes)
	}
}

func TestGetNodes_MoreThanAvailable(t *testing.T) {
	r := NewRing(100)
	r.AddNode("node-A")
	r.AddNode("node-B")

	nodes := r.GetNodes("key", 5) // ask for 5 but only 2 exist
	if len(nodes) != 2 {
		t.Errorf("GetNodes returned %d nodes, want 2 (capped at available)", len(nodes))
	}
}

func BenchmarkGetNode(b *testing.B) {
	r := NewRing(150)
	for i := 0; i < 10; i++ {
		r.AddNode(fmt.Sprintf("node-%d", i))
	}

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		r.GetNode(fmt.Sprintf("key-%d", i))
	}
}
