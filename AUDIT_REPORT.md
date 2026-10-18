# Flux-GO API Gateway: Comprehensive Security, Concurrency, Reliability & Architectural Audit

**Document Version:** 1.0.0 — Publication Grade  
**Date:** 2026-10-19  
**Target Codebase:** Flux-GO Distributed Rate Limiter & API Gateway (`github.com/ANSUJKMEHER/rate-limiter-gateway`)  
**Audit Type:** Full-Scope Architectural, Security, Concurrency, Reliability, and Benchmark Audit  
**Classification:** Public Security & Engineering Report  

---

## 1. Executive Summary & Architectural Scorecard

### 1.1. Executive Narrative

A full-spectrum architectural, security, concurrency, and reliability assessment was performed on the **Flux-GO** distributed rate limiter gateway repository. Flux-GO is designed as a high-performance Go-based API gateway combining distributed rate limiting (Token Bucket and Sliding Window Log backed by Redis Lua scripts), layer-7 HTTP reverse proxying, active health monitoring, multiple upstream load balancing algorithms (Round Robin, Least Connections, Smooth Weighted Round Robin, Power of Two Random Choices), per-upstream circuit breaking, and Prometheus telemetry.

The audit team analyzed the entire source tree (`cmd/`, `internal/`, `configs/`, `deployments/`, `benchmarks/`), conducted deep semantic tracing across Go concurrency primitives and Redis Lua execution contexts, verified configuration manifests, and evaluated reported empirical benchmark methodologies.

While the gateway demonstrates clean Go package modularity, well-structured domain interfaces, and modern DevOps integration (Docker Compose, Prometheus, Grafana, and Caddy), **critical architectural disconnects and high-severity security vulnerabilities invalidate its readiness for production workloads**.

Most notably:
1. **Critical Failure of Circuit Breaker Subsystem (REL-01)**: In `cmd/gateway/main.go`, `httputil.ReverseProxy.ServeHTTP` is executed within `cb.Execute(func() error { ... return nil })`. Network disconnects, dial timeouts, and 5xx server failures are swallowed by `ReverseProxy.ErrorHandler` without returning an error to the closure. As a result, the circuit breaker treats 100% of upstream network failures as successful requests, **never trips from Closed to Open**, and delivers misleading, empty HTTP 200 OK responses to calling clients.
2. **Catastrophic Credential and Topology Exfiltration (SEC-01 & SEC-02)**: The administrative listener on `:9091` exposes `/admin/config` without any authentication. This endpoint dumps plaintext customer API keys, JWT signing secrets, Redis authentication passwords, and internal network topology. Compounding this risk, the admin server sets `Access-Control-Allow-Origin: *`, and `deployments/Caddyfile` proxies `/admin/*` directly to public ingress, enabling cross-origin intranet and internet exfiltration via any web browser.
3. **Denial of Service via Prometheus Cardinality Explosion (SEC-03)**: Unauthenticated requests to `/metrics` combined with raw `r.URL.Path` label recording inside `middleware/metrics.go` allow external actors to trigger unbounded heap allocations, leading to rapid process out-of-memory (OOM) termination.
4. **Rate Limiting Invalidation Under Clock Skew and Concurrency (CONC-01 & CONC-03)**: Token bucket refills calculate elapsed time using host-provided microsecond timestamps rather than Redis server time, draining client buckets under clock drift. Simultaneously, sliding window logs use coarse nanosecond timestamps as unique sorted set members, causing concurrent requests to overwrite scores without incrementing the counter, resulting in substantial rate limit bypasses.
5. **Severe Upstream Socket Starvation (REL-06 & CONC-08)**: The reverse proxy omits a custom `Transport`, defaulting to Go's `http.DefaultTransport` with `MaxIdleConnsPerHost = 2`. Under 500 concurrent virtual users (VUs), 498 connections per host are continuously torn down and recreated, causing socket starvation and explaining the latency spikes observed in benchmarks. Furthermore, the Redis connection pool (`pool_size: 10`) creates artificial 500ms+ queuing delays.
6. **Severe Testing Vacuum (ARCH-03 / SEC-05 / REL-05)**: Ten core components—including the primary Redis Lua rate-limiting scripts, health checker, auth middleware, and proxy handler—possess **0% unit test coverage**. Microbenchmarks suffer from dead-code elimination and omitted parallelism.

---

### 1.2. Subdomain Architectural Scorecard

| Architectural Subdomain | Rating | Grade | Primary Posture Summary |
|---|:---:|:---:|---|
| **Security & Authentication (R1)** | 2.5 / 10 | **F** | Administrative endpoints expose plaintext secrets without authentication; wildcard CORS enables CSRF/exfiltration; metric labels create unbounded memory DoS; anonymous auth is fail-open; client IP rate limiting is bypassed via ephemeral ports. |
| **Concurrency & Atomicity (R2)** | 4.0 / 10 | **D-** | Host-time dependencies in Lua cause negative refills under clock skew; division-by-zero crashes on zero rates; timestamp collisions in sliding window bypass limits; least connections suffers from herding race conditions; global balancer mutexes serialize requests. |
| **Reliability & Upstream Resilience (R3)** | 2.0 / 10 | **F** | ReverseProxy swallows errors, preventing circuit breaker from ever tripping on outages; half-open state allows unbounded thundering herds; health checker exhibits flapping; HTTP bodies are not drained; default transport exhausts sockets under load. |
| **Architecture & Go Idioms (R4)** | 5.0 / 10 | **C-** | Clean package layout and modular interface definitions; however, consistent hash ring sharding is dead code, config hot-reload is a non-functional stub, and path prefix stripping creates malformed unrooted relative URLs. |
| **Test Suite Completeness & Benchmarks (R5)** | 3.0 / 10 | **E** | 10 of 14 components have 0% test coverage; Redis Lua scripts completely untested; microbenchmarks discard return values (compiler dead-code elimination) and lack parallel execution (`b.RunParallel`). |
| **Overall Production Readiness Posture** | **3.3 / 10** | **NOT PRODUCTION READY** | **CRITICAL DEFECTS PRESENT.** Requires systematic remediation of security boundaries, circuit breaker proxy integration, Lua script atomicity, and transport pooling before handling production traffic. |

---

## 2. Comprehensive Severity-Ranked Findings Table

The audit identified **33 discrete findings**, classified across five standardized severity tiers according to potential business impact, exploitability, and system failure risk:

