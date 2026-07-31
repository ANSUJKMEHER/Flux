// Package hashring implements a consistent hashing ring with virtual nodes.
//
// Consistent hashing ensures that when nodes are added or removed, only ~1/N
// of keys are remapped (instead of nearly all keys with naive hash-mod).
// Virtual nodes (configurable per physical node) prevent hot-spotting by
// distributing each physical node's ownership across multiple points on the ring.
//
// This is the same technique behind DynamoDB, Cassandra, and Akamai CDN routing.
package hashring

import (
	"fmt"
	"hash/crc32"
	"sort"
	"sync"
)

// Ring is a consistent hashing ring with virtual nodes.
type Ring struct {
	mu           sync.RWMutex
	virtualNodes int              // virtual nodes per physical node
	hashes       []uint32         // sorted ring positions
	hashToNode   map[uint32]string // ring position -> physical node ID
	nodeSet      map[string]bool   // set of physical node IDs (for dedup in GetNodes)
}

// NewRing creates a new consistent hashing ring.
// virtualNodes controls how many points each physical node occupies on the ring.
// Recommended: 100–200 for production workloads.
func NewRing(virtualNodes int) *Ring {
	if virtualNodes <= 0 {
		virtualNodes = 150
	}
	return &Ring{
		virtualNodes: virtualNodes,
		hashToNode:   make(map[uint32]string),
		nodeSet:      make(map[string]bool),
	}
}

// AddNode places a physical node onto the ring with `virtualNodes` positions.
// If the node already exists, this is a no-op.
func (r *Ring) AddNode(nodeID string) {
	r.mu.Lock()
	defer r.mu.Unlock()

	if r.nodeSet[nodeID] {
		return
	}
	r.nodeSet[nodeID] = true

	for i := 0; i < r.virtualNodes; i++ {
		vKey := virtualKey(nodeID, i)
		h := hashKey(vKey)
		r.hashes = append(r.hashes, h)
		r.hashToNode[h] = nodeID
	}
	sort.Slice(r.hashes, func(i, j int) bool { return r.hashes[i] < r.hashes[j] })
}

// RemoveNode removes a physical node and all its virtual nodes from the ring.
func (r *Ring) RemoveNode(nodeID string) {
	r.mu.Lock()
	defer r.mu.Unlock()

	if !r.nodeSet[nodeID] {
		return
	}
	delete(r.nodeSet, nodeID)

	// Rebuild hashes slice without this node's virtual nodes
	newHashes := make([]uint32, 0, len(r.hashes))
	for _, h := range r.hashes {
		if r.hashToNode[h] == nodeID {
			delete(r.hashToNode, h)
		} else {
			newHashes = append(newHashes, h)
		}
	}
	r.hashes = newHashes
	// Already sorted since we only removed elements
}

// GetNode returns the physical node responsible for the given key.
// It finds the first ring position clockwise from the key's hash.
// Returns empty string if the ring is empty.
func (r *Ring) GetNode(key string) string {
	r.mu.RLock()
	defer r.mu.RUnlock()

	if len(r.hashes) == 0 {
		return ""
	}

	h := hashKey(key)

	// Binary search for the first hash >= key hash
	idx := sort.Search(len(r.hashes), func(i int) bool {
		return r.hashes[i] >= h
	})

	// Wrap around to the beginning of the ring
	if idx >= len(r.hashes) {
		idx = 0
	}

	return r.hashToNode[r.hashes[idx]]
}

// GetNodes returns up to n distinct physical nodes responsible for the given key.
// This is useful for replication: store data on the next N distinct physical nodes
// clockwise from the key's position.
func (r *Ring) GetNodes(key string, n int) []string {
	r.mu.RLock()
	defer r.mu.RUnlock()

	if len(r.hashes) == 0 {
		return nil
	}

	h := hashKey(key)
	idx := sort.Search(len(r.hashes), func(i int) bool {
		return r.hashes[i] >= h
	})
	if idx >= len(r.hashes) {
		idx = 0
	}

	seen := make(map[string]bool)
	var nodes []string

	for i := 0; i < len(r.hashes) && len(nodes) < n; i++ {
		pos := (idx + i) % len(r.hashes)
		nodeID := r.hashToNode[r.hashes[pos]]
		if !seen[nodeID] {
			seen[nodeID] = true
			nodes = append(nodes, nodeID)
		}
	}

	return nodes
}

// NodeCount returns the number of physical nodes on the ring.
func (r *Ring) NodeCount() int {
	r.mu.RLock()
	defer r.mu.RUnlock()
	return len(r.nodeSet)
}

// Nodes returns a copy of all physical node IDs.
func (r *Ring) Nodes() []string {
	r.mu.RLock()
	defer r.mu.RUnlock()
	nodes := make([]string, 0, len(r.nodeSet))
	for n := range r.nodeSet {
		nodes = append(nodes, n)
	}
	return nodes
}

// virtualKey generates a deterministic string for the i-th virtual node.
func virtualKey(nodeID string, index int) string {
	return fmt.Sprintf("%s#%d", nodeID, index)
}

// hashKey computes a CRC32 hash for a string.
// CRC32 is chosen for speed (no crypto overhead) and good distribution.
func hashKey(key string) uint32 {
	return crc32.ChecksumIEEE([]byte(key))
}
