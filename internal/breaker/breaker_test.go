package breaker

import (
	"errors"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

var errFake = errors.New("fake upstream error")

func TestClosed_AllowsRequests(t *testing.T) {
	cb := New(Settings{FailureThreshold: 3, SuccessThreshold: 2, OpenTimeout: time.Second})

	err := cb.Execute(func() error { return nil })
	if err != nil {
		t.Fatalf("expected success, got %v", err)
	}

	if cb.State() != StateClosed {
		t.Errorf("state = %s, want closed", cb.State())
	}
}

func TestClosed_TripsAfterThreshold(t *testing.T) {
	cb := New(Settings{FailureThreshold: 3, SuccessThreshold: 2, OpenTimeout: time.Second})

	// 3 consecutive failures should trip to Open
	for i := 0; i < 3; i++ {
		cb.Execute(func() error { return errFake })
	}

	if cb.State() != StateOpen {
		t.Errorf("state = %s, want open after %d failures", cb.State(), 3)
	}
}

func TestClosed_ResetOnSuccess(t *testing.T) {
	cb := New(Settings{FailureThreshold: 3, SuccessThreshold: 2, OpenTimeout: time.Second})

	// 2 failures, then 1 success should reset counter
	cb.Execute(func() error { return errFake })
	cb.Execute(func() error { return errFake })
	cb.Execute(func() error { return nil }) // reset

	// 2 more failures shouldn't trip (counter was reset)
	cb.Execute(func() error { return errFake })
	cb.Execute(func() error { return errFake })

	if cb.State() != StateClosed {
		t.Errorf("state = %s, want closed (counter should have reset on success)", cb.State())
	}
}

func TestOpen_RejectsImmediately(t *testing.T) {
	cb := New(Settings{FailureThreshold: 1, SuccessThreshold: 1, OpenTimeout: time.Hour})

	// Trip the breaker
	cb.Execute(func() error { return errFake })

	// Next call should be rejected without executing fn
	executed := false
	err := cb.Execute(func() error {
		executed = true
		return nil
	})

	if !errors.Is(err, ErrCircuitOpen) {
		t.Errorf("expected ErrCircuitOpen, got %v", err)
	}
	if executed {
		t.Error("function should not have been executed in Open state")
	}
}

func TestOpen_TransitionsToHalfOpen(t *testing.T) {
	cb := New(Settings{FailureThreshold: 1, SuccessThreshold: 1, OpenTimeout: 50 * time.Millisecond})

	// Trip it
	cb.Execute(func() error { return errFake })
	if cb.State() != StateOpen {
		t.Fatalf("state = %s, want open", cb.State())
	}

	// Wait for timeout
	time.Sleep(100 * time.Millisecond)

	// Should now be half-open
	if cb.State() != StateHalfOpen {
		t.Errorf("state = %s, want half-open after timeout", cb.State())
	}
}

func TestHalfOpen_ClosesOnSuccess(t *testing.T) {
	cb := New(Settings{FailureThreshold: 1, SuccessThreshold: 2, OpenTimeout: 50 * time.Millisecond})

	// Trip → Open
	cb.Execute(func() error { return errFake })
	time.Sleep(100 * time.Millisecond)

	// Half-open: 2 successes should close
	cb.Execute(func() error { return nil })
	cb.Execute(func() error { return nil })

	if cb.State() != StateClosed {
		t.Errorf("state = %s, want closed after %d successes in half-open", cb.State(), 2)
	}
}

func TestHalfOpen_ReopensOnFailure(t *testing.T) {
	cb := New(Settings{FailureThreshold: 1, SuccessThreshold: 3, OpenTimeout: 50 * time.Millisecond})

	// Trip → Open → HalfOpen
	cb.Execute(func() error { return errFake })
	time.Sleep(100 * time.Millisecond)

	// 1 success then 1 failure in half-open should re-open
	cb.Execute(func() error { return nil })
	cb.Execute(func() error { return errFake })

	if cb.State() != StateOpen {
		t.Errorf("state = %s, want open (failure in half-open should re-open)", cb.State())
	}
}

func TestStateChangeCallback(t *testing.T) {
	var transitions []string
	cb := New(Settings{
		FailureThreshold: 2,
		SuccessThreshold: 1,
		OpenTimeout:      50 * time.Millisecond,
		OnStateChange: func(name string, from, to State) {
			transitions = append(transitions, from.String()+"→"+to.String())
		},
	})

	// Trip to open
	cb.Execute(func() error { return errFake })
	cb.Execute(func() error { return errFake })

	// Wait for half-open
	time.Sleep(100 * time.Millisecond)
	cb.State() // trigger transition check

	// Close it
	cb.Execute(func() error { return nil })

	expected := []string{"closed→open", "open→half-open", "half-open→closed"}
	if len(transitions) != len(expected) {
		t.Fatalf("transitions = %v, want %v", transitions, expected)
	}
	for i, want := range expected {
		if transitions[i] != want {
			t.Errorf("transition[%d] = %q, want %q", i, transitions[i], want)
		}
	}
}

func TestStats(t *testing.T) {
	cb := New(Settings{FailureThreshold: 5, SuccessThreshold: 1, OpenTimeout: time.Hour})

	cb.Execute(func() error { return nil })
	cb.Execute(func() error { return nil })
	cb.Execute(func() error { return errFake })

	stats := cb.Stats()
	if stats.TotalRequests != 3 {
		t.Errorf("TotalRequests = %d, want 3", stats.TotalRequests)
	}
	if stats.TotalSuccesses != 2 {
		t.Errorf("TotalSuccesses = %d, want 2", stats.TotalSuccesses)
	}
	if stats.TotalFailures != 1 {
		t.Errorf("TotalFailures = %d, want 1", stats.TotalFailures)
	}
}

func TestRegistry_CreatesOnDemand(t *testing.T) {
	reg := NewRegistry(Settings{FailureThreshold: 5})

	cb1 := reg.Get("upstream-a")
	cb2 := reg.Get("upstream-a")

	if cb1 != cb2 {
		t.Error("Get should return the same breaker for the same upstream")
	}

	cb3 := reg.Get("upstream-b")
	if cb1 == cb3 {
		t.Error("different upstreams should have different breakers")
	}
}

func TestRegistry_ConcurrentAccess(t *testing.T) {
	reg := NewRegistry(Settings{FailureThreshold: 5})

	var wg sync.WaitGroup
	var created atomic.Int64

	for i := 0; i < 100; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			cb := reg.Get("shared-upstream")
			if cb != nil {
				created.Add(1)
			}
		}()
	}
	wg.Wait()

	if created.Load() != 100 {
		t.Errorf("expected 100 successful Gets, got %d", created.Load())
	}

	all := reg.All()
	if len(all) != 1 {
		t.Errorf("expected 1 breaker in registry, got %d", len(all))
	}
}

func TestConcurrentExecute(t *testing.T) {
	cb := New(Settings{FailureThreshold: 100, SuccessThreshold: 1, OpenTimeout: time.Hour})

	var wg sync.WaitGroup
	for i := 0; i < 50; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for j := 0; j < 100; j++ {
				cb.Execute(func() error { return nil })
			}
		}()
	}
	wg.Wait()

	stats := cb.Stats()
	if stats.TotalRequests != 5000 {
		t.Errorf("TotalRequests = %d, want 5000", stats.TotalRequests)
	}
}