| Finding ID | Title | Category | Severity | CWE / Bug Class | Impact Summary | Affected File(s) & Lines |
|---|---|---|---|---|---|---|
| **SEC-01** | Unauthenticated Sensitive Credential & Topology Exfiltration via `/admin/config` | Security & Auth | **CRITICAL** | CWE-200, CWE-306 | Complete compromise of customer API keys, JWT secret, Redis password, and upstream host topology to external unauthenticated attackers. | `internal/admin/admin.go:53, 80-84`, `deployments/Caddyfile:12-14` |
| **REL-01** | ReverseProxy Error Swallowing Disables Circuit Breaker & Returns Empty 200 OK | Reliability & Fault-Tolerance | **CRITICAL** | Silent Failure / State Machine Bypass | Breaker treats 100% of network dial failures, timeouts, and outages as successes; breaker never trips open; clients receive 200 OK with empty body. | `cmd/gateway/main.go:299-335` |
| **CONC-03** | Coarse Nanosecond Timestamp Collision & Member Overwrite Rate Bypass in Sliding Window Log | Concurrency & Atomicity | **CRITICAL** | Race Condition / Counter Invalidation | Concurrent requests within identical timer ticks overwrite ZSET members without incrementing counter, allowing bursts to bypass rate limits. | `internal/ratelimit/sliding_window.go:45`, `internal/ratelimit/lua/sliding_window.lua:25` |
| **SEC-02** | Overly Permissive Wildcard CORS on Admin API Enabling Cross-Origin Intranet Exfiltration | Security & Auth | **HIGH** | CWE-942, CWE-346 | Malicious web pages visited by administrators can silently query `localhost:9091` or intranet IPs and exfiltrate secrets via browser JavaScript. | `internal/admin/admin.go:67-77` |
| **SEC-03** | Public `/metrics` Exposure & Metric Cardinality Explosion Denial of Service | Security & Auth | **HIGH** | CWE-400, CWE-306 | Unauthenticated callers sending arbitrary URL paths allocate unbounded Prometheus time-series memory, triggering gateway OOM crash. | `cmd/gateway/main.go:151-153`, `internal/middleware/metrics.go:78-94` |
| **SEC-04** | Fail-Open Anonymous Auth & Lack of Route-Level Access Controls | Security & Auth | **HIGH** | CWE-287, CWE-306 | Requests missing `X-API-Key` automatically receive free-tier access across all upstream routes; no mechanism exists to require authentication per route. | `internal/middleware/auth.go:63-75`, `internal/config/config.go:61-69` |
| **CONC-01** | Host Clock Drift & Skew Causing Negative Token Refill in Token Bucket Lua | Concurrency & Atomicity | **HIGH** | Clock Drift / State Corruption | Gateway nodes with out-of-sync clocks pass backward timestamps, causing negative token refills and draining client quotas spuriously. | `internal/ratelimit/lua/token_bucket.lua:25-28`, `internal/ratelimit/token_bucket.go:42` |
| **CONC-02** | Division-by-Zero Lua Runtime Crash & Gateway Fail-Open | Concurrency & Atomicity | **HIGH** | CWE-369 / Script Abort | Setting `rate: 0` passes `inf` to Redis `EXPIRE`, aborting Lua script with runtime exception; gateway fails open, permitting unauthorized traffic. | `internal/ratelimit/lua/token_bucket.lua:34, 39, 41` |
| **CONC-05** | Decoupled Upstream Selection & Connection Increment Race Condition in `LeastConn` | Concurrency & Atomicity | **HIGH** | Race Condition / Herd Effect | Upstream selection and connection counter increment are non-atomic; concurrent bursts see 0 connections and all herd onto the first upstream. | `cmd/gateway/main.go:282-289`, `internal/loadbalancer/least_conn.go:15-34` |
| **CONC-07** | Data Race & Concurrent Map Read/Write Crash Risk in `ConfigHolder` | Concurrency & Atomicity | **HIGH** | Data Race / Fatal Crash | `Get()` returns raw pointer outside read lock; concurrent map reads and background reload writes cause fatal Go runtime crash. | `internal/config/config.go:234-246`, `internal/middleware/auth.go:61, 67` |
| **CONC-08** | Redis Connection Pool Starvation Under High Concurrent Worker Load | Concurrency & Atomicity | **HIGH** | Resource Exhaustion | `pool_size: 10` blocks up to 490 concurrent workers waiting on connection semaphores, inflating p99 latency to 537ms+. | `configs/gateway.yaml:16`, `cmd/gateway/main.go:43-48` |
| **REL-02** | Circuit Breaker Thundering Herd & Unbounded Probe Concurrency in `StateHalfOpen` | Reliability & Fault-Tolerance | **HIGH** | Cascading Failure | No concurrency bound exists in `StateHalfOpen`; hundreds of concurrent requests flood recovering upstreams simultaneously. | `internal/breaker/breaker.go:120-136` |
| **REL-06** | Socket Starvation & Ephemeral Port Exhaustion via `MaxIdleConnsPerHost = 2` | Reliability & Fault-Tolerance | **HIGH** | Socket Starvation / TCP Churn | ReverseProxy defaults to `http.DefaultTransport`, tearing down connections after 2 idle sockets; causes port exhaustion under 500 VUs. | `cmd/gateway/main.go:305-322` |
| **ARCH-01** | Dead Consistent Hash Ring Key Sharding in Runtime Request Path | Architecture & Idioms | **HIGH** | Dead Code / Architectural Deficit | Consistent hash ring is initialized with a dummy node (`"shard-0"`), and the lookup result is discarded (`_ = ring.GetNode(rlKey)`). | `cmd/gateway/main.go:60-62, 237` |
| **ARCH-03** | Compiler Dead-Code Elimination in Microbenchmarks via Discarded Return Values | Architecture & Idioms | **HIGH** | Benchmarking Invalidation | Microbenchmarks discard return values, allowing the Go compiler to optimize away benchmark loops and report deceptively fast timings. | `internal/loadbalancer/balancer_test.go:272-310`, `internal/router/router_test.go:118-129` |
| **ARCH-04** | Missing Parallel Microbenchmarks (`b.RunParallel`) Concealing Balancer Mutex Serialization | Architecture & Idioms | **HIGH** | Benchmarking Distortion | Benchmarks only evaluate single-threaded execution, hiding extreme `sync.Mutex` contention in `Weighted` and `PowerOfTwo` balancers. | `internal/loadbalancer/balancer_test.go:272-310` |
| **SEC-05** | Rate Limiting Bypass via `r.RemoteAddr` Ephemeral Port Key Fragmentation | Security & Auth | **MEDIUM** | CWE-770, CWE-807 | Anonymous client rate limiting includes ephemeral TCP ports in the key, creating a brand new quota bucket for every TCP connection. | `cmd/gateway/main.go:230-234` |
| **SEC-06** | Missing Proxy Header Forwarding, Sanitization & Exposed Upstream Chaos Controls | Security & Auth | **MEDIUM** | CWE-444, CWE-345 | Proxy fails to configure standard `X-Forwarded-*` headers, and Caddy exposes `/chaos/*` endpoints directly to public ingress. | `cmd/gateway/main.go:305-316`, `deployments/Caddyfile:17-30` |
| **SEC-07** | Plaintext Credential Storage in YAML and In-Memory Structures | Security & Auth | **MEDIUM** | CWE-312, CWE-256 | API keys and JWT secrets stored in plaintext memory maps without cryptographic hashing or constant-time comparison. | `internal/config/config.go:50`, `configs/gateway.yaml:20-31` |
| **CONC-04** | Permanent Sorted Set Retention & Redis Memory Leak via Denied Request PEXPIRE | Concurrency & Atomicity | **MEDIUM** | CWE-400 / Memory Leak | Every denied sliding window request refreshes `PEXPIRE`; spammed keys are retained permanently in Redis memory. | `internal/ratelimit/lua/sliding_window.lua:40` |
| **CONC-06** | Global Mutex Contention Hotspots & Allocation Churn in `PowerOfTwo` and `Weighted` Balancers | Concurrency & Atomicity | **MEDIUM** | Contention / Allocation Overhead | Global `sync.Mutex` and per-request slice allocations in `Next()` serialize concurrent worker goroutines. | `internal/loadbalancer/power_of_two.go:34-44`, `internal/loadbalancer/weighted.go:29-31` |
| **REL-03** | Fragile Consecutive Failure Counter Masking Partial/Intermittent Outages | Reliability & Fault-Tolerance | **MEDIUM** | Fault Detection Gap | Single success resets consecutive failure counter; an upstream with 80% packet loss never trips the circuit breaker open. | `internal/breaker/breaker.go:151-182` |
| **REL-04** | Asymmetric Upstream Health Checker Recovery & Flapping | Reliability & Fault-Tolerance | **MEDIUM** | Flapping / Health Oscillation | 3 consecutive failures to mark unhealthy, but only 1 single success to restore healthy; flapping upstreams continually oscillate. | `internal/health/checker.go:124-149` |
| **REL-05** | Health Probe HTTP Response Body Drain Deficit Destroying TCP Keep-Alive | Reliability & Fault-Tolerance | **MEDIUM** | Connection Leak | Probe responses close body without reading to EOF, preventing TCP connection reuse and forcing continuous socket re-dials. | `internal/health/checker.go:110-115` |
| **ARCH-02** | Phantom Configuration Hot-Reload (`PUT /admin/config` Unimplemented, Balancers & Routers Immutable) | Architecture & Idioms | **MEDIUM** | Incomplete Feature | Doc comments specify `PUT /admin/config`, but no handler is registered; runtime pools and router tables are immutable. | `internal/admin/admin.go:4-5, 53-57`, `internal/config/config.go:241-246` |
| **ARCH-05** | Memory Allocation Noise & String Formatting Overhead in `BenchmarkGetNode` | Architecture & Idioms | **MEDIUM** | Benchmarking Noise | `BenchmarkGetNode` executes `fmt.Sprintf` inside the inner benchmark loop, measuring heap allocation speed rather than binary search. | `internal/hashring/hashring_test.go:187-198` |
| **ARCH-08** | Path Prefix Stripping Generating Malformed Unrooted Relative Paths & IPv6 Host Truncation | Architecture & Idioms | **MEDIUM** | Routing Defect | Stripping path prefixes without checking leading slash creates invalid HTTP request lines (`GET items HTTP/1.1`); IPv6 host headers truncated. | `cmd/gateway/main.go:310-315`, `internal/router/router.go:66-72` |
| **SEC-08** | HTTP Log Injection via Unsanitized `X-Request-ID` Header | Security & Auth | **LOW** | CWE-117 | Client-supplied `X-Request-ID` containing CRLF sequences is written directly to standard log outputs without sanitization. | `internal/middleware/request_id.go:16-27`, `internal/middleware/logging.go:44-52` |
| **SEC-09** | Hardcoded Default Credentials & Secrets in Deployment Manifests | Security & Auth | **LOW** | CWE-798, CWE-1188 | Default secrets (`"change-me-in-production"`, `"admin"`) in `gateway.yaml` and `docker-compose.yaml`. | `configs/gateway.yaml:28`, `deployments/docker-compose.yaml:92-93` |
| **SEC-10** | Unchecked Entropy Error in Cryptographic Request ID Generation | Security & Auth | **LOW** | CWE-330 | `rand.Read(b)` error ignored in `generateID()`; failure of entropy pool leaves buffer zeroed, producing duplicate IDs. | `internal/middleware/request_id.go:31-36` |
| **REL-07** | Health Checker Graceful Shutdown Goroutine Leaks & False Failure Recording | Reliability & Fault-Tolerance | **LOW** | Goroutine Leak | `Stop()` cancels context without waiting for background probe loops; canceling in-flight probes falsely logs upstream failures. | `internal/health/checker.go:65-83, 111-112` |
| **ARCH-06** | Non-Portable Hardcoded File System Paths in `cmd/loadtest/main.go` | Architecture & Idioms | **LOW** | Portability Bug | Loadtester specifies hardcoded Windows paths (`"d:\\rate\\bin\\gateway.exe"`), failing immediately in other environments. | `cmd/loadtest/main.go:38, 237` |
| **ARCH-07** | Root Execution of Gateway Binary in Production Docker Container | Architecture & Idioms | **LOW** | Principle of Least Privilege | Production Dockerfile executes the gateway binary as UID 0 (`root`) instead of an unprivileged service account. | `Dockerfile:21-32` |

---

## 3. Section R1: Security & Authentication Audit (SEC-01 to SEC-10)

### SEC-01 [CRITICAL]: Unauthenticated Sensitive Credential & Topology Exfiltration via `/admin/config`
* **Affected File & Lines:** `internal/admin/admin.go:53, 80-84`, `deployments/Caddyfile:12-14`
* **CWE Classification:** CWE-200 (Exposure of Sensitive Information to an Unauthorized Actor), CWE-306 (Missing Authentication for Critical Function)
* **Technical Mechanism of Failure:**  
  In `internal/admin/admin.go`, the admin server initializes a route multiplexer and registers:
  ```go
  s.mux.HandleFunc("GET /admin/config", s.handleGetConfig)
  ```
  The handler implementation extracts the live configuration and serializes it directly to JSON:
  ```go
  func (s *Server) handleGetConfig(w http.ResponseWriter, r *http.Request) {
      cfg := s.cfgHolder.Get()
      w.Header().Set("Content-Type", "application/json")
      json.NewEncoder(w).Encode(cfg)
  }
  ```
  No authentication, authorization, Bearer token verification, or client IP filtering is enforced. The returned `GatewayConfig` contains `cfg.Auth.APIKeys` (a map of plaintext API keys to tiers), `cfg.Auth.JWT.Secret` (the production HMAC signing secret), `cfg.Redis.Password`, and `cfg.Pools` (complete backend network topology). In `deployments/Caddyfile`, lines 12-14 route `/admin/*` directly to `gateway:9091` over public TLS.
* **Realistic Exploit / Failure Scenario:**  
  An unauthenticated attacker anywhere on the public internet issues a simple HTTP request:
  `curl -s https://<domain>/admin/config`
  The response returns a full JSON payload containing:
  1. Plaintext customer API keys (`"enterprise-key-001"`, `"pro-key-001"`) allowing the attacker to impersonate enterprise tier clients and bypass rate limits.
  2. The production JWT signing secret (`"change-me-in-production"` or actual secret), enabling the attacker to forge arbitrary JWT claims and elevate privileges across downstream microservices.
  3. The Redis password and upstream hostnames/ports, exposing internal infrastructure to pivot attacks.
* **Concrete Drop-In Code Remediation:**
  Create a sanitized Data Transfer Object (DTO) that explicitly redacts cryptographic secrets and credentials, and require an administrative bearer token:
  ```go
  // In internal/admin/admin.go:
  type SanitizedConfig struct {
      Server     config.ServerConfig               `json:"server"`
      Admin      config.AdminConfig                `json:"admin"`
      Routes     []config.RouteConfig              `json:"routes"`
      Pools      map[string]config.UpstreamPool    `json:"pools"`
      RateLimits map[string]config.RateLimitTier   `json:"rate_limits"`
      Breaker    config.BreakerConfig              `json:"breaker"`
      Health     config.HealthConfig               `json:"health"`
      Auth       SanitizedAuthConfig               `json:"auth"`
      RedisAddr  string                            `json:"redis_addr"`
  }

  type SanitizedAuthConfig struct {
      Mode         string   `json:"mode"`
      ConfiguredKeys int    `json:"configured_keys_count"`
      JWTEnabled   bool     `json:"jwt_enabled"`
      JWTIssuer    string   `json:"jwt_issuer"`
  }

  func (s *Server) handleGetConfig(w http.ResponseWriter, r *http.Request) {
      cfg := s.cfgHolder.Get()
      sanitized := SanitizedConfig{
          Server:     cfg.Server,
          Admin:      cfg.Admin,
          Routes:     cfg.Routes,
          Pools:      cfg.Pools,
          RateLimits: cfg.RateLimits,
          Breaker:    cfg.Breaker,
          Health:     cfg.Health,
          Auth: SanitizedAuthConfig{
              Mode:         cfg.Auth.Mode,
              ConfiguredKeys: len(cfg.Auth.APIKeys),
              JWTEnabled:   cfg.Auth.JWT.Secret != "",
              JWTIssuer:    cfg.Auth.JWT.Issuer,
          },
          RedisAddr: cfg.Redis.Addr,
      }
      w.Header().Set("Content-Type", "application/json")
      json.NewEncoder(w).Encode(sanitized)
  }
  ```

---

### SEC-02 [HIGH]: Overly Permissive Wildcard CORS on Admin API Enabling Cross-Origin Intranet Exfiltration
* **Affected File & Lines:** `internal/admin/admin.go:67-77`
* **CWE Classification:** CWE-942 (Permissive Cross-Domain Policy with Untrusted Domains), CWE-346 (Origin Validation Error)
* **Technical Mechanism of Failure:**  
  The admin server wraps its request dispatcher with an open CORS handler in `internal/admin/admin.go`:
  ```go
  func (s *Server) Handler() http.Handler {
      return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
          w.Header().Set("Access-Control-Allow-Origin", "*")
          w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
          w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
          if r.Method == "OPTIONS" {
              w.WriteHeader(http.StatusOK)
              return
          }
          s.mux.ServeHTTP(w, r)
      })
  }
  ```
  Setting `Access-Control-Allow-Origin: *` informs client browsers that any third-party web origin is permitted to read response bodies returned by this API.
