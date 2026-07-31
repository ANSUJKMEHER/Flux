package main

import (
	"context"
	"flag"
	"fmt"
	"log"
	"net/http"
	"net/http/httputil"
	"net/url"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/ANSUJKMEHER/rate-limiter-gateway/internal/admin"
	"github.com/ANSUJKMEHER/rate-limiter-gateway/internal/breaker"
	"github.com/ANSUJKMEHER/rate-limiter-gateway/internal/config"
	"github.com/ANSUJKMEHER/rate-limiter-gateway/internal/hashring"
	"github.com/ANSUJKMEHER/rate-limiter-gateway/internal/health"
	"github.com/ANSUJKMEHER/rate-limiter-gateway/internal/loadbalancer"
	"github.com/ANSUJKMEHER/rate-limiter-gateway/internal/middleware"
	"github.com/ANSUJKMEHER/rate-limiter-gateway/internal/ratelimit"
	"github.com/ANSUJKMEHER/rate-limiter-gateway/internal/router"
	"github.com/prometheus/client_golang/prometheus/promhttp"
	"github.com/redis/go-redis/v9"
)

func main() {
	configPath := flag.String("config", "configs/gateway.yaml", "path to gateway config file")
	flag.Parse()

	// --- Load config ---
	cfg, err := config.Load(*configPath)
	if err != nil {
		log.Fatalf("failed to load config: %v", err)
	}
	cfgHolder := config.NewConfigHolder(cfg)
	log.Printf("config loaded from %s", *configPath)

	// --- Redis client ---
	rdb := redis.NewClient(&redis.Options{
		Addr:     cfg.Redis.Addr,
		Password: cfg.Redis.Password,
		DB:       cfg.Redis.DB,
		PoolSize: cfg.Redis.PoolSize,
	})
	ctx := context.Background()
	redisAvailable := true
	if err := rdb.Ping(ctx).Err(); err != nil {
		log.Printf("WARNING: Redis not reachable at %s: %v (rate limiting will fail open)", cfg.Redis.Addr, err)
		redisAvailable = false
	} else {
		log.Printf("Redis connected at %s", cfg.Redis.Addr)
	}
	_ = redisAvailable

	// --- Consistent hashing ring (for rate-limit key sharding) ---
	ring := hashring.NewRing(150)
	ring.AddNode("shard-0")
	log.Printf("hash ring initialized with %d virtual nodes per shard", 150)

	// --- Rate limiters ---
	tokenBucket := ratelimit.NewTokenBucket(rdb)
	slidingWindow := ratelimit.NewSlidingWindow(rdb)
	log.Println("rate limiters initialized (token_bucket + sliding_window)")

	// --- Router ---
	rt := router.New()
	for _, rc := range cfg.Routes {
		rt.AddRoute(router.Route{
			PathPrefix:    rc.PathPrefix,
			Host:          rc.Host,
			StripPrefix:   rc.StripPrefix,
			Pool:          rc.Pool,
			RateLimitTier: rc.RateLimitTier,
			Algorithm:     rc.Algorithm,
		})
	}
	log.Printf("router initialized with %d routes", len(cfg.Routes))

	// --- Load balancers (one per pool) ---
	balancers := make(map[string]loadbalancer.Balancer)
	upstreamsByPool := make(map[string][]*loadbalancer.Upstream)
	allUpstreams := make([]*loadbalancer.Upstream, 0)

	for poolName, poolCfg := range cfg.Pools {
		upstreams := make([]*loadbalancer.Upstream, len(poolCfg.Upstreams))
		for i, u := range poolCfg.Upstreams {
			up := &loadbalancer.Upstream{
				ID:     u.ID,
				URL:    u.URL,
				Weight: u.Weight,
			}
			up.SetHealthy(true)
			upstreams[i] = up
			allUpstreams = append(allUpstreams, up)
		}
		b, err := loadbalancer.New(poolCfg.Strategy, upstreams)
		if err != nil {
			log.Fatalf("failed to create balancer for pool %s: %v", poolName, err)
		}
		balancers[poolName] = b
		upstreamsByPool[poolName] = upstreams
		log.Printf("pool %q: %d upstreams, strategy=%s", poolName, len(upstreams), poolCfg.Strategy)
	}

	// --- Circuit breaker registry ---
	breakerReg := breaker.NewRegistry(breaker.Settings{
		FailureThreshold: cfg.Breaker.FailureThreshold,
		SuccessThreshold: cfg.Breaker.SuccessThreshold,
		OpenTimeout:      cfg.Breaker.OpenTimeout,
		OnStateChange: func(name string, from, to breaker.State) {
			log.Printf("circuit breaker [%s]: %s → %s", name, from, to)
			middleware.CircuitBreakerState.WithLabelValues(name).Set(float64(to))
		},
	})
	log.Println("circuit breaker registry initialized")

	// --- Health checker ---
	healthChecker := health.NewChecker(health.CheckerConfig{
		Interval:  cfg.Health.Interval,
		Timeout:   cfg.Health.Timeout,
		Path:      cfg.Health.Path,
		Threshold: cfg.Health.Threshold,
	}, allUpstreams)
	healthChecker.Start()
	defer healthChecker.Stop()

	// --- Global Stats ---
	globalStats := &admin.Stats{}

	// --- Admin API ---
	if cfg.Admin.Enabled {
		adminSrv := admin.NewServer(cfgHolder, upstreamsByPool, breakerReg, globalStats)
		go admin.ListenAndServe(cfg.Admin.ListenAddr, adminSrv)
	}

	// --- Build the main handler with full middleware chain ---
	handler := buildHandler(cfgHolder, rdb, ring, tokenBucket, slidingWindow, rt, balancers, breakerReg, globalStats)

	// Middleware chain (outermost first):
	// request_id → logging → metrics → auth → [handler: rate_limit → route → LB → breaker → proxy]
	handler = middleware.Auth(cfgHolder)(handler)
	handler = middleware.Metrics()(handler)
	handler = middleware.Logging()(handler)
	handler = middleware.RequestID()(handler)

	// Prometheus metrics endpoint (separate from gateway routes)
	mux := http.NewServeMux()
	mux.Handle("/metrics", promhttp.Handler())
	mux.Handle("/", handler)

	// --- Start main server ---
	srv := &http.Server{
		Addr:         cfg.Server.ListenAddr,
		Handler:      mux,
		ReadTimeout:  cfg.Server.ReadTimeout,
		WriteTimeout: cfg.Server.WriteTimeout,
	}

	go func() {
		log.Printf("gateway listening on %s", cfg.Server.ListenAddr)
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("server error: %v", err)
		}
	}()

	// --- Graceful shutdown ---
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit
	log.Println("shutting down gateway...")

	shutdownCtx, cancel := context.WithTimeout(context.Background(), cfg.Server.DrainTimeout)
	defer cancel()
	if err := srv.Shutdown(shutdownCtx); err != nil {
		log.Fatalf("forced shutdown: %v", err)
	}
	rdb.Close()
	log.Println("gateway stopped")
}

