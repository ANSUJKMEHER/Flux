package ratelimit

import (
	"context"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	"github.com/redis/go-redis/v9"
)

func setupTestRedis(t *testing.T) (*miniredis.Miniredis, *redis.Client) {
	mr := miniredis.RunT(t)
	rdb := redis.NewClient(&redis.Options{
		Addr: mr.Addr(),
	})
	return mr, rdb
}

func TestTokenBucket_AllowAndDeny(t *testing.T) {
	_, rdb := setupTestRedis(t)
	defer rdb.Close()

	tb := NewTokenBucket(rdb)
	ctx := context.Background()
	key := "test:tb:user1"

	// Rate 10 tokens/s, Burst of 2
	rate := 10
	burst := 2

	// 1st request should be allowed (remaining 1)
	allowed, retryAfter, err := tb.Allow(ctx, rdb, key, rate, burst)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !allowed {
		t.Errorf("expected 1st request to be allowed")
	}

	// 2nd request should be allowed (remaining 0)
	allowed, _, err = tb.Allow(ctx, rdb, key, rate, burst)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !allowed {
		t.Errorf("expected 2nd request to be allowed")
	}

	// 3rd request should be denied
	allowed, retryAfter, err = tb.Allow(ctx, rdb, key, rate, burst)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if allowed {
		t.Errorf("expected 3rd request to be denied (burst exceeded)")
	}
	if retryAfter <= 0 {
		t.Errorf("expected positive retry-after duration, got %v", retryAfter)
	}
}

func TestTokenBucket_ZeroRate_NoCrash(t *testing.T) {
	// CONC-02 verification: rate: 0 should not crash Lua script with division-by-zero
	_, rdb := setupTestRedis(t)
	defer rdb.Close()

	tb := NewTokenBucket(rdb)
	ctx := context.Background()
	key := "test:tb:zerorate"

	allowed, retryAfter, err := tb.Allow(ctx, rdb, key, 0, 1)
	if err != nil {
		t.Fatalf("unexpected Lua crash on zero rate: %v", err)
	}
	// Initial burst has 1 token
	if !allowed {
		t.Errorf("expected initial burst token to be consumed")
	}

	// Next request should be cleanly rejected without division by zero
	allowed, retryAfter, err = tb.Allow(ctx, rdb, key, 0, 1)
	if err != nil {
		t.Fatalf("unexpected Lua crash on zero rate: %v", err)
	}
	if allowed {
		t.Errorf("expected denied on zero rate with depleted burst")
	}
	if retryAfter <= 0 {
		t.Errorf("expected positive retry-after on zero rate")
	}
}

func TestSlidingWindow_AllowAndDeny(t *testing.T) {
	_, rdb := setupTestRedis(t)
	defer rdb.Close()

	sw := NewSlidingWindow(rdb)
	ctx := context.Background()
	key := "test:sw:user1"

	maxRequests := 3
	window := time.Second

	// 3 requests allowed
	for i := 0; i < maxRequests; i++ {
		allowed, _, err := sw.Allow(ctx, rdb, key, maxRequests, window)
		if err != nil {
			t.Fatalf("unexpected error on request %d: %v", i+1, err)
		}
		if !allowed {
			t.Errorf("request %d should be allowed", i+1)
		}
	}

	// 4th request denied
	allowed, retryAfter, err := sw.Allow(ctx, rdb, key, maxRequests, window)
	if err != nil {
		t.Fatalf("unexpected error on 4th request: %v", err)
	}
	if allowed {
		t.Errorf("expected 4th request to be denied")
	}
	_ = retryAfter
}

func TestSlidingWindow_ConcurrentBursts(t *testing.T) {
	// CONC-03 verification: ensure member uniqueness under concurrent calls
	_, rdb := setupTestRedis(t)
	defer rdb.Close()

	sw := NewSlidingWindow(rdb)
	ctx := context.Background()
	key := "test:sw:concurrent"

	maxRequests := 15
	window := 5 * time.Second
	totalRequests := 40

	var allowedCount atomic.Int32
	var deniedCount atomic.Int32
	var wg sync.WaitGroup

	for i := 0; i < totalRequests; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			allowed, _, err := sw.Allow(ctx, rdb, key, maxRequests, window)
			if err != nil {
				t.Errorf("unexpected error in concurrent allow: %v", err)
				return
			}
			if allowed {
				allowedCount.Add(1)
			} else {
				deniedCount.Add(1)
			}
		}()
	}

	wg.Wait()

	if allowedCount.Load() != int32(maxRequests) {
		t.Errorf("got %d allowed requests, want exactly %d", allowedCount.Load(), maxRequests)
	}
	if deniedCount.Load() != int32(totalRequests-maxRequests) {
		t.Errorf("got %d denied requests, want %d", deniedCount.Load(), totalRequests-maxRequests)
	}
}