* **Realistic Exploit / Failure Scenario:**  
  An operator or developer running the gateway locally or within a private VPN opens a malicious or compromised web page in their web browser. A background JavaScript script executes:
  `fetch("http://localhost:9091/admin/config").then(r => r.json()).then(data => sendToAttacker(data));`
  Because `Access-Control-Allow-Origin` is `*`, the browser's Same-Origin Policy (SOP) allows the malicious page to read the complete configuration, instantly transmitting all API keys and JWT secrets from the user's private intranet to an external attacker.
* **Concrete Drop-In Code Remediation:**
  Restrict CORS origins to an explicitly configured trusted admin domain, or disallow CORS altogether if the dashboard is served from the same origin:
  ```go
  // In internal/admin/admin.go:
  func (s *Server) Handler(trustedOrigin string) http.Handler {
      return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
          origin := r.Header.Get("Origin")
          if origin != "" && (origin == trustedOrigin || trustedOrigin == "") {
              w.Header().Set("Access-Control-Allow-Origin", origin)
              w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
              w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")
              w.Header().Set("Vary", "Origin")
          } else if origin != "" {
              // Untrusted cross-origin request
              w.WriteHeader(http.StatusForbidden)
              return
          }
          if r.Method == http.MethodOptions {
              w.WriteHeader(http.StatusNoContent)
              return
          }
          s.mux.ServeHTTP(w, r)
      })
  }
  ```

---

### SEC-03 [HIGH]: Public `/metrics` Exposure & Metric Cardinality Explosion Denial of Service
* **Affected File & Lines:** `cmd/gateway/main.go:151-153`, `internal/middleware/metrics.go:78-94`
* **CWE Classification:** CWE-400 (Uncontrolled Resource Consumption), CWE-306 (Missing Authentication for Critical Function)
* **Technical Mechanism of Failure:**  
  1. In `cmd/gateway/main.go`, `/metrics` is mounted on the public gateway listener (`:8080`) alongside public routes without authentication:
     ```go
     mux := http.NewServeMux()
     mux.Handle("/metrics", promhttp.Handler())
     mux.Handle("/", handler)
     ```
  2. In `internal/middleware/metrics.go`:
     ```go
     path := r.URL.Path
     RequestsTotal.WithLabelValues(r.Method, path, strconv.Itoa(rc.statusCode), tier).Inc()
     RequestDuration.WithLabelValues(r.Method, path).Observe(duration)
     ```
  Because the metrics middleware executes before route matching or authentication, raw user-controlled paths (`r.URL.Path`) are ingested directly as Prometheus metric labels.
* **Realistic Exploit / Failure Scenario:**  
  An attacker generates an HTTP flood requesting randomized URLs:
  `GET /probe-uuid-001a HTTP/1.1`, `GET /probe-uuid-002b HTTP/1.1`, etc.
  Each unique path produces a new time series entry in Prometheus client memory (`gateway_requests_total` and `gateway_request_duration_seconds_bucket`). With 11 duration buckets per time series, 100,000 requests generate over 1.1 million metric streams in Go heap memory. The gateway's memory usage balloons exponentially within minutes, triggering Go garbage collection thrashing and a fatal Out-Of-Memory (OOM) kernel termination.
* **Concrete Drop-In Code Remediation:**
  1. Move the `/metrics` endpoint to the private admin server (`:9091`).
  2. Normalize the `path` label by using the matched route prefix rather than raw request URLs, and classify unmatched routes as `"unmatched"`:
  ```go
  // In internal/middleware/metrics.go:
  type routeContextKey string
  const MatchedPathKey routeContextKey = "matched_path"

  func SetMatchedPath(ctx context.Context, path string) context.Context {
      return context.WithValue(ctx, MatchedPathKey, path)
  }

  func GetMatchedPath(ctx context.Context) string {
      if v, ok := ctx.Value(MatchedPathKey).(string); ok {
          return v
      }
      return "unmatched"
  }

  // Inside Metrics middleware:
  next.ServeHTTP(rc, r)
  normalizedPath := GetMatchedPath(r.Context())
  RequestsTotal.WithLabelValues(r.Method, normalizedPath, strconv.Itoa(rc.statusCode), tier).Inc()
  RequestDuration.WithLabelValues(r.Method, normalizedPath).Observe(duration)
  ```

---

### SEC-04 [HIGH]: Fail-Open Anonymous Auth & Lack of Route-Level Access Controls
* **Affected File & Lines:** `internal/middleware/auth.go:63-75`, `internal/config/config.go:61-69`
* **CWE Classification:** CWE-287 (Improper Authentication), CWE-306 (Missing Authentication for Critical Function)
* **Technical Mechanism of Failure:**  
  In `internal/middleware/auth.go`:
  ```go
  apiKey := r.Header.Get("X-API-Key")
  tier := "free"
  if apiKey != "" {
      if t, ok := cfg.Auth.APIKeys[apiKey]; ok {
          tier = t
      } else {
          w.WriteHeader(http.StatusUnauthorized)
          return
      }
  }
  ctx := context.WithValue(r.Context(), TierKey, tier)
  ```
  If `X-API-Key` is missing, execution proceeds without error, assigning `tier = "free"`. In `internal/config/config.go`, `RouteConfig` lacks any directive specifying whether authentication is mandatory (e.g. `RequireAuth: bool` or `AllowedTiers: []string`).
* **Realistic Exploit / Failure Scenario:**  
  Sensitive internal routes configured in `gateway.yaml` (such as `/api/v1/users`, `/api/v1/orders`) are intended for authenticated clients. However, an external caller who provides no credentials at all is granted access to all backend routes under the `"free"` tier quota, completely subverting intended access controls.
* **Concrete Drop-In Code Remediation:**
  Add `AuthRequired bool` and `AllowedTiers []string` to `RouteConfig` and enforce route access controls in `buildHandler`:
  ```go
  // In internal/config/config.go:
  type RouteConfig struct {
      PathPrefix    string   `yaml:"path_prefix"`
      Host          string   `yaml:"host,omitempty"`
      StripPrefix   bool     `yaml:"strip_prefix"`
      Pool          string   `yaml:"pool"`
      RateLimitTier string   `yaml:"rate_limit_tier"`
      Algorithm     string   `yaml:"algorithm,omitempty"`
      AuthRequired  bool     `yaml:"auth_required"`
      AllowedTiers  []string `yaml:"allowed_tiers,omitempty"`
  }

  // In cmd/gateway/main.go buildHandler:
  if matched.AuthRequired && apiKey == "" {
      w.Header().Set("Content-Type", "application/json")
      w.WriteHeader(http.StatusUnauthorized)
      fmt.Fprint(w, `{"error":"authentication required for this route"}`)
      return
  }
  ```

---

### SEC-05 [MEDIUM]: Rate Limiting Bypass via `r.RemoteAddr` Ephemeral Port Key Fragmentation
* **Affected File & Lines:** `cmd/gateway/main.go:230-234`
* **CWE Classification:** CWE-770 (Allocation of Resources Without Limits or Throttling), CWE-807 (Reliance on Untrusted Inputs in a Security Decision)
* **Technical Mechanism of Failure:**  
  In `cmd/gateway/main.go`:
  ```go
  clientID := apiKey
  if clientID == "" {
      clientID = r.RemoteAddr
  }
  rlKey := fmt.Sprintf("rl:%s:%s", effectiveTier, clientID)
  ```
  In Go's `net/http`, `r.RemoteAddr` is formatted as `"IP:port"` (e.g., `"192.0.2.1:54321"`). Every newly initiated TCP connection assigns a distinct ephemeral port from the client's operating system stack.
* **Realistic Exploit / Failure Scenario:**  
  An unauthenticated client or scraper disables HTTP Keep-Alive (`Connection: close`) or opens concurrent TCP connections. Because the client port changes on every request, `rlKey` is evaluated as `rl:free:192.0.2.1:54321`, then `rl:free:192.0.2.1:54322`, etc. Each connection receives an independent token bucket or sliding window log in Redis. The rate limit is completely bypassed, allowing the client to send thousands of requests per second without encountering an HTTP 429 status code.
* **Concrete Drop-In Code Remediation:**
  Strip the ephemeral port from `r.RemoteAddr` using `net.SplitHostPort`:
  ```go
  // In cmd/gateway/main.go:
  clientID := apiKey
  if clientID == "" {
      ip, _, err := net.SplitHostPort(r.RemoteAddr)
      if err != nil {
          ip = r.RemoteAddr
      }
      clientID = ip
  }
  rlKey := fmt.Sprintf("rl:%s:%s", effectiveTier, clientID)
  ```

---

### SEC-06 [MEDIUM]: Missing Proxy Header Forwarding, Sanitization & Exposed Upstream Chaos Controls
* **Affected File & Lines:** `cmd/gateway/main.go:305-316`, `deployments/Caddyfile:17-30`
* **CWE Classification:** CWE-444 (Inconsistent HTTP Request Parsing), CWE-345 (Insufficient Verification of Data Authenticity)
* **Technical Mechanism of Failure:**  
  1. In `cmd/gateway/main.go`, `httputil.ReverseProxy.Director` rewrites the request URL and host but does not sanitize, append, or validate `X-Forwarded-For`, `X-Forwarded-Proto`, or `X-Forwarded-Host`. Upstream microservices receive raw or forged client proxy headers.
  2. In `deployments/Caddyfile`, lines 17-30 expose mock upstream chaos endpoints publicly:
     ```caddy
     handle /chaos/mock-a {
         rewrite * /chaos
         reverse_proxy upstream-a:9001
     }
     ```
* **Realistic Exploit / Failure Scenario:**  
  External internet users can issue HTTP POST requests directly to `https://<domain>/chaos/mock-a` with payloads such as `{"error_rate": 1.0, "latency_ms": 10000}`, intentionally sabotaging downstream microservices and disrupting production service delivery.
* **Concrete Drop-In Code Remediation:**
  1. Configure `ReverseProxy` to append standard client IP headers while stripping untrusted forwarded headers from untrusted networks.
  2. Restrict `/chaos/*` routes in `Caddyfile` to loopback or private administrative networks:
  ```caddy
  @internal {
      remote_ip 10.0.0.0/8 172.16.0.0/12 192.168.0.0/16 127.0.0.1/32
  }
  handle /chaos/* {
      @blocked not remote_ip 10.0.0.0/8 172.16.0.0/12 192.168.0.0/16 127.0.0.1/32
      respond @blocked "Access Denied" 403
      reverse_proxy ...
  }
  ```

---

### SEC-07 [MEDIUM]: Plaintext Credential Storage in YAML and In-Memory Structures
* **Affected File & Lines:** `internal/config/config.go:50`, `configs/gateway.yaml:20-31`
* **CWE Classification:** CWE-312 (Cleartext Storage of Sensitive Information), CWE-256 (Unprotected Storage of Credentials)
* **Technical Mechanism of Failure:**  
  API keys are defined as plaintext strings in configuration files (`free-key-001`, `enterprise-key-001`) and loaded into an in-memory `map[string]string`. Authentication checks compare incoming `X-API-Key` headers directly via standard string comparison rather than constant-time cryptographic hash matching.
* **Realistic Exploit / Failure Scenario:**  
  Heap inspection, core dumps, or unauthorized access to configuration files immediately yields all active customer credentials. Furthermore, non-constant-time string lookups in maps may introduce micro-architectural timing side channels.