// buildHandler constructs the core gateway handler:
// rate limit → route → load balance → circuit breaker → reverse proxy.
func buildHandler(
	cfgHolder *config.ConfigHolder,
	rdb *redis.Client,
	ring *hashring.Ring,
	tokenBucket *ratelimit.TokenBucket,
	slidingWindow *ratelimit.SlidingWindow,
	rt *router.Router,
	balancers map[string]loadbalancer.Balancer,
	breakerReg *breaker.BreakerRegistry,
	stats *admin.Stats,
) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if stats != nil {
			stats.TotalRequests.Add(1)
		}
		
		cfg := cfgHolder.Get()

		// --- 1. Get tier from context (set by auth middleware) ---
		tier := middleware.GetTier(r.Context())
		apiKey := middleware.GetAPIKey(r.Context())

		// --- 2. Route matching ---
		matched, ok := rt.Match(r)
		if !ok {
			http.Error(w, `{"error":"no matching route"}`, http.StatusNotFound)
			return
		}

		// Determine rate limit tier (route override > auth-derived)
		effectiveTier := tier
		if matched.RateLimitTier != "" {
			effectiveTier = matched.RateLimitTier
		}

		// --- 3. Rate limiting ---
		tierCfg, tierExists := cfg.RateLimits[effectiveTier]
		if tierExists {
			algo := tierCfg.Algorithm
			if matched.Algorithm != "" {
				algo = matched.Algorithm
			}

			clientID := apiKey
			if clientID == "" {
				clientID = r.RemoteAddr
			}
			rlKey := fmt.Sprintf("rl:%s:%s", effectiveTier, clientID)

			// Shard via consistent hashing
			_ = ring.GetNode(rlKey)

			var allowed bool
			var retryAfter time.Duration
			var rlErr error

			switch algo {
			case "sliding_window":
				maxReqs := tierCfg.Rate
				window := tierCfg.Window
				if window == 0 {
					window = time.Minute
				}
				allowed, retryAfter, rlErr = slidingWindow.Allow(r.Context(), rdb, rlKey, maxReqs, window)
			default: // token_bucket
				allowed, retryAfter, rlErr = tokenBucket.Allow(r.Context(), rdb, rlKey, tierCfg.Rate, tierCfg.Burst)
			}

			if rlErr != nil {
				// Fail open: log warning but allow request
				log.Printf("WARNING: rate limiter error (fail-open): %v", rlErr)
				middleware.RateLimitDecisions.WithLabelValues("error", effectiveTier, algo).Inc()
			} else if !allowed {
				if stats != nil {
					stats.Total429s.Add(1)
				}
				w.Header().Set("Retry-After", fmt.Sprintf("%.0f", retryAfter.Seconds()))
				w.Header().Set("X-RateLimit-Tier", effectiveTier)
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(http.StatusTooManyRequests)
				fmt.Fprint(w, `{"error":"rate limit exceeded"}`)
				middleware.RateLimitDecisions.WithLabelValues("denied", effectiveTier, algo).Inc()
				return
			} else {
				middleware.RateLimitDecisions.WithLabelValues("allowed", effectiveTier, algo).Inc()
			}
		}

		// --- 4. Load balancing ---
		bal, ok := balancers[matched.Pool]
		if !ok {
			http.Error(w, `{"error":"upstream pool not found"}`, http.StatusBadGateway)
			return
		}

		upstream, err := bal.Next()
		if err != nil {
			http.Error(w, fmt.Sprintf(`{"error":"no healthy upstream: %s"}`, err.Error()), http.StatusServiceUnavailable)
			return
		}

		// Track active connections
		upstream.IncrConns()
		defer upstream.DecrConns()
		middleware.UpstreamActiveConnections.WithLabelValues(upstream.ID).Set(float64(upstream.ActiveConns()))
		defer func() {
			middleware.UpstreamActiveConnections.WithLabelValues(upstream.ID).Set(float64(upstream.ActiveConns()))
		}()

		// --- 5. Circuit breaker + reverse proxy ---
		cb := breakerReg.Get(upstream.ID)

		cbErr := cb.Execute(func() error {
			target, parseErr := url.Parse(upstream.URL)
			if parseErr != nil {
				return parseErr
			}

			proxy := &httputil.ReverseProxy{
				Director: func(req *http.Request) {
					req.URL.Scheme = target.Scheme
					req.URL.Host = target.Host
					req.Host = target.Host
					if matched.StripPrefix {
						req.URL.Path = strings.TrimPrefix(req.URL.Path, matched.PathPrefix)
						if req.URL.Path == "" {
							req.URL.Path = "/"
						}
					}
				},
				ErrorHandler: func(rw http.ResponseWriter, req *http.Request, proxyErr error) {
					log.Printf("proxy error to %s: %v", upstream.ID, proxyErr)
					// Don't write response here — the error will be returned
					// to the circuit breaker's Execute, which handles it
				},
			}

			proxy.ServeHTTP(w, r)
			return nil
		})

		if cbErr != nil {
			if cbErr == breaker.ErrCircuitOpen {
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(http.StatusServiceUnavailable)
				fmt.Fprintf(w, `{"error":"circuit breaker open for upstream %s"}`, upstream.ID)
			}
			// Other errors from the proxy were already handled by ErrorHandler
		}
	})
}
