package ratelimit

import (
	"context"
	_ "embed"
	"fmt"
	"time"

	"github.com/redis/go-redis/v9"
)

//go:embed lua/token_bucket.lua
var tokenBucketLua string

// TokenBucket implements a distributed token bucket rate limiter using Redis.
// The bucket refills at a constant rate and allows bursts up to a configurable max.
// All state mutations happen atomically inside a Lua script.
type TokenBucket struct {
	script *redis.Script
}

// NewTokenBucket creates a new token bucket limiter.
// The rdb client is not stored — it's passed per-call to support sharded Redis.
func NewTokenBucket(rdb *redis.Client) *TokenBucket {
	return &TokenBucket{
		script: redis.NewScript(tokenBucketLua),
	}
}

// Allow checks whether a request identified by key should be allowed.
// Parameters:
//   - cmdable: the Redis client or pipeline to execute against
//   - key: unique rate-limit key (e.g., "rl:free:api-key-001")
//   - rate: token refill rate (tokens per second)
//   - burst: maximum bucket size (allows this many tokens to accumulate)
//
// Returns:
//   - allowed: true if the request consumed a token
//   - retryAfter: if denied, the duration the client should wait before retrying
//   - err: Redis communication error (caller should fail-open on error)
func (tb *TokenBucket) Allow(ctx context.Context, cmdable redis.Cmdable, key string, rate, burst int) (bool, time.Duration, error) {
	now := time.Now().UnixMicro()

	result, err := tb.script.Run(ctx, cmdable, []string{key},
		rate,
		burst,
		now,
	).Int64Slice()
	if err != nil {
		return false, 0, fmt.Errorf("token_bucket: lua exec: %w", err)
	}

	if len(result) < 3 {
		return false, 0, fmt.Errorf("token_bucket: unexpected result length %d", len(result))
	}

	allowed := result[0] == 1
	retryAfterMs := result[2]

	return allowed, time.Duration(retryAfterMs) * time.Millisecond, nil
}