* **Concrete Drop-In Code Remediation:**
  Store cryptographic hashes (e.g., SHA-256) of API keys in configuration, hash incoming header values, and verify using `subtle.ConstantTimeCompare`:
  ```go
  // In internal/middleware/auth.go:
  import (
      "crypto/sha256"
      "crypto/subtle"
      "encoding/hex"
  )

  func hashKey(key string) string {
      h := sha256.Sum256([]byte(key))
      return hex.EncodeToString(h[:])
  }

  // During lookup:
  incomingHash := hashKey(apiKey)
  var matchedTier string
  for keyHash, tier := range cfg.Auth.HashedAPIKeys {
      if subtle.ConstantTimeCompare([]byte(incomingHash), []byte(keyHash)) == 1 {
          matchedTier = tier
          break
      }
  }
  ```

---

### SEC-08 [LOW]: HTTP Log Injection via Unsanitized `X-Request-ID` Header
* **Affected File & Lines:** `internal/middleware/request_id.go:16-27`, `internal/middleware/logging.go:44-52`
* **CWE Classification:** CWE-117 (Improper Output Handling for Logs)
* **Technical Mechanism of Failure:**  
  In `internal/middleware/request_id.go`:
  ```go
  id := r.Header.Get("X-Request-ID")
  if id == "" { id = generateID() }
  ```
  If provided by the client, `X-Request-ID` is accepted verbatim without validation. In `internal/middleware/logging.go`:
  ```go
  log.Printf("[%s] %s %s %s → %d (%s, %d bytes)", reqID, r.RemoteAddr, r.Method, r.URL.Path, rc.statusCode, latency, rc.written)
  ```
* **Realistic Exploit / Failure Scenario:**  
  An attacker passes an `X-Request-ID` containing carriage return and newline characters (`\r\n`):
  `X-Request-ID: abc\r\n[2026-10-19 12:00:00] 10.0.0.1 GET /admin/config → 200 OK`
  This forges fake log entries into the server console or SIEM ingest pipeline, misleading forensic investigations.
* **Concrete Drop-In Code Remediation:**
  Sanitize client-supplied `X-Request-ID` headers to allow only alphanumeric characters and hyphens (up to 64 bytes); if malformed, discard and generate a fresh ID:
  ```go
  var validIDRegex = regexp.MustCompile(`^[a-zA-Z0-9_\-]{1,64}$`)

  id := r.Header.Get("X-Request-ID")
  if !validIDRegex.MatchString(id) {
      id = generateID()
  }
  ```

---

### SEC-09 [LOW]: Hardcoded Default Credentials & Secrets in Deployment Manifests
* **Affected File & Lines:** `configs/gateway.yaml:28`, `deployments/docker-compose.yaml:92-93`
* **CWE Classification:** CWE-798 (Use of Hard-coded Credentials), CWE-1188 (Insecure Default Initialization of Resource)
* **Technical Mechanism of Failure:**  
  `configs/gateway.yaml` contains `secret: "change-me-in-production"` for JWT signing. `deployments/docker-compose.yaml` provisions Grafana with `GF_SECURITY_ADMIN_USER: admin` and `GF_SECURITY_ADMIN_PASSWORD: admin`.
* **Realistic Exploit / Failure Scenario:**  
  Users deploying the Docker Compose stack without overriding environment variables leave default credentials exposed on port 3000, allowing attackers to access telemetry dashboards and data sources.
* **Concrete Drop-In Code Remediation:**
  Enforce mandatory environment variable substitution in `config.go` and `docker-compose.yaml`:
  ```yaml
  jwt:
    secret: "${GATEWAY_JWT_SECRET:?JWT secret must be specified in environment}"
  ```

---

### SEC-10 [LOW]: Unchecked Entropy Error in Cryptographic Request ID Generation
* **Affected File & Lines:** `internal/middleware/request_id.go:31-36`
* **CWE Classification:** CWE-330 (Use of Insufficiently Random Values)
* **Technical Mechanism of Failure:**  
  In `internal/middleware/request_id.go`:
  ```go
  func generateID() string {
      b := make([]byte, 8)
      rand.Read(b)
      return hex.EncodeToString(b)
  }
  ```
  `crypto/rand.Read(b)` returns `(n int, err error)`. The error return value is discarded.
* **Realistic Exploit / Failure Scenario:**  
  If the host system runs out of file descriptors (exhausting `/dev/urandom` on Linux) or if entropy pool initialization fails, `rand.Read` returns an error and leaves `b` filled with zero bytes. Every subsequent request receives the identical ID `"0000000000000000"`, breaking distributed tracing and logging correlation.
* **Concrete Drop-In Code Remediation:**
  Handle the error explicitly, falling back to a cryptographically secure pseudo-random generator or timestamp-based monotonic counter:
  ```go
  func generateID() string {
      b := make([]byte, 8)
      if _, err := rand.Read(b); err != nil {
          binary.BigEndian.PutUint64(b, uint64(time.Now().UnixNano()))
      }
      return hex.EncodeToString(b)
  }
  ```

---

## 4. Section R2: Concurrency, Race Condition, & Atomicity Verification (CONC-01 to CONC-08)

### CONC-01 [HIGH]: Host Clock Drift & Skew Causing Negative Token Refill in Token Bucket Lua
* **Affected File & Lines:** `internal/ratelimit/lua/token_bucket.lua:25-28`, `internal/ratelimit/token_bucket.go:42`
* **Technical Mechanism of Failure:**  
  In `internal/ratelimit/token_bucket.go`, the gateway reads its local host timestamp and passes it as `ARGV[3]`:
  ```go
  now := time.Now().UnixMicro()
  result, err := tb.script.Run(ctx, cmdable, []string{key}, rate, burst, now).Int64Slice()
  ```
  Inside `token_bucket.lua`:
  ```lua
  local elapsed = now - last_refill  -- microseconds
  local refill = (elapsed / 1000000.0) * rate  -- tokens to add
  tokens = math.min(burst, tokens + refill)
  last_refill = now
  ```
  If Gateway Instance 1 has a clock 50ms ahead of Gateway Instance 2 (common in multi-node clusters under NTP step adjustments), Instance 1 handles a request and writes `last_refill = T + 50,000µs`. When Instance 2 processes a request immediately afterwards with `now = T`, `elapsed` evaluates to `-50,000µs`.
  Consequently:
  `refill = (-50000 / 1000000.0) * rate` produces a **negative refill value**, actively subtracting tokens from the client's bucket without any requests being serviced. Furthermore, `last_refill` is set backwards to `T`.
* **Concrete Drop-In Code Remediation:**
  Retrieve the current time directly from the Redis server's monotonic clock within the Lua script, and ensure `elapsed` is clamped to zero:
  ```lua
  -- In internal/ratelimit/lua/token_bucket.lua:
  local redis_time = redis.call("TIME")
  local now = tonumber(redis_time[1]) * 1000000 + tonumber(redis_time[2])

  local elapsed = now - last_refill
  if elapsed < 0 then
      elapsed = 0
  end
  local refill = (elapsed / 1000000.0) * rate
  tokens = math.min(burst, tokens + refill)
  last_refill = now
  ```

---

### CONC-02 [HIGH]: Division-by-Zero Lua Runtime Crash & Gateway Fail-Open
* **Affected File & Lines:** `internal/ratelimit/lua/token_bucket.lua:34, 39, 41`
* **Technical Mechanism of Failure:**  
  If a rate limit tier is configured or hot-reloaded with `rate: 0` (e.g. to temporarily suspend a compromised client tier), Lua evaluates:
  ```lua
  redis.call("EXPIRE", key, math.ceil(burst / rate) + 1)
  ```
  In Lua, dividing a positive number by 0 evaluates to `inf`. Calling `math.ceil(inf)` produces `inf`. When passed to `redis.call("EXPIRE", key, inf)`, Redis terminates script execution with a runtime error:
  `ERR value is not an integer or out of range`.
  Because `cmd/gateway/main.go` implements fail-open semantics on rate limiter errors (lines 255-258):
  ```go
  if rlErr != nil {
      log.Printf("WARNING: rate limiter error (fail-open): %v", rlErr)
      // allows request through!
  }
  ```
  Setting `rate: 0` crashes the script and causes the gateway to **fail open**, allowing unlimited traffic rather than blocking requests.
* **Concrete Drop-In Code Remediation:**
  Guard against zero rates in both Go and Lua:
  ```lua
  -- In internal/ratelimit/lua/token_bucket.lua:
  local expire_ttl = 3600
  if rate > 0 then
      expire_ttl = math.ceil(burst / rate) + 1
  end
  redis.call("EXPIRE", key, expire_ttl)
  ```

---

### CONC-03 [CRITICAL]: Coarse Nanosecond Timestamp Collision & Member Overwrite Rate Bypass in Sliding Window Log
* **Affected File & Lines:** `internal/ratelimit/sliding_window.go:45`, `internal/ratelimit/lua/sliding_window.lua:25`
* **Technical Mechanism of Failure:**  
  In `internal/ratelimit/sliding_window.go`:
  ```go
  now := time.Now().UnixMicro()
  requestID := fmt.Sprintf("%d:%d", now, time.Now().UnixNano())
  ```
  Inside `sliding_window.lua`:
  ```lua
  if current_count < max_requests then
      redis.call("ZADD", key, now, request_id)
      redis.call("PEXPIRE", key, math.ceil(window_us / 1000))
      return {1, current_count + 1, 0}
  ```
  On Windows or virtualized environments, system clock resolution typically updates at coarse intervals (1ms–15.6ms). Under high concurrency (e.g., 500 concurrent goroutines), multiple requests executing in parallel obtain the exact same `UnixMicro()` and `UnixNano()` values, generating identical `requestID` strings.
  When Redis executes `ZADD key now request_id`, if `request_id` is already a member of the sorted set, Redis merely updates the member's score—**it does not insert a new member**. On subsequent checks, `redis.call("ZCARD", key)` does not increment.
* **Impact:**  
  High-concurrency bursts do not increment the sorted set member count, allowing malicious actors to send massive concurrent request spikes through the sliding window limiter without triggering rate limits.
* **Concrete Drop-In Code Remediation:**
  Incorporate a thread-safe atomic monotonic counter and cryptographically random entropy to ensure absolute member uniqueness in the sorted set:
  ```go
  // In internal/ratelimit/sliding_window.go:
  var globalReqCounter atomic.Uint64

  func (sw *SlidingWindow) Allow(...) {
      now := time.Now().UnixMicro()
      seq := globalReqCounter.Add(1)
      requestID := fmt.Sprintf("%d:%d:%d", now, seq, rand.Uint64())
      // Pass unique requestID to Lua
  ```

---

### CONC-04 [MEDIUM]: Permanent Sorted Set Retention & Redis Memory Leak via Denied Request PEXPIRE
* **Affected File & Lines:** `internal/ratelimit/lua/sliding_window.lua:40`
* **Technical Mechanism of Failure:**  
  In `internal/ratelimit/lua/sliding_window.lua`:
  ```lua
  else
      -- Denied: compute retry-after from oldest entry
      ...
      redis.call("PEXPIRE", key, math.ceil(window_us / 1000))
      return {0, current_count, retry_after_ms}
  end
  ```
  Whenever a request is rejected because the client has exceeded `max_requests`, the script executes `PEXPIRE key window_ms`. This resets the key's TTL to the full window duration from the present moment.
* **Impact:**  
  If a client or bot continuously attacks or polls the gateway while rate-limited, every rejected request pushes the key's expiration timer forward. The sorted set key in Redis **never expires**, retaining all member data and permanently leaking memory.
* **Concrete Drop-In Code Remediation:**
  Only reset key expiration when new elements are inserted, or use `GT` (greater than) to prevent extending TTL beyond the oldest element's expiration:
  ```lua
  -- In sliding_window.lua:
  -- Only refresh TTL when adding new members, or set TTL conditionally
  if current_count < max_requests then
      redis.call("ZADD", key, now, request_id)
      redis.call("PEXPIRE", key, math.ceil(window_us / 1000))
      return {1, current_count + 1, 0}
  else
      -- Do not refresh PEXPIRE on denied requests
      return {0, current_count, retry_after_ms}
  end
  ```

