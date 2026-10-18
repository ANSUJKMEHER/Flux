// Package breaker implements a circuit breaker state machine for upstream protection.
//
// State transitions:
//
//	Closed ──(failures ≥ threshold)──▸ Open ──(timeout expires)──▸ HalfOpen
//	  ▲                                                              │
//	  └────────(successes ≥ threshold)────────────────────────────────┘
//	                                                                 │
//	                     Open ◂──────(any failure)───────────────────┘
//
// The circuit breaker wraps upstream calls and tracks consecutive failures.
// When the failure threshold is exceeded, it "opens" the circuit — all subsequent
// calls fail immediately without contacting the upstream. After a configurable
// timeout, it transitions to "half-open" and allows a limited number of probe
// requests through. If those succeed, the circuit closes; if any fail, it re-opens.
//
// This prevents cascading failures and gives degraded upstreams time to recover.
package breaker

import (
	"errors"
	"fmt"
	"sync"
	"time"
)

// State represents the circuit breaker's current state.
type State int

const (
	// StateClosed is the normal operating state. Requests flow through.
	StateClosed State = iota
	// StateOpen means the circuit is tripped. Requests fail immediately.
	StateOpen
	// StateHalfOpen allows limited probe requests to test recovery.
	StateHalfOpen
)

// String returns a human-readable state name.
func (s State) String() string {
	switch s {
	case StateClosed:
		return "closed"
	case StateOpen:
		return "open"
	case StateHalfOpen:
		return "half-open"
	default:
		return "unknown"
	}
}

// ErrCircuitOpen is returned when the circuit breaker is in the Open state.
var ErrCircuitOpen = errors.New("circuit breaker is open")

// StateChangeCallback is called whenever the breaker transitions between states.
// Useful for logging and Prometheus metrics.
type StateChangeCallback func(name string, from, to State)

// Settings configures a circuit breaker instance.
type Settings struct {
	// Name identifies this breaker (typically the upstream ID).
	Name string

	// FailureThreshold is the number of consecutive failures in Closed state
	// that will trip the breaker to Open.
	FailureThreshold int

	// SuccessThreshold is the number of consecutive successes in HalfOpen state
	// needed to transition back to Closed.
	SuccessThreshold int

	// OpenTimeout is how long the breaker stays Open before transitioning to HalfOpen.
	OpenTimeout time.Duration

	// OnStateChange is called on every state transition (optional).
	OnStateChange StateChangeCallback
}

// CircuitBreaker implements the Closed/Open/HalfOpen state machine.
type CircuitBreaker struct {
	mu sync.Mutex

	settings Settings

	state            State
	consecutiveFails int
	consecutiveOK    int
	openedAt         time.Time
	halfOpenProbes   int // in-flight probe requests in HalfOpen state

	// Counts for observability (total lifetime)
	totalRequests  int64
	totalSuccesses int64
	totalFailures  int64
	totalRejected  int64
}

// New creates a new CircuitBreaker with the given settings.
func New(settings Settings) *CircuitBreaker {
	if settings.FailureThreshold <= 0 {
		settings.FailureThreshold = 5
	}
	if settings.SuccessThreshold <= 0 {
		settings.SuccessThreshold = 3
	}
	if settings.OpenTimeout <= 0 {
		settings.OpenTimeout = 30 * time.Second
	}
	return &CircuitBreaker{
		settings: settings,
		state:    StateClosed,
	}
}

// Execute wraps a function call with circuit breaker protection.
//
// If the circuit is Open, Execute returns ErrCircuitOpen immediately.
// If the circuit is HalfOpen, it allows a single probe request through while rejecting concurrent requests.
// The function fn should return nil on success, non-nil on failure.
func (cb *CircuitBreaker) Execute(fn func() error) error {
	cb.mu.Lock()

	// Check for Open → HalfOpen transition
	if cb.state == StateOpen {
		if time.Since(cb.openedAt) >= cb.settings.OpenTimeout {
			cb.transitionTo(StateHalfOpen)
		} else {
			cb.totalRejected++
			cb.mu.Unlock()
			return ErrCircuitOpen
		}
	}

	// Throttle concurrent probes in HalfOpen to prevent thundering herd
	if cb.state == StateHalfOpen {
		if cb.halfOpenProbes >= 1 {
			cb.totalRejected++
			cb.mu.Unlock()
			return ErrCircuitOpen
		}
		cb.halfOpenProbes++
	}

	cb.totalRequests++
	cb.mu.Unlock()

	// Execute the actual call (outside the lock)
	err := fn()

	cb.mu.Lock()
	defer cb.mu.Unlock()

	if cb.state == StateHalfOpen {
		cb.halfOpenProbes--
		if cb.halfOpenProbes < 0 {
			cb.halfOpenProbes = 0
		}
	}

	if err != nil {
		cb.onFailure()
		return err
	}
	cb.onSuccess()
	return nil
}

