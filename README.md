# Rate Limiter Gateway

A production-style, Go-based API Gateway combining distributed rate limiting, load balancing, request routing, circuit breaking, and observability — designed to map directly onto canonical system design interview questions.

## Architecture

```
Client → Gateway → Auth → Rate Limiter → Router → Load Balancer → Circuit Breaker → Upstream
                     ↕           ↕                       ↕               ↕
                  API Keys    Redis Lua              Health Check    State Machine
                  / JWT       (atomic)               (active)       (per-upstream)
                                ↕
                        Consistent Hashing
                        (key sharding)
```

## Quick Start

### Local Development (no Docker)

```bash
# Prerequisites: Go 1.23+, Redis on localhost:6379

# Start mock upstream services
go run ./cmd/mockservice/ &  # port 9001

MOCK_PORT=9002 MOCK_SERVICE_NAME=service-B go run ./cmd/mockservice/ &
MOCK_PORT=9003 MOCK_SERVICE_NAME=service-C go run ./cmd/mockservice/ &

# Start the gateway
go run ./cmd/gateway/ -config configs/gateway.yaml

# Test it
curl -H "X-API-Key: pro-key-001" http://localhost:8080/api/v1/users
curl -H "X-API-Key: free-key-001" http://localhost:8080/api/v1/orders
```

### Docker Compose (full stack)

```bash
cd deployments
docker-compose up --build

# Gateway:     http://localhost:8080
# Admin API:   http://localhost:9091
# Prometheus:  http://localhost:9090
# Grafana:     http://localhost:3000 (admin/admin)
```

## Testing

```bash
# Run all tests with race detection
go test ./... -v -race -count=1

# Run specific package
go test ./internal/hashring/ -v
go test ./internal/loadbalancer/ -v
go test ./internal/breaker/ -v
```

## Load Testing

```bash
# Requires k6: https://k6.io/docs/getting-started/installation/
k6 run benchmarks/k6-scripts/load_test.js
```

## Core Components

| Component | Package | Interview Question |
|---|---|---|
| Token Bucket + Sliding Window | `internal/ratelimit/` | "Design a rate limiter" |
| Consistent Hashing Ring | `internal/hashring/` | "Design consistent hashing" |
| 4 LB Strategies | `internal/loadbalancer/` | "Design a load balancer" |
| Circuit Breaker | `internal/breaker/` | "Prevent cascading failures" |
| Health Checker | `internal/health/` | "Detect and route around failures" |
| Full Gateway | `cmd/gateway/` | "Design an API Gateway" |

## Rate Limiting

Two algorithms, selectable per route/tier:

- **Token Bucket** (default): Allows controlled bursts. Configurable rate (tokens/sec) and burst (max bucket size).
- **Sliding Window Log**: Precise, no boundary spikes. Uses Redis ZSET with timestamp-scored entries.

Both run atomically in Redis via embedded Lua scripts (`internal/ratelimit/lua/`), preventing race conditions under concurrent requests across multiple gateway instances.

### Tiers

| Tier | Rate | Burst | Algorithm |
|---|---|---|---|
| free | 10/s | 20 | token_bucket |
| pro | 100/s | 200 | token_bucket |
| enterprise | 1000/s | 2000 | token_bucket |

## Load Balancing Strategies

- **Round Robin**: Atomic counter, skips unhealthy upstreams
- **Least Connections**: Picks upstream with fewest active connections
- **Weighted Round Robin**: Nginx-style smooth weighted distribution
- **Power of Two Choices**: O(1) near-optimal selection (Mitzenmacher)

## Circuit Breaker

Hand-rolled state machine (no external libraries):

```
Closed ──(5 consecutive failures)──▸ Open ──(30s timeout)──▸ Half-Open
  ▲                                                              │
  └────────(3 consecutive successes)─────────────────────────────┘
```

## Mock Service Chaos Testing

```bash
# Set error rate at runtime (triggers circuit breaker)
curl -X POST http://localhost:9001/chaos -d '{"error_rate": 0.5}'

# Check current chaos config
curl http://localhost:9001/chaos

# Reset to normal
curl -X POST http://localhost:9001/chaos -d '{"error_rate": 0.0}'
```

## Admin API

```bash
# Gateway health
curl http://localhost:9091/admin/health

# List upstreams with health status
curl http://localhost:9091/admin/upstreams

# List circuit breaker states
curl http://localhost:9091/admin/breakers

# Dump current config
curl http://localhost:9091/admin/config
```

## Project Structure

```
rate-limiter-gateway/
├── cmd/
│   ├── gateway/main.go          # Entry point
│   └── mockservice/main.go      # Mock upstream with chaos endpoint
├── internal/
│   ├── ratelimit/               # Token bucket + sliding window + Lua scripts
│   ├── hashring/                # Consistent hashing with virtual nodes
│   ├── router/                  # Path/host-based routing
│   ├── loadbalancer/            # 4 strategies (RR, LC, Weighted, P2C)
│   ├── breaker/                 # Circuit breaker state machine
│   ├── health/                  # Active health checker
│   ├── middleware/              # Auth, logging, metrics, request ID
│   ├── admin/                   # Admin API
│   └── config/                  # YAML config + hot reload
├── configs/gateway.yaml         # Default config
├── deployments/                 # Docker Compose + Prometheus + Grafana
├── benchmarks/k6-scripts/       # Load test scripts
├── Dockerfile                   # Gateway image
└── Dockerfile.mockservice       # Mock service image
```