---

### CONC-05 [HIGH]: Decoupled Upstream Selection & Connection Increment Race Condition in `LeastConn`
* **Affected File & Lines:** `cmd/gateway/main.go:282-289`, `internal/loadbalancer/least_conn.go:15-34`
* **Technical Mechanism of Failure:**  
  In `cmd/gateway/main.go`:
  ```go
  upstream, err := bal.Next()
  ...
  upstream.IncrConns()
  defer upstream.DecrConns()
  ```
  In `least_conn.go`:
  ```go
  func (lc *LeastConn) Next() (*Upstream, error) {
      var best *Upstream
      var bestConns int64
      for _, up := range lc.upstreams {
          if !up.IsHealthy() { continue }
          conns := up.ActiveConns()
          if best == nil || conns < bestConns {
              best = up
              bestConns = conns
          }
      }
      return best, nil
  }
  ```
  Upstream selection (`bal.Next()`) and active connection counter increment (`upstream.IncrConns()`) are decoupled into separate, non-atomic operations.
  When 200 concurrent requests invoke `bal.Next()` simultaneously, all 200 observe that upstreams have 0 active connections. Because the loop selects the first upstream on tie (`conns < bestConns`), **all 200 requests select upstream 0**.
* **Impact:**  
  Under concurrent bursts, `LeastConn` degenerates into a thundering herd that routes all traffic to the first upstream in the pool, defeating load distribution.
* **Concrete Drop-In Code Remediation:**
  Perform the connection increment atomically within the load balancer selection routine, returning a cleanup closure:
  ```go
  // In internal/loadbalancer/least_conn.go:
  func (lc *LeastConn) Next() (*Upstream, func(), error) {
      lc.mu.Lock()
      defer lc.mu.Unlock()
      var best *Upstream
      var bestConns int64
      for _, up := range lc.upstreams {
          if !up.IsHealthy() { continue }
          conns := up.ActiveConns()
          if best == nil || conns < bestConns {
              best = up
              bestConns = conns
          }
      }
      if best == nil {
          return nil, nil, ErrNoHealthyUpstream
      }
      best.IncrConns()
      done := func() {
          best.DecrConns()
      }
      return best, done, nil
  }
  ```

---

### CONC-06 [MEDIUM]: Global Mutex Contention Hotspots & Allocation Churn in `PowerOfTwo` and `Weighted` Balancers
* **Affected File & Lines:** `internal/loadbalancer/power_of_two.go:34-44`, `internal/loadbalancer/weighted.go:29-31`
* **Technical Mechanism of Failure:**  
  In `power_of_two.go`:
  ```go
  func (p *PowerOfTwo) Next() (*Upstream, error) {
      p.mu.Lock()
      defer p.mu.Unlock()
      healthy := make([]*Upstream, 0, len(p.upstreams))
      for _, up := range p.upstreams {
          if up.IsHealthy() { healthy = append(healthy, up) }
      }
      ...
  ```
  On every single incoming request:
  1. A coarse `sync.Mutex` is acquired, serializing all concurrent worker goroutines.
  2. A new slice (`make([]*Upstream, 0, len(p.upstreams))`) is allocated on the heap, triggering continuous GC allocation overhead.
  Similarly, `Weighted.Next()` locks a global mutex across the entire smooth round-robin computation.
* **Impact:**  
  The Mitzenmacher power-of-two algorithm is specifically chosen for "O(1) selection with minimal coordination". However, the implementation forces strict lock serialization, bottlenecking gateway throughput under high CPU core counts.
* **Concrete Drop-In Code Remediation:**
  Use lock-free thread-local random selection (via Go 1.22+ `rand.IntN`) and inspect upstreams in-place without dynamic slice allocations:
  ```go
  func (p *PowerOfTwo) Next() (*Upstream, error) {
      n := len(p.upstreams)
      if n == 0 { return nil, ErrNoHealthyUpstream }
      // Pick two distinct indices using lock-free global PRNG
      i := rand.IntN(n)
      j := rand.IntN(n - 1)
      if j >= i { j++ }

      a, b := p.upstreams[i], p.upstreams[j]
      aOk, bOk := a.IsHealthy(), b.IsHealthy()
      if !aOk && !bOk { return nil, ErrNoHealthyUpstream }
      if aOk && !bOk { return a, nil }
      if !aOk && bOk { return b, nil }
      if a.ActiveConns() <= b.ActiveConns() { return a, nil }
      return b, nil
  }
  ```

---

### CONC-07 [HIGH]: Data Race & Concurrent Map Read/Write Crash Risk in `ConfigHolder`
* **Affected File & Lines:** `internal/config/config.go:234-246`, `internal/middleware/auth.go:61, 67`, `cmd/gateway/main.go:223`
* **Technical Mechanism of Failure:**  
  In `internal/config/config.go`:
  ```go
  func (h *ConfigHolder) Get() *GatewayConfig {
      h.mu.RLock()
      defer h.mu.RUnlock()
      return h.cfg
  }

  func (h *ConfigHolder) Swap(cfg *GatewayConfig) {
      h.mu.Lock()
      defer h.mu.Unlock()
      h.cfg = cfg
  }
  ```
  `Get()` acquires an RLock, extracts the pointer `h.cfg`, and immediately unlocks. Calling goroutines in `middleware/auth.go` and `cmd/gateway/main.go` retain this pointer and read nested hash maps (`cfg.Auth.APIKeys[apiKey]`, `cfg.RateLimits[effectiveTier]`) without holding any lock.
  If an administrative goroutine calls `h.Swap()` or mutates configuration fields while requests are processing, Go's runtime race detector detects concurrent map read and map write operations, triggering an immediate panic:
  `fatal error: concurrent map read and map write`.
* **Concrete Drop-In Code Remediation:**
  Use Go's `atomic.Pointer[GatewayConfig]` to guarantee lock-free, atomic pointer swaps, and enforce that swapped configuration structs are completely immutable:
  ```go
  // In internal/config/config.go:
  type ConfigHolder struct {
      ptr atomic.Pointer[GatewayConfig]
  }

  func NewConfigHolder(cfg *GatewayConfig) *ConfigHolder {
      h := &ConfigHolder{}
      h.ptr.Store(cfg)
      return h
  }

  func (h *ConfigHolder) Get() *GatewayConfig {
      return h.ptr.Load()
  }

  func (h *ConfigHolder) Swap(cfg *GatewayConfig) {
      h.ptr.Store(cfg)
  }
  ```

---

### CONC-08 [HIGH]: Redis Connection Pool Starvation Under High Concurrent Worker Load
* **Affected File & Lines:** `configs/gateway.yaml:16`, `cmd/gateway/main.go:43-48`
* **Technical Mechanism of Failure:**  
  `configs/gateway.yaml` configures Redis with:
  ```yaml
  redis:
    addr: "localhost:6379"
    pool_size: 10
  ```
  In load tests with 500 concurrent virtual users (VUs), 500 worker goroutines execute simultaneous rate-limiting checks against Redis. With `pool_size: 10`, only 10 connections exist in the Redis client pool. 490 goroutines are blocked waiting on internal connection pool semaphores.
* **Impact:**  
  This connection starvation directly explains the empirical benchmark anomaly documented in `README.md`, where p99 latency ballooned from 187ms to 537.6ms. The latency increase was not caused by downstream pacing, but by thread contention waiting for Redis pool connections.
* **Concrete Drop-In Code Remediation:**
  Scale `pool_size` proportionally to expected concurrency (e.g. 200–500) and configure connection timeouts:
  ```yaml
  redis:
    addr: "localhost:6379"
    pool_size: 250
    min_idle_conns: 50
    pool_timeout: 4s
  ```


---

## 5. Section R3: Reliability, Circuit Breaker, & Upstream Fault-Tolerance (REL-01 to REL-07)

### REL-01 [CRITICAL]: ReverseProxy Error Swallowing Disables Circuit Breaker & Returns Empty 200 OK
* **Affected File & Lines:** `cmd/gateway/main.go:299-335`
* **Technical Mechanism of Failure:**  
  In `cmd/gateway/main.go`, upstream request forwarding is wrapped inside the circuit breaker's `Execute` closure:
  ```go
  cbErr := cb.Execute(func() error {
      target, parseErr := url.Parse(upstream.URL)
      if parseErr != nil {
          return parseErr
      }

      proxy := &httputil.ReverseProxy{
          Director: func(req *http.Request) { ... },
          ErrorHandler: func(rw http.ResponseWriter, req *http.Request, proxyErr error) {
              log.Printf("proxy error to %s: %v", upstream.ID, proxyErr)
              // Don't write response here — the error will be returned
              // to the circuit breaker's Execute, which handles it
          },
      }

      proxy.ServeHTTP(w, r)
      return nil
  })
  ```
  1. `proxy.ServeHTTP(w, r)` performs the HTTP round-trip. In Go's `net/http/httputil`, `ServeHTTP` has a void return signature (`()`).
  2. When an upstream host is unreachable (connection refused, network timeout, DNS failure), `ReverseProxy` catches the network error and invokes its `ErrorHandler`.
  3. The author included a comment claiming:
     `// Don't write response here — the error will be returned to the circuit breaker's Execute, which handles it`
     However, `proxyErr` is never returned or assigned to an external variable. `ErrorHandler` simply returns.
  4. Execution reaches line 325, executing `return nil`.
  5. `cb.Execute` receives `nil`, calls `cb.onSuccess()`, increments `totalSuccesses`, and resets `consecutiveFails = 0`.
  6. **The circuit breaker registers every single network failure as a SUCCESS**.
  7. Because `ErrorHandler` wrote no response headers, and line 328 (`if cbErr != nil`) evaluates to false, the gateway returns an empty `HTTP 200 OK` with `Content-Length: 0` to the client.
* **Realistic Exploit / Failure Scenario:**  
  An upstream backend crashes or undergoes network partitioning. The gateway continues routing 100% of production traffic to the dead upstream. The circuit breaker never opens. Client applications receive empty 200 OK responses, corrupting client JSON decoders and silently dropping business transactions.
* **Concrete Drop-In Code Remediation:**
  Capture the proxy error and status code, and return them from the closure to `cb.Execute`:
  ```go
  // In cmd/gateway/main.go:
  var proxyErr error
  var statusCode int
  rc := newStatusCaptureWriter(w)

  cbErr := cb.Execute(func() error {
      target, err := url.Parse(upstream.URL)
      if err != nil {
          return err
      }

      proxy := &httputil.ReverseProxy{
          Transport: sharedUpstreamTransport,
          Director: func(req *http.Request) {
              req.URL.Scheme = target.Scheme
              req.URL.Host = target.Host
              req.Host = target.Host
              if matched.StripPrefix {
                  req.URL.Path = strings.TrimPrefix(req.URL.Path, matched.PathPrefix)
                  if !strings.HasPrefix(req.URL.Path, "/") {
                      req.URL.Path = "/" + req.URL.Path
                  }
              }
          },
          ErrorHandler: func(rw http.ResponseWriter, req *http.Request, err error) {
              proxyErr = err
          },
      }

      ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
      defer cancel()

      proxy.ServeHTTP(rc, r.WithContext(ctx))

      if proxyErr != nil {
          return proxyErr
      }
      if rc.statusCode >= 500 {
          return fmt.Errorf("upstream %s returned HTTP %d", upstream.ID, rc.statusCode)
      }
      return nil
  })

  if cbErr != nil {
      w.Header().Set("Content-Type", "application/json")
      if errors.Is(cbErr, breaker.ErrCircuitOpen) {
          w.WriteHeader(http.StatusServiceUnavailable)
          fmt.Fprintf(w, `{"error":"circuit breaker open for upstream %s"}`, upstream.ID)
      } else {
          w.WriteHeader(http.StatusBadGateway)
          fmt.Fprintf(w, `{"error":"upstream proxy failure: %s"}`, cbErr.Error())
      }
      return
  }
  ```