// onSuccess handles a successful call.
func (cb *CircuitBreaker) onSuccess() {
	cb.totalSuccesses++
	cb.consecutiveFails = 0

	switch cb.state {
	case StateClosed:
		// Nothing to do, already healthy
	case StateHalfOpen:
		cb.consecutiveOK++
		if cb.consecutiveOK >= cb.settings.SuccessThreshold {
			cb.transitionTo(StateClosed)
		}
	}
}

// onFailure handles a failed call.
func (cb *CircuitBreaker) onFailure() {
	cb.totalFailures++
	cb.consecutiveOK = 0

	switch cb.state {
	case StateClosed:
		cb.consecutiveFails++
		if cb.consecutiveFails >= cb.settings.FailureThreshold {
			cb.transitionTo(StateOpen)
		}
	case StateHalfOpen:
		// Any failure in half-open immediately re-opens
		cb.transitionTo(StateOpen)
	}
}

// transitionTo moves the breaker to a new state. Must be called under lock.
func (cb *CircuitBreaker) transitionTo(newState State) {
	if cb.state == newState {
		return
	}

	oldState := cb.state
	cb.state = newState

	// Reset counters on transition
	cb.consecutiveFails = 0
	cb.consecutiveOK = 0
	cb.halfOpenProbes = 0

	if newState == StateOpen {
		cb.openedAt = time.Now()
	}

	if cb.settings.OnStateChange != nil {
		// Call outside the hot path conceptually, but since we're under lock
		// and this is typically just a metric increment, it's acceptable.
		cb.settings.OnStateChange(cb.settings.Name, oldState, newState)
	}
}

// State returns the current state of the breaker.
func (cb *CircuitBreaker) State() State {
	cb.mu.Lock()
	defer cb.mu.Unlock()

	// Check if Open should transition to HalfOpen
	if cb.state == StateOpen && time.Since(cb.openedAt) >= cb.settings.OpenTimeout {
		cb.transitionTo(StateHalfOpen)
	}

	return cb.state
}

// Stats returns a snapshot of the breaker's lifetime counters.
func (cb *CircuitBreaker) Stats() Stats {
	cb.mu.Lock()
	defer cb.mu.Unlock()
	return Stats{
		State:        cb.state,
		TotalRequests:  cb.totalRequests,
		TotalSuccesses: cb.totalSuccesses,
		TotalFailures:  cb.totalFailures,
		TotalRejected:  cb.totalRejected,
	}
}

// Stats holds a snapshot of breaker counters.
type Stats struct {
	State          State
	TotalRequests  int64
	TotalSuccesses int64
	TotalFailures  int64
	TotalRejected  int64
}

// String returns a human-readable summary.
func (s Stats) String() string {
	return fmt.Sprintf("state=%s requests=%d successes=%d failures=%d rejected=%d",
		s.State, s.TotalRequests, s.TotalSuccesses, s.TotalFailures, s.TotalRejected)
}

// BreakerRegistry manages per-upstream circuit breakers.
type BreakerRegistry struct {
	mu       sync.RWMutex
	breakers map[string]*CircuitBreaker
	defaults Settings
}

// NewRegistry creates a registry with default settings for new breakers.
func NewRegistry(defaults Settings) *BreakerRegistry {
	return &BreakerRegistry{
		breakers: make(map[string]*CircuitBreaker),
		defaults: defaults,
	}
}

// Get returns the circuit breaker for the named upstream, creating one if needed.
func (r *BreakerRegistry) Get(upstreamID string) *CircuitBreaker {
	r.mu.RLock()
	if cb, ok := r.breakers[upstreamID]; ok {
		r.mu.RUnlock()
		return cb
	}
	r.mu.RUnlock()

	r.mu.Lock()
	defer r.mu.Unlock()

	// Double-check after acquiring write lock
	if cb, ok := r.breakers[upstreamID]; ok {
		return cb
	}

	settings := r.defaults
	settings.Name = upstreamID
	cb := New(settings)
	r.breakers[upstreamID] = cb
	return cb
}

// All returns a snapshot of all registered breakers and their stats.
func (r *BreakerRegistry) All() map[string]Stats {
	r.mu.RLock()
	defer r.mu.RUnlock()

	result := make(map[string]Stats, len(r.breakers))
	for id, cb := range r.breakers {
		result[id] = cb.Stats()
	}
	return result
}