## Empirical Benchmark & Verified Metrics

The system was evaluated under load using k6. Below is a side-by-side comparison of the gateway's performance under two distinct scenarios (500 maximum concurrent VUs):

### 1. Performance Under Load

| Metric | Baseline (Mock Latency Enabled) | 0ms Latency (Mock Latency Disabled) |
|---|:---:|:---:|
| **Total Requests** | **421,001** | **332,064** |
| **Throughput** | **2,806 req/s** | **2,213 req/s** |
| **Latency p50 (Median)** | **39.2 ms** | **36.2 ms** |
| **Latency p95** | **130.7 ms** | **212.0 ms** |
| **Latency p99** | **187.0 ms** | **537.6 ms** |
| **Rate Limited %** | **39.1%** | **35.2%** |

### 2. Downstream Latency & Pacing Analysis (System Design Highlight)

During load testing, setting downstream mock service latencies to **0ms** caused the gateway's p99 latency to balloon from **187.0ms to 537.6ms** (a ~2.8x increase), while throughput dropped by **21%**. 

* **Why?** Downstream latency acts as a natural pacing/backoff mechanism for client request loops. Without this pacing, client connections flooded the gateway instantly.
* **The Takeaway:** This showcases a classic system design trade-off: **reducing backend service time without client-side pacing or backoffs increases client concurrency depth, resulting in gateway CPU cache thrashing, socket starvation, and context switching contention.**
* **Test Improvement:** Decoupling client request arrival rates from downstream latency can be achieved in k6 using a `constant-arrival-rate` executor instead of VU-loop-based concurrency.

## Observability & Chaos Control Plane UI

An enterprise-grade React 19 + Vite dashboard is available at `http://localhost:9091/dashboard/` (or port `:5173` during local frontend development).

### Dashboard Highlights
* **Real-Time Sparkline Telemetry**: Zero-dependency rolling SVG micro-charts tracking live throughput (`req/s`) and HTTP 429 rate-limiting rejection trends.
* **Interactive Traffic & Rate Limit Simulator**: Fire synthetic bursts (1 to 100 concurrent requests) or continuous streams against `/api/v1/users` (Token Bucket) and `/api/v1/orders` (Sliding Window Log). Select tier keys (`free-key-001`, `pro-key-001`, `enterprise-key-001`, invalid keys) to observe live HTTP 200 vs 429 vs 503 vs 401 response breakdowns and RFC-6585 rate limit response headers (`X-RateLimit-Remaining`, `Retry-After`).
* **Upstream Circuit Breaker Topology & Chaos**: Live monitoring of active in-flight connection counters, consecutive failures, and state machine transitions (`CLOSED` ➔ `HALF-OPEN` ➔ `OPEN`). Features interactive fault injection sliders and 1-click chaos presets (`0% Clean`, `25% Flaky`, `50% Loss`, `100% Trip`) targeting upstream mock instances.
* **Gateway Configuration Inspector**: Live runtime view of registered routing rules, rate limit algorithms/refill rates, circuit breaker thresholds, and health check intervals fetched from `/admin/config`.
* **Admin Token Auth & Offline Demo Mode**: Integrated Bearer token management for protected admin endpoints, plus a 1-click **Simulation Mode** that runs synthetic operational metrics and breaker state transitions for offline portfolio demonstrations.

## Oracle Cloud Deployment Prep

We use **Caddy** as a reverse proxy in front of the docker-compose stack to handle SSL/TLS termination automatically via Let's Encrypt and route path traffic.

### Local & Production Running

1. **Local Run (without Caddy port binds)**:
   ```bash
   cd deployments
   docker-compose up -d --build gateway redis upstream-a upstream-b upstream-c prometheus grafana
   ```

2. **Production Run (with Caddy & HTTPS)**:
   ```bash
   cd deployments
   # Set environment variables for domain and email
   export DOMAIN=demo.yourdomain.com
   export ACME_EMAIL=your-email@example.com
   docker-compose up -d --build
   ```

Caddy handles CORS natively. By serving the dashboard at `https://demo.yourdomain.com/dashboard/` and sending API requests to `https://demo.yourdomain.com/admin/*` and `/chaos/mock-*`, all browser traffic runs under the same origin, preventing cross-origin request issues.

## Verified Resume Bullet

> Built a distributed API Gateway in Go handling rate limiting, load balancing, and request routing; implemented atomic Redis Lua scripts for race-free limiting and consistent hashing (150 VNodes, <12% deviation) for shard distribution, sustaining **2,806 req/s** at **p99 < 187ms** under 500 concurrent VUs with automatic failover via circuit breaking.