---

### REL-02 [HIGH]: Circuit Breaker Thundering Herd & Unbounded Probe Concurrency in `StateHalfOpen`
* **Affected File & Lines:** `internal/breaker/breaker.go:120-136`
* **Technical Mechanism of Failure:**  
  In `internal/breaker/breaker.go`:
  ```go
  func (cb *CircuitBreaker) Execute(fn func() error) error {
      cb.mu.Lock()
      if cb.state == StateOpen {
          if time.Since(cb.openedAt) >= cb.settings.OpenTimeout {
              cb.transitionTo(StateHalfOpen)
          } else {
              cb.totalRejected++
              cb.mu.Unlock()
              return ErrCircuitOpen
          }
      }
      cb.totalRequests++
      cb.mu.Unlock()
      err := fn()
      ...
  ```
  Once `OpenTimeout` elapses, the first request transitions the state from `StateOpen` to `StateHalfOpen`.
  For all subsequent concurrent requests arriving while in `StateHalfOpen`:
  The condition `if cb.state == StateOpen` is **false**.
  There is no concurrency gate or semaphore. All concurrent requests proceed straight past the lock into `fn()`.
* **Realistic Exploit / Failure Scenario:**  
  An upstream service that previously crashed due to memory exhaustion begins to restart. When `OpenTimeout` (30s) expires, 500 concurrent client requests hit the gateway. Instead of sending a single canary probe to test upstream health, the breaker forwards all 500 requests at once, immediately crashing the recovering upstream again.
* **Concrete Drop-In Code Remediation:**
  Throttle in-flight requests in `StateHalfOpen` to a single probe:
  ```go
  // In internal/breaker/breaker.go:
  type CircuitBreaker struct {
      mu             sync.Mutex
      settings       Settings
      state          State
      consecutiveFails int
      consecutiveOK  int
      openedAt       time.Time
      halfOpenProbes int // In-flight probe counter
      ...
  }

  func (cb *CircuitBreaker) Execute(fn func() error) error {
      cb.mu.Lock()
      if cb.state == StateOpen {
          if time.Since(cb.openedAt) >= cb.settings.OpenTimeout {
              cb.transitionTo(StateHalfOpen)
          } else {
              cb.totalRejected++
              cb.mu.Unlock()
              return ErrCircuitOpen
          }
      }

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

      err := fn()

      cb.mu.Lock()
      defer cb.mu.Unlock()

      if cb.state == StateHalfOpen {
          cb.halfOpenProbes--
      }

      if err != nil {
          cb.onFailure()
          return err
      }
      cb.onSuccess()
      return nil
  }
  ```

---

### REL-03 [MEDIUM]: Fragile Consecutive Failure Counter Masking Partial/Intermittent Outages
* **Affected File & Lines:** `internal/breaker/breaker.go:151-182`
* **Technical Mechanism of Failure:**  
  In `internal/breaker/breaker.go`, `onSuccess()` unconditionally resets `cb.consecutiveFails = 0`:
  ```go
  func (cb *CircuitBreaker) onSuccess() {
      cb.totalSuccesses++
      cb.consecutiveFails = 0
      ...
  }
  ```
  Tripping to `StateOpen` requires strictly `consecutiveFails >= FailureThreshold` (5 consecutive failures).
* **Impact:**  
  If an upstream service suffers severe degradation with an **80% failure rate** (e.g., 4 failures followed by 1 successful response, repeating indefinitely), `consecutiveFails` is repeatedly cleared before reaching 5. The circuit breaker never opens, subjecting 80% of users to failed requests indefinitely.
* **Concrete Drop-In Code Remediation:**
  Implement a rolling window error rate counter (e.g. 10-second sliding window ring buffer) that calculates error percentage alongside consecutive failures:
  ```go
  type RollingWindow struct {
      buckets [10]struct{ success, failure int64 }
      lastRotated time.Time
  }
  // Trip if error rate > 50% over the rolling window when sample size >= 20
  ```

---

### REL-04 [MEDIUM]: Asymmetric Upstream Health Checker Recovery & Flapping
* **Affected File & Lines:** `internal/health/checker.go:124-149`
* **Technical Mechanism of Failure:**  
  In `internal/health/checker.go`:
  ```go
  func (c *Checker) recordFailure(up *loadbalancer.Upstream) {
      c.mu.Lock()
      defer c.mu.Unlock()
      c.failureCounts[up.ID]++
      if c.failureCounts[up.ID] >= c.config.Threshold { // requires 3 consecutive failures
          if up.IsHealthy() { up.SetHealthy(false) }
      }
  }

  func (c *Checker) recordSuccess(up *loadbalancer.Upstream) {
      c.mu.Lock()
      defer c.mu.Unlock()
      c.failureCounts[up.ID] = 0
      if !up.IsHealthy() {
          up.SetHealthy(true) // IMMEDIATELY marks healthy on 1 single success!
      }
  }
  ```
* **Impact:**  
  Marking an upstream unhealthy requires 3 consecutive failed probes (30 seconds at default interval). However, restoring it to the active load balancer pool requires only **1 single successful probe**. An unstable upstream experiencing 80% packet loss flaps back and forth continuously, exposing production traffic to recurrent errors.
* **Concrete Drop-In Code Remediation:**
  Introduce a `SuccessThreshold` (e.g., 3 consecutive successes) before transitioning an unhealthy upstream back to healthy:
  ```go
  type Checker struct {
      ...
      successCounts map[string]int
  }

  func (c *Checker) recordSuccess(up *loadbalancer.Upstream) {
      c.mu.Lock()
      defer c.mu.Unlock()
      c.failureCounts[up.ID] = 0
      c.successCounts[up.ID]++

      if !up.IsHealthy() && c.successCounts[up.ID] >= c.config.Threshold {
          log.Printf("health: upstream %s recovered after %d consecutive successes", up.ID, c.successCounts[up.ID])
          up.SetHealthy(true)
          c.successCounts[up.ID] = 0
      }
  }
  ```

---

### REL-05 [MEDIUM]: Health Probe HTTP Response Body Drain Deficit Destroying TCP Keep-Alive
* **Affected File & Lines:** `internal/health/checker.go:110-115`
* **Technical Mechanism of Failure:**  
  In `internal/health/checker.go`:
  ```go
  resp, err := c.client.Do(req)
  if err != nil {
      c.recordFailure(up)
      return
  }
  resp.Body.Close()
  ```
  `resp.Body.Close()` is called without reading or draining the response body.
  In Go's `net/http` client transport, if the body is not drained to EOF (`io.Copy(io.Discard, resp.Body)`), the underlying TCP socket cannot be returned to the idle connection pool and must be terminated by the OS kernel.
* **Impact:**  
  Every background health check probe tears down and re-negotiates a brand new TCP handshake every 10 seconds per upstream, producing unnecessary connection churn and latency.
* **Concrete Drop-In Code Remediation:**
  Drain the response body before closing:
  ```go
  io.Copy(io.Discard, resp.Body)
  resp.Body.Close()
  ```

---

### REL-06 [HIGH]: Socket Starvation & Ephemeral Port Exhaustion via `MaxIdleConnsPerHost = 2`
* **Affected File & Lines:** `cmd/gateway/main.go:305-322`
* **Technical Mechanism of Failure:**  
  `cmd/gateway/main.go` creates a new `httputil.ReverseProxy` on every incoming request without configuring a custom `Transport`. In Go, when `Transport == nil`, `ReverseProxy` defaults to `http.DefaultTransport`.
  `http.DefaultTransport` specifies:
  ```go
  MaxIdleConns: 100,
  MaxIdleConnsPerHost: 2, // Go standard library default
  ```
  With 500 concurrent virtual users routing to 3 upstream hosts, each upstream host is restricted to maintaining at most **2 idle Keep-Alive sockets**. All remaining 498 active connections are forcefully closed immediately upon request completion.
* **Impact:**  
  Massive TCP socket churn, TIME_WAIT socket accumulation in the operating system network stack, and ephemeral port exhaustion under heavy concurrent load. This was the true underlying cause of the benchmark throughput collapse and p99 latency explosion reported in `README.md`.
* **Concrete Drop-In Code Remediation:**
  Initialize and reuse a shared, properly tuned `*http.Transport`:
  ```go
  // In cmd/gateway/main.go:
  sharedUpstreamTransport := &http.Transport{
      Proxy: http.ProxyFromEnvironment,
      DialContext: (&net.Dialer{
          Timeout:   3 * time.Second,
          KeepAlive: 30 * time.Second,
      }).DialContext,
      MaxIdleConns:        1000,
      MaxIdleConnsPerHost: 200,
      MaxConnsPerHost:     500,
      IdleConnTimeout:     90 * time.Second,
      TLSHandshakeTimeout: 5 * time.Second,
      ForceAttemptHTTP2:   true,
  }
  ```

---

### REL-07 [LOW]: Health Checker Graceful Shutdown Goroutine Leaks & False Failure Recording
* **Affected File & Lines:** `internal/health/checker.go:65-83, 111-112`
* **Technical Mechanism of Failure:**  
  In `internal/health/checker.go`:
  ```go
  func (c *Checker) Stop() {
      if c.cancel != nil {
          c.cancel()
          log.Println("health checker stopped")
      }
  }
  ```
  `Stop()` cancels the root context but does not wait for background check goroutines to terminate (no `sync.WaitGroup`).
  In `probe()`:
  ```go
  resp, err := c.client.Do(req)
  if err != nil {
      c.recordFailure(up)
      return
  }
  ```
  When `ctx` is canceled during gateway shutdown, any probe currently waiting on network I/O returns a context cancellation error (`context canceled`), which is interpreted as a health probe failure, triggering false failure logs during graceful shutdown.
* **Concrete Drop-In Code Remediation:**
  Track goroutines with `sync.WaitGroup` and ignore `ctx.Err()` in `probe`:
  ```go
  // In internal/health/checker.go:
  type Checker struct {
      ...
      wg sync.WaitGroup
  }

  func (c *Checker) Start() {
      ctx, cancel := context.WithCancel(context.Background())
      c.cancel = cancel
      for _, up := range c.upstreams {
          c.wg.Add(1)
          go func(u *loadbalancer.Upstream) {
              defer c.wg.Done()
              c.checkLoop(ctx, u)
          }(up)
      }
  }

  func (c *Checker) Stop() {
      if c.cancel != nil {
          c.cancel()
          c.wg.Wait()
      }
  }

  func (c *Checker) probe(ctx context.Context, up *loadbalancer.Upstream) {
      ...
      resp, err := c.client.Do(req)
      if err != nil {
          if ctx.Err() == nil {
              c.recordFailure(up)
          }
          return
      }
      ...
  }
  ```

---

## 6. Section R4: Architectural Integrity, Idiomatic Go, & Benchmark Validity (ARCH-01 to ARCH-08)

### ARCH-01 [HIGH]: Dead Consistent Hash Ring Key Sharding in Runtime Request Path
* **Affected File & Lines:** `cmd/gateway/main.go:60-62, 237`
* **Technical Mechanism of Failure:**  
  In `cmd/gateway/main.go`:
  ```go
  ring := hashring.NewRing(150)
  ring.AddNode("shard-0")
  log.Printf("hash ring initialized with %d virtual nodes per shard", 150)
  ```
  And inside `buildHandler`:
  ```go
  _ = ring.GetNode(rlKey)
  ```
  `README.md` prominently claims:
  > "...consistent hashing (150 VNodes, <12% deviation) for shard distribution..."
  However, the ring is populated with exactly one shard node (`"shard-0"`). In the request path, the return value of `ring.GetNode(rlKey)` is explicitly discarded with the blank identifier `_ =`. All rate-limiting commands are dispatched to a single Redis client `rdb`.
