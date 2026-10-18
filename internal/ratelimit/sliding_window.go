package ratelimit

import (
	"context"
	_ "embed"
	"fmt"
	"math/rand/v2"
	"sync/atomic"
	"time"

	"github.com/redis/go-redis/v9"
)

//go:embed lua/sliding_window.lua
var slidingWindowLua string

var swSeq atomic.Uint64

// SlidingWindow implements a distributed sliding window log rate limiter using Redis.
// It uses a sorted set (ZSET) where each request's timestamp is stored as both
// the member score and (with a unique suffix) the member value.
// This eliminates the boundary-spike problem of fixed-window counters.
type SlidingWindow struct {
	script *redis.Script
}

// NewSlidingWindow creates a new sliding window limiter.
func NewSlidingWindow(rdb *redis.Client) *SlidingWindow {
	return &SlidingWindow{
		script: redis.NewScript(slidingWindowLua),
	}
}

// Allow checks whether a request identified by key should be allowed.
// Parameters:
//   - cmdable: the Redis client or pipeline to execute against
//   - key: unique rate-limit key
//   - maxRequests: maximum number of requests allowed within the window
//   - window: the sliding window duration
//
// Returns:
//   - allowed: true if the request was counted within the limit
//   - retryAfter: if denied, how long until the oldest entry expires from the window
//   - err: Redis communication error (caller should fail-open on error)
func (sw *SlidingWindow) Allow(ctx context.Context, cmdable redis.Cmdable, key string, maxRequests int, window time.Duration) (bool, time.Duration, error) {
	now := time.Now().UnixMicro()
	windowUs := window.Microseconds()
	seq := swSeq.Add(1)
	// Guarantee complete uniqueness under high-concurrency bursts
	requestID := fmt.Sprintf("%d:%d:%d", now, seq, rand.Uint64())

	result, err := sw.script.Run(ctx, cmdable, []string{key},
		maxRequests,
		windowUs,
		now,
		requestID,
	).Int64Slice()
	if err != nil {
		return false, 0, fmt.Errorf("sliding_window: lua exec: %w", err)
	}

	if len(result) < 3 {
		return false, 0, fmt.Errorf("sliding_window: unexpected result length %d", len(result))
	}

	allowed := result[0] == 1
	retryAfterMs := result[2]

	return allowed, time.Duration(retryAfterMs) * time.Millisecond, nil
}