* **Impact:**  
  The consistent hash ring provides zero runtime utility. The advertised distributed stateful Redis sharding does not exist in practice.
* **Concrete Drop-In Code Remediation:**
  Either maintain a map of Redis client connections sharded across multiple nodes:
  ```go
  targetShard := ring.GetNode(rlKey)
  client := redisClusterNodes[targetShard]
  allowed, retryAfter, rlErr = tokenBucket.Allow(r.Context(), client, rlKey, ...)
  ```
  or update documentation and remove dead sharding operations to eliminate CPU overhead.

---

### ARCH-02 [MEDIUM]: Phantom Configuration Hot-Reload (`PUT /admin/config` Unimplemented, Balancers & Routers Immutable)
* **Affected File & Lines:** `internal/admin/admin.go:4-5, 53-57`, `internal/config/config.go:241-246`
* **Technical Mechanism of Failure:**  
  The doc comment in `internal/admin/admin.go` states:
  `- PUT /admin/config — hot reload config from YAML body`
  However, lines 53-57 only register `GET /admin/config`. There is no handler registered for `PUT /admin/config`.
  Furthermore, `balancers`, `rt`, `healthChecker`, and `breakerReg` are initialized once at server startup. Calling `cfgHolder.Swap()` does not reconfigure upstream pools, load balancer algorithms, or health checks.
* **Impact:**  
  Hot-reload is non-functional. Any operator attempting to send a `PUT` request receives an HTTP 405 Method Not Allowed.
* **Concrete Drop-In Code Remediation:**
  Implement the `PUT /admin/config` handler, validate incoming YAML, swap configuration via `ConfigHolder`, and propagate route and pool updates:
  ```go
  // In internal/admin/admin.go:
  s.mux.HandleFunc("PUT /admin/config", s.handlePutConfig)

  func (s *Server) handlePutConfig(w http.ResponseWriter, r *http.Request) {
      body, err := io.ReadAll(r.Body)
      if err != nil {
          http.Error(w, `{"error":"failed to read body"}`, http.StatusBadRequest)
          return
      }
      newCfg, err := config.ParseYAML(body)
      if err != nil {
          http.Error(w, fmt.Sprintf(`{"error":"invalid config: %s"}`, err.Error()), http.StatusBadRequest)
          return
      }
      s.cfgHolder.Swap(newCfg)
      w.WriteHeader(http.StatusOK)
      fmt.Fprint(w, `{"status":"reloaded"}`)
  }
  ```

---

### ARCH-03 [HIGH]: Compiler Dead-Code Elimination in Microbenchmarks via Discarded Return Values
* **Affected File & Lines:** `internal/loadbalancer/balancer_test.go:272-310`, `internal/router/router_test.go:118-129`, `internal/hashring/hashring_test.go:187-198`
* **Technical Mechanism of Failure:**  
  In `internal/loadbalancer/balancer_test.go`:
  ```go
  func BenchmarkRoundRobin(b *testing.B) {
      ups := makeUpstreams(5)
      rr := NewRoundRobin(ups)
      b.ResetTimer()
      for i := 0; i < b.N; i++ {
          rr.Next() // return value discarded!
      }
  }
  ```
  The return values of `rr.Next()`, `lc.Next()`, `w.Next()`, and `p.Next()` are unassigned.
* **Impact:**  
  Aggressive Go compiler optimizations can detect that return values are unused and have no side effects, potentially optimizing away loop iterations or function calls entirely. This produces artificially low sub-nanosecond execution measurements.
* **Concrete Drop-In Code Remediation:**
  Assign results to package-level sink variables:
  ```go
  var sinkUpstream *Upstream
  var sinkErr error

  func BenchmarkRoundRobin(b *testing.B) {
      ups := makeUpstreams(5)
      rr := NewRoundRobin(ups)
      b.ReportAllocs()
      b.ResetTimer()
      for i := 0; i < b.N; i++ {
          sinkUpstream, sinkErr = rr.Next()
      }
  }
  ```

---

### ARCH-04 [HIGH]: Missing Parallel Microbenchmarks (`b.RunParallel`) Concealing Balancer Mutex Serialization
* **Affected File & Lines:** `internal/loadbalancer/balancer_test.go:272-310`
* **Technical Mechanism of Failure:**  
  All 4 load balancer benchmarks run in a single-threaded loop (`for i := 0; i < b.N`).
  `Weighted` and `PowerOfTwo` rely on `sync.Mutex` internally (`w.mu.Lock()`, `p.mu.Lock()`), whereas `RoundRobin` uses lock-free atomic counters.
  In single-threaded benchmarks, `sync.Mutex` takes the uncontended fast path, hiding synchronization costs.
* **Impact:**  
  The benchmarks falsely suggest that `PowerOfTwo` and `Weighted` achieve comparable throughput to atomic `RoundRobin`. Under parallel workloads (e.g. 500 VUs), mutex lock contention degrades throughput dramatically.
* **Concrete Drop-In Code Remediation:**
  Add parallel benchmark suites to accurately measure multi-core contention:
  ```go
  func BenchmarkWeightedParallel(b *testing.B) {
      ups := makeUpstreams(5)
      w := NewWeighted(ups)
      b.ReportAllocs()
      b.ResetTimer()
      b.RunParallel(func(pb *testing.PB) {
          for pb.Next() {
              u, err := w.Next()
              if err != nil { b.Fatal(err) }
              sinkUpstream = u
          }
      })
  }
  ```

---

### ARCH-05 [MEDIUM]: Memory Allocation Noise & String Formatting Overhead in `BenchmarkGetNode`
* **Affected File & Lines:** `internal/hashring/hashring_test.go:187-198`
* **Technical Mechanism of Failure:**  
  In `internal/hashring/hashring_test.go`:
  ```go
  func BenchmarkGetNode(b *testing.B) {
      r := NewRing(150)
      for i := 0; i < 10; i++ {
          r.AddNode(fmt.Sprintf("node-%d", i))
      }
      b.ResetTimer()
      for i := 0; i < b.N; i++ {
          r.GetNode(fmt.Sprintf("key-%d", i)) // Sprintf inside the benchmark loop!
      }
  }
  ```
  `fmt.Sprintf` allocates memory and parses format strings on every iteration.
* **Impact:**  
  The majority of CPU cycles measured by the benchmark are spent formatting strings rather than executing the binary search across virtual nodes on the hash ring.
* **Concrete Drop-In Code Remediation:**
  Pre-generate keys outside the timer:
  ```go
  var sinkNode string

  func BenchmarkGetNode(b *testing.B) {
      r := NewRing(150)
      for i := 0; i < 10; i++ {
          r.AddNode(fmt.Sprintf("node-%d", i))
      }
      keys := make([]string, 1024)
      for i := range keys {
          keys[i] = fmt.Sprintf("benchmark-key-%d", i)
      }
      b.ReportAllocs()
      b.ResetTimer()
      for i := 0; i < b.N; i++ {
          sinkNode = r.GetNode(keys[i&1023])
      }
  }
  ```

---

### ARCH-06 [LOW]: Non-Portable Hardcoded File System Paths in `cmd/loadtest/main.go`
* **Affected File & Lines:** `cmd/loadtest/main.go:38, 237`
* **Technical Mechanism of Failure:**  
  `cmd/loadtest/main.go` executes external commands using hardcoded absolute Windows paths:
  ```go
  gwCmd := exec.Command("d:\\rate\\bin\\gateway.exe", "-config", "configs/gateway.yaml")
  cmd := exec.Command("d:\\rate\\bin\\mockservice.exe")
  ```
* **Impact:**  
  The load test tool fails immediately when executed on Linux, macOS, or any Windows system where the repository is cloned outside `d:\rate\bin\`.
* **Concrete Drop-In Code Remediation:**
  Use relative paths or `exec.LookPath`:
  ```go
  gwPath := filepath.Join(".", "bin", "gateway")
  gwCmd := exec.Command(gwPath, "-config", "configs/gateway.yaml")
  ```

---

### ARCH-07 [LOW]: Root Execution of Gateway Binary in Production Docker Container
* **Affected File & Lines:** `Dockerfile:21-32`
* **Technical Mechanism of Failure:**  
  In `Dockerfile`:
  ```dockerfile
  FROM alpine:3.19
  RUN apk --no-cache add ca-certificates
  COPY --from=builder /gateway /gateway
  COPY configs/gateway.yaml /configs/gateway.yaml
  COPY --from=frontend-builder /app/web/dashboard/dist /web/dashboard/dist
  EXPOSE 8080 9091
  ENTRYPOINT ["/gateway"]
  ```
  The runtime image omits a `USER` instruction, causing `/gateway` to run as root (`UID 0`).
* **Impact:**  
  Violates the principle of least privilege. In the event of a container breakout or remote code execution vulnerability, the process possesses full root capabilities within the container namespace.
* **Concrete Drop-In Code Remediation:**
  Create and switch to an unprivileged system user:
  ```dockerfile
  RUN addgroup -S gateway && adduser -S gateway -G gateway
  USER gateway
  ```

---

### ARCH-08 [MEDIUM]: Path Prefix Stripping Generating Malformed Unrooted Relative Paths & IPv6 Host Truncation
* **Affected File & Lines:** `cmd/gateway/main.go:310-315`, `internal/router/router.go:66-72`
* **Technical Mechanism of Failure:**  
  1. In `cmd/gateway/main.go`:
     ```go
     if matched.StripPrefix {
         req.URL.Path = strings.TrimPrefix(req.URL.Path, matched.PathPrefix)
         if req.URL.Path == "" {
             req.URL.Path = "/"
         }
     }
     ```
     If `PathPrefix` is `/api/v1` and a client requests `/api/v1orders`, `strings.TrimPrefix` strips the prefix and sets `req.URL.Path = "orders"`. Because the path lacks a leading slash, the downstream upstream server receives a malformed HTTP request line (`GET orders HTTP/1.1`) resulting in an immediate 400 Bad Request error.
  2. In `internal/router/router.go`:
     ```go
     reqHost := host
     if idx := strings.Index(reqHost, ":"); idx != -1 {
         reqHost = reqHost[:idx]
     }
     ```
     For IPv6 host headers such as `[::1]:8080`, `strings.Index` matches the first colon between brackets, truncating `reqHost` to `[`.
* **Concrete Drop-In Code Remediation:**
  1. Ensure the stripped path always begins with `/`:
     ```go
     if matched.StripPrefix {
         req.URL.Path = strings.TrimPrefix(req.URL.Path, matched.PathPrefix)
         if !strings.HasPrefix(req.URL.Path, "/") {
             req.URL.Path = "/" + req.URL.Path
         }
     }
     ```
  2. Use `net.SplitHostPort` for host header parsing:
     ```go
     reqHost, _, err := net.SplitHostPort(host)
     if err != nil {
         reqHost = host
     }
     ```

---

## 7. Section R5: Test Coverage Gap Analysis & Recommended Test Suite

### 7.1. Component Test Coverage Matrix

The repository exhibits an extreme test coverage vacuum. Out of 14 components and subpackages, **10 have 0% test coverage**:

| Component / Package | Source Files | Test Files | Estimated Test Coverage | Critical Untested Logic |
|---|---|---|:---:|---|
| **Rate Limiter (Token Bucket)** | `internal/ratelimit/token_bucket.go` | **None** | **0%** | Redis hash mutation, token refills, burst capacity, retry-after calculations. |
| **Rate Limiter (Sliding Window)** | `internal/ratelimit/sliding_window.go` | **None** | **0%** | Redis ZSET member insertion, boundary-window pruning, timestamp collision handling. |
| **Redis Lua Scripts** | `internal/ratelimit/lua/*.lua` | **None** | **0%** | Atomic execution, negative refill prevention, zero-rate division-by-zero, TTL expiration. |
| **Active Health Checker** | `internal/health/checker.go` | **None** | **0%** | Background probe loops, consecutive failure/success thresholds, graceful stop context. |
| **Auth Middleware** | `internal/middleware/auth.go` | **None** | **0%** | API key extraction, tier assignment, 401 unauthorized rejection, JWT validation. |
| **Metrics Middleware** | `internal/middleware/metrics.go` | **None** | **0%** | Label assignment, Prometheus counter and duration histogram recording. |
| **Logging & Request ID** | `internal/middleware/logging.go`, `request_id.go` | **None** | **0%** | ResponseWriter status capture, UUID generation, `X-Request-ID` propagation. |
| **Admin API Server** | `internal/admin/admin.go` | **None** | **0%** | `/admin/config` serialization, `/admin/health`, upstream status and breaker queries. |
| **Config Loader & Holder** | `internal/config/config.go` | **None** | **0%** | YAML parsing, validation constraints, thread-safe config swap concurrency. |
| **Gateway Main Handler** | `cmd/gateway/main.go` | **None** | **0%** | End-to-end request pipeline: auth → rate limit → route → load balance → breaker → proxy. |
| **Circuit Breaker** | `internal/breaker/breaker.go` | `breaker_test.go` | ~75% | Covered: basic transitions. Untested: half-open probe concurrency, error rate rolling windows. |
| **Load Balancers** | `internal/loadbalancer/*.go` | `balancer_test.go` | ~85% | Covered: basic algorithms. Untested: parallel race conditions, connection increment coupling. |
| **Consistent Hash Ring** | `internal/hashring/hashring.go` | `hashring_test.go` | ~80% | Covered: virtual nodes, node addition. Untested: live Redis shard routing. |
| **Router** | `internal/router/router.go` | `router_test.go` | ~90% | Covered: prefix and host matching. Untested: IPv6 hosts, prefix stripping slash bugs. |

---

### 7.2. Comprehensive Test Design Plan

To remediate this coverage vacuum, the following structured unit, integration, and concurrency race test cases must be implemented:

```
                                  Test Suite Architecture
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                                   Unit Test Layer                                      │
│  - TestTokenBucket_Refill_MonotonicClock        - TestSlidingWindow_HighConcurrency    │
│  - TestTokenBucket_ZeroRate_NoCrash             - TestHealthChecker_FlappingRecovery   │
│  - TestAuthMiddleware_ValidAndInvalidKeys       - TestMetrics_PathNormalization        │
│  - TestConfigHolder_ConcurrentSwapGet           - TestRouter_IPv6HostMatching          │
├────────────────────────────────────────────────────────────────────────────────────────┤
│                                Integration Test Layer                                  │
│  - TestGatewayPipeline_EndToEndSuccess          - TestCircuitBreaker_TripsOnProxyError │
│  - TestRateLimit_TierEnforcementWithRedis       - TestAdminAPI_RedactedConfig          │
├────────────────────────────────────────────────────────────────────────────────────────┤
│                                Concurrency & Race Layer                                │
│  - TestLeastConn_ParallelBurstNoHerding (-race) - TestTokenBucket_ClockSkewSimulation  │
│  - TestCircuitBreaker_HalfOpenThunderingHerd    - TestSlidingWindow_TimestampCollision │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

#### Detailed Test Case Specifications:

1. **`TestTokenBucket_ClockSkewSimulation` (`internal/ratelimit`)**:
   - **Scenario**: Simulate two gateway instances where Instance 1 writes `last_refill = T + 100ms`, followed immediately by Instance 2 calling `Allow()` with `T`.
   - **Assertion**: Bucket tokens must not decrease below current remaining tokens; `refill` must not evaluate to a negative value.
2. **`TestTokenBucket_ZeroRate_NoCrash` (`internal/ratelimit`)**:
   - **Scenario**: Call `Allow()` with `rate: 0, burst: 10`.
   - **Assertion**: Script must not abort with Redis runtime error; request must be rejected cleanly with retry-after calculation.
3. **`TestSlidingWindow_ConcurrentBurstCollisions` (`internal/ratelimit`)**:
   - **Scenario**: Launch 200 concurrent goroutines executing `slidingWindow.Allow` with `maxRequests: 50`.
   - **Assertion**: Exactly 50 requests must be allowed; 150 must be denied. Verify Redis ZSET cardinality equals 50.
4. **`TestCircuitBreaker_TripsOnUpstreamProxyFailure` (`cmd/gateway`)**:
   - **Scenario**: Direct gateway traffic to an offline upstream (`http://localhost:9999`). Send 5 consecutive requests.
   - **Assertion**: 5th request must trip breaker to `StateOpen`. Subsequent requests must immediately return HTTP 503 `{"error":"circuit breaker open"}` without attempting network dial.
5. **`TestCircuitBreaker_HalfOpenSingleProbeThrottling` (`internal/breaker`)**:
   - **Scenario**: Trip breaker to `StateOpen`, advance clock past `OpenTimeout`, and fire 100 concurrent requests into `cb.Execute`.
   - **Assertion**: Exactly 1 request must execute `fn()`; 99 requests must immediately return `ErrCircuitOpen`.
6. **`TestHealthChecker_HysteresisRecovery` (`internal/health`)**:
   - **Scenario**: Mock upstream returns 3 consecutive 500 errors (marking unhealthy), then returns 1 successful 200 OK.
   - **Assertion**: Upstream must remain `UNHEALTHY` until configured consecutive success threshold (e.g., 2 or 3) is reached.
7. **`TestConfigHolder_RaceDetector` (`internal/config`)**:
   - **Scenario**: Run 50 worker goroutines calling `h.Get()` and accessing maps, while 10 goroutines call `h.Swap(newCfg)`.
   - **Assertion**: Zero data race warnings with `go test -race`.
8. **`TestAuth_RouteEnforcement` (`internal/middleware`)**:
   - **Scenario**: Route configured with `auth_required: true`. Anonymous request (missing `X-API-Key`) sent.
   - **Assertion**: Gateway must respond with HTTP 401 Unauthorized; request must not reach upstream.

---

## 8. Section R6: Production Hardening Roadmap

To systematically resolve all identified defects, remediation should be executed across three sequential phases:

```
┌────────────────────────────────────────────────────────────────────────┐
│                   PHASE 1: Immediate Critical Hotfixes                  │
│                        (Target: Days 1 – 3)                            │
│  - Fix REL-01: Bubble ReverseProxy errors into cb.Execute              │
│  - Fix SEC-01 & SEC-02: Authenticate /admin/*, redact credentials,     │
│    restrict CORS origins                                               │
│  - Fix SEC-03: Move /metrics, normalize path label to route prefix     │
│  - Fix CONC-03: Atomic monotonic request ID in sliding window log     │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
┌───────────────────────────────────▼────────────────────────────────────┐
│         PHASE 2: High-Priority Concurrency & Reliability Hardening     │
│                        (Target: Weeks 1 – 2)                           │
│  - Fix REL-02: Throttle StateHalfOpen to 1 concurrent probe            │
│  - Fix CONC-01 & CONC-02: Use Redis TIME, prevent zero-rate crashes   │
│  - Fix CONC-05: Atomic selection + connection increment in LeastConn   │
│  - Fix CONC-07: Atomic.Pointer in ConfigHolder                         │
│  - Fix REL-06 & CONC-08: Tune Transport connection pools & Redis pool  │
│  - Fix REL-04 & REL-05: Health checker hysteresis & body drain         │
│  - Fix SEC-04 & SEC-05: Strip RemoteAddr port, route auth enforcement  │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
┌───────────────────────────────────▼────────────────────────────────────┐
│      PHASE 3: Architecture, Benchmarking & Test Suite Expansion        │
│                        (Target: Weeks 3 – 4)                           │
│  - Implement ARCH-01: Operational Redis cluster sharding via ring      │
│  - Implement ARCH-02: Live PUT /admin/config hot-reload                │
│  - Fix ARCH-03 to ARCH-05: Benchmark return sinks, b.RunParallel,     │
│    pre-allocated hashring keys                                         │
│  - Implement 0% coverage test suite across all 10 components           │
│  - Fix ARCH-07 & ARCH-08: Non-root Docker, prefix slash, IPv6 hosts    │
└────────────────────────────────────────────────────────────────────────┘
```

### Phase 1: Immediate Critical Hotfixes (Milestone 1 — Days 1 to 3)
* **Objective:** Eliminate catastrophic credential exfiltration, restore core circuit breaker protection, and prevent OOM crashes.
* **Deliverables:**
  1. Patch `cmd/gateway/main.go` to capture `httputil.ReverseProxy` errors and upstream 5xx status codes, returning them directly into `cb.Execute` (**REL-01**).
  2. Implement `SanitizedConfig` DTO and Bearer token authentication on `/admin/config` (**SEC-01**).
  3. Restrict `Access-Control-Allow-Origin` on the admin server to trusted domains (**SEC-02**).
  4. Normalize Prometheus path labels using route prefixes and protect `/metrics` (**SEC-03**).
  5. Add atomic sequential IDs and random entropy to sliding window request member keys (**CONC-03**).

### Phase 2: High-Priority Concurrency & Reliability Hardening (Milestone 2 — Weeks 1 to 2)
* **Objective:** Ensure deterministic rate limiting, prevent cascading failover, and eliminate high-concurrency connection bottlenecks.
* **Deliverables:**
  1. Restrict `StateHalfOpen` concurrency to 1 probe request in `internal/breaker/breaker.go` (**REL-02**).
  2. Migrate `token_bucket.lua` and `sliding_window.lua` to `redis.call("TIME")` and guard division operations against zero rates (**CONC-01**, **CONC-02**).
  3. Couple upstream selection and active connection counter increments atomically in `LeastConn` (**CONC-05**).
  4. Replace `ConfigHolder` RWMutex with `atomic.Pointer[GatewayConfig]` (**CONC-07**).
  5. Provision shared `http.Transport` with `MaxIdleConnsPerHost: 200` and increase Redis `pool_size: 250` (**REL-06**, **CONC-08**).
  6. Enforce consecutive success threshold in health checker and drain HTTP response bodies (**REL-04**, **REL-05**).
  7. Strip ephemeral ports using `net.SplitHostPort` and enforce route-level authentication (**SEC-04**, **SEC-05**).

### Phase 3: Architectural Integrity, Testing & Benchmarking Expansion (Milestone 3 — Weeks 3 to 4)
* **Objective:** Achieve 90%+ test coverage, validate benchmarks under multi-core parallelism, and complete operational productionization.
* **Deliverables:**
  1. Operationalize consistent hash ring across multi-node Redis clusters or remove inert code (**ARCH-01**).
  2. Complete `PUT /admin/config` hot-reload handling across routing tables and balancers (**ARCH-02**).
  3. Implement sink variables, `b.ReportAllocs()`, and `b.RunParallel` across microbenchmarks (**ARCH-03**, **ARCH-04**, **ARCH-05**).
  4. Author complete unit and integration test suites covering the 10 untested packages.
  5. Adopt unprivileged container user execution in `Dockerfile` (**ARCH-07**) and fix prefix stripping leading slashes and IPv6 host parsing (**ARCH-08**).

---

## 9. Conclusion

Flux-GO exhibits a well-conceived architectural foundation that unifies rate limiting, circuit breaking, and load balancing under clean Go abstractions. However, as demonstrated by this comprehensive audit, critical implementation gaps—specifically error suppression in the reverse proxy, unauthenticated administrative credential exposure, Redis Lua clock skew and collision vulnerabilities, and connection pool starvation—prevent the system from functioning reliably or securely in its current state.

By executing the prioritized remediations outlined in the Production Hardening Roadmap, the engineering team can transition Flux-GO from an experimental prototype into a resilient, enterprise-grade distributed API gateway capable of withstanding production traffic and adversarial conditions.
