# Flux-GO | Distributed API Gateway & Resilience Engine

<div align="center">

```
  ███████╗██╗     ██╗   ██╗██╗  ██╗       ██████╗  ██████╗ 
  ██╔════╝██║     ██║   ██║╚██╗██╔╝      ██╔════╝ ██╔═══██╗
  █████╗  ██║     ██║   ██║ ╚███╔╝ █████╗██║  ███╗██║   ██║
  ██╔══╝  ██║     ██║   ██║ ██╔██╗ ╚════╝██║   ██║██║   ██║
  ██║     ███████╗╚██████╔╝██╔╝ ██╗      ╚██████╔╝╚██████╔╝
  ╚═╝     ╚══════╝ ╚═════╝ ╚═╝  ╚═╝       ╚═════╝  ╚═════╝ 
```

**Sub-millisecond, distributed API Gateway, Rate Limiting Engine, and Observability Control Plane engineered in Go.**

[![Go Version](https://img.shields.io/badge/Go-1.23%2B-00ADD8?style=for-the-badge&logo=go)](https://golang.org)
[![React Version](https://img.shields.io/badge/React-19-61DAFB?style=for-the-badge&logo=react)](https://react.dev)
[![Redis Engine](https://img.shields.io/badge/Redis-Lua%20Atomic-DC382D?style=for-the-badge&logo=redis)](https://redis.io)
[![Test Coverage](https://img.shields.io/badge/Tests-100%25%20Passing-success?style=for-the-badge&logo=githubactions)](https://github.com/ANSUJKMEHER/Flux)
[![Race Detector](https://img.shields.io/badge/Race%20Detector-Clean-success?style=for-the-badge)](https://golang.org/doc/articles/race_detector)
[![License](https://img.shields.io/badge/License-MIT-blue?style=for-the-badge)](LICENSE)

[Architecture](#-system-architecture) •
[Core Algorithms](#-core-algorithmic-implementations) •
[Control Plane UI](#-observability--chaos-control-plane) •
[Benchmarks](#-empirical-benchmarks--system-design-analysis) •
[Quickstart](#-quickstart-guide) •
[API Reference](#-api--admin-reference)

---

</div>

## 📌 Executive Summary

**Flux-GO** is an enterprise-grade distributed API Gateway designed from first principles to address high-throughput edge challenges: distributed rate limiting, intelligent traffic load balancing, active health monitoring, and cascading-failure prevention.

Built to mirror production architectures at hyperscale (Cloudflare, Stripe, Envoy), Flux-GO combines:
* **Zero-Allocation Distributed Rate Limiting** running atomic Redis Lua scripts (Token Bucket & Sliding Window Log).
* **Virtual Node Consistent Hashing** guaranteeing $O(\log V)$ key routing with $<12\%$ load variance and minimal remapping.
* **4 Load Balancing Algorithms** including Nginx-style Smooth Weighted Round Robin and Mitzenmacher's Power of Two Choices ($P2C$).
* **Hand-Rolled Circuit Breaker State Machine** protecting upstreams without heavy third-party dependencies.
* **Lock-Free Configuration Hot-Reloading** with zero dropped in-flight HTTP connections.
* **Full-Stack Observability & Chaos Control Plane**: A React 19 + Vite dashboard featuring real-time SVG sparklines, live traffic burst generators, RFC-6585 header inspectors, and upstream chaos fault injection.

---

## 🏗 System Architecture

Flux-GO sits at the edge of your microservice mesh, intercepting all inbound requests and routing them through a high-performance concurrent pipeline:

```
                                [ Inbound Client Traffic ]
                                            │
                                            ▼
                          ┌───────────────────────────────────┐
                          │   Caddy Edge Proxy (HTTPS / SSL)   │
                          └─────────────────┬─────────────────┘
                                            │
                                            ▼
        ┌────────────────────────────────────────────────────────────────────────┐
        │                         FLUX-GO GATEWAY ENGINE                         │
        │                                                                        │
        │  ┌────────────────────────┐         ┌───────────────────────────────┐  │
        │  │ Security & Auth Guard  │         │  Admin Control Plane (:9091)  │  │
        │  │ • API Key Validation   │         │  • Bearer Token Auth          │  │
        │  │ • Bearer JWT Claims    │         │  • Config Hot-Reload          │  │
        │  │ • Path Normalization   │         │  • Telemetry & Breaker Stats  │  │
        │  │ • Request ID / Tracing │         │  • Static React Dashboard     │  │
        │  └───────────┬────────────┘         └───────────────┬───────────────┘  │
        │              ▼                                      │                  │
        │  ┌───────────────────────────────────────────────┐  │                  │
        │  │      Distributed Rate Limiting Engine         │  │                  │
        │  │  • Token Bucket (Refill rate / burst capacity)│  │                  │
        │  │  • Sliding Window Log (Sub-ms timestamp ZSET) │  │                  │
        │  │  • Redis Cluster / Consistent Hash Key Shard  │  │                  │
        │  └───────────────────────┬───────────────────────┘  │                  │
        │                          ▼                          │                  │
        │  ┌───────────────────────────────────────────────┐  │                  │
        │  │             Dynamic Route Matcher             │  │                  │
        │  │  • Prefix Matching & Path Stripping           │  │                  │
        │  │  • Tier Overrides & Algorithm Selection       │  │                  │
        │  └───────────────────────┬───────────────────────┘  │                  │
        │                          ▼                          │                  │
        │  ┌───────────────────────────────────────────────┐  │                  │
        │  │       Load Balancing & Resilience Layer       │  │                  │
        │  │  • Round Robin | Least Connections            │  │                  │
        │  │  • Smooth Weighted RR | Power-of-Two (P2C)    │  │                  │
        │  │  • Circuit Breaker FSM (Closed/Half-Open/Open)│  │                  │
        │  └───────────────────────┬───────────────────────┘  │                  │
        │                          │                          │                  │
        │  ┌───────────────────────┴───────────────────────┐  │                  │
        │  │       Active Upstream Health Checker          │  │                  │
        │  │  • Interval Probing & Hysteresis Transitions  │  │                  │
        │  └───────────────────────┬───────────────────────┘  │                  │
        └──────────────────────────┼──────────────────────────┼──────────────────┘
                                   │                          │
                                   ▼                          ▼
                   ┌──────────────────────────────┐    ┌──────────────┐
                   │    Upstream Service Mesh     │    │  Redis Ring  │
                   │  ┌────────┐      ┌────────┐  │    │  (Atomic Lua │
                   │  │ Users  │      │ Orders │  │    │   Execution) │
                   │  └────────┘      └────────┘  │    └──────────────┘
                   │  ┌────────┐      ┌────────┐  │
                   │  │Products│      │ Mock A │  │
                   │  └────────┘      └────────┘  │
                   └──────────────────────────────┘
```

---

## ⚡ Core Algorithmic Implementations

### 1. Distributed Rate Limiting (Atomic Redis Lua)

To eliminate race conditions across multiple gateway instances under high concurrency, rate limits are computed entirely inside single-turn Redis Lua scripts.

```
       Token Bucket Algorithm                       Sliding Window Log Algorithm
 ┌────────────────────────────────┐            ┌────────────────────────────────────┐
 │  Tokens = min(B, T + Δt × r)   │            │  ZREMRANGEBYSCORE key 0 (now - W)  │
 │  if Tokens >= 1 then           │            │  Count = ZCARD key                 │
 │    Tokens = Tokens - 1         │            │  if Count < Limit then             │
 │    ALLOW (200 OK)              │            │    ZADD key now now                │
 │  else                          │            │    ALLOW (200 OK)                  │
 │    DENY  (429 Too Many Req)    │            │  else                              │
 └────────────────────────────────┘            │    DENY  (429 Too Many Req)        │
                                               └────────────────────────────────────┘
```

* **Token Bucket (`token_bucket.lua`)**: 
  Maintains current token count and timestamp in Redis hash. Tokens replenish continuously at rate $r$. Supports burst capacity $B$ while maintaining strict long-term rate pacing.
* **Sliding Window Log (`sliding_window.lua`)**:
  Stores each request timestamp in a Redis Sorted Set (`ZSET`). Prunes expired entries with `ZREMRANGEBYSCORE 0 (now - window)` and measures exact cardinality `ZCARD`. Eliminates boundary-burst vulnerabilities present in standard fixed-window counters.
* **RFC-6585 Compliance**: Injected headers include `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`, and `Retry-After`.

---

### 2. Ketama Consistent Hashing with Virtual Nodes

For stateful sharding and Redis key placement, Flux-GO implements a consistent hash ring with virtual node replication:

* **Ring Topography**: Each physical node maps to 150 virtual replicas across a $2^{32}-1$ integer ring using FNV-1a hashing.
* **Lookup Complexity**: Employs `sort.Search` for $O(\log V)$ binary search key lookups.
* **Uniformity**: Verified experimentally to sustain $<12\%$ deviation across all nodes.
* **Minimal Remapping**: When adding or removing a cluster node, exactly $1/N$ keys are transferred, avoiding thundering herds on caches.

---

### 3. Load Balancing Algorithms

Four battle-tested load balancing strategies can be configured independently per upstream pool:

| Strategy | Selection Mechanism | Best Suited For |
|---|---|---|
| **Round Robin** | Lock-free atomic increment skipping unhealthy nodes | Homogeneous upstream instances |
| **Least Connections** | Tracks active in-flight requests and routes to the lowest loaded target | Varying execution times / long-lived I/O |
| **Smooth Weighted RR** | Nginx smooth distributed interleaving based on effective node weights | Mixed hardware capacity clusters |
| **Power of Two Choices ($P2C$)** | Samples two random nodes and picks the one with fewer active connections | High-scale clusters where global lock contention hurts |

---

### 4. Zero-Dependency Circuit Breaker State Machine

Each upstream target is guarded by an isolated finite state machine ($FSM$) to halt cascading cascading failures:

```
                    ┌────────────────────────┐
                    │         CLOSED         │◄────────────────────────┐
                    │  (All traffic passes)  │                         │
                    └───────────┬────────────┘                         │
                                │                                      │
                     5 Consecutive Failures                            │
                                │                                      │
                                ▼                                      │
                    ┌────────────────────────┐                         │
                    │          OPEN          │                         │
                    │  (Fast-fails with 503) │                         │
                    └───────────┬────────────┘                         │
                                │                                      │
                         Cooldown Timeout (e.g. 10s)                   │
                                │                                      │
                                ▼                                      │
                    ┌────────────────────────┐                         │
                    │       HALF-OPEN        │                         │
                    │  (Canary probe traffic)├─────────────────────────┘
                    └───────────┬────────────┘   3 Consecutive Successes
                                │
                        Any Canary Failure
                                │
                                └────────────► Back to OPEN
```

* **Hysteresis Counters**: Tracks consecutive failures in `CLOSED`, transitions to `OPEN` immediately on reaching threshold, and enters `HALF-OPEN` after a configurable cooldown.
* **Canary Probes**: Concurrently allows a limited quota of probe requests through in `HALF-OPEN`. If any probe fails, the breaker trips back to `OPEN`. If all succeed, it resets to `CLOSED`.

---

## 📊 Empirical Benchmarks & System Design Analysis

The gateway was benchmarked using [k6](https://k6.io) under 500 concurrent Virtual Users ($VUs$).

### 1. Load Test Performance Profile

| Metric | Baseline (Mock Latency Enabled) | 0ms Latency (Mock Latency Disabled) |
|---|:---:|:---:|
| **Total Ingested Requests** | **421,001** | **332,064** |
| **Sustained Throughput** | **2,806 req/s** | **2,213 req/s** |
| **Latency p50 (Median)** | **39.2 ms** | **36.2 ms** |
| **Latency p95** | **130.7 ms** | **212.0 ms** |
| **Latency p99** | **187.0 ms** | **537.6 ms** |
| **Rate-Limited Traffic** | **39.1%** | **35.2%** |

### 2. Downstream Latency & Pacing Paradox (System Design Deep Dive)

> **Key Architectural Finding**: Setting downstream mock service latencies to **0ms** caused the gateway's p99 latency to balloon from **187.0ms to 537.6ms** (a ~2.8x increase), while throughput dropped by **21%**.

* **Root Cause Analysis**: Downstream service latency acts as a natural client-side backoff mechanism for closed-loop request generators ($VUs$). When upstream responded instantaneously, client connection loops immediately saturated the gateway's networking stack, causing epoll socket starvation, Go goroutine scheduler thrashing, and memory cache misses.
* **Takeaway**: In distributed systems, reducing downstream latency without implementing client-side pacing or token-bucket egress throttles increases concurrency depth and degrades gateway tail latency.

---

## 🖥 Observability & Chaos Control Plane

Flux-GO features a native, real-time single-page application built with **React 19**, **Vite**, and zero external UI bloat.

Accessible at `http://localhost:9091/dashboard/` (or port `:5173` in frontend development mode):

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│  ⚡ FLUX.GO  v1.2 Control Plane   [● LIVE TELEMETRY]      [Topology] [Simulator] [Config]│
├────────────────────────────────────────────────────────────────────────────────────────┤
│ ┌──────────────────┐ ┌──────────────────┐ ┌──────────────────┐ ┌──────────────────┐   │
│ │  TOTAL INGESTED  │ │   RATE LIMITED   │ │  LIVE THROUGHPUT │ │  CLUSTER HEALTH  │   │
│ │     421,001      │ │   164,611 (39%)  │ │    2,806 req/s   │ │     6 / 6 UP     │   │
│ │   [──────────]   │ │   [   /\  /\   ] │ │   [  /\__/\__/\  ]│ │    42 Conns      │   │
│ └──────────────────┘ └──────────────────┘ └──────────────────┘ └──────────────────┘   │
├────────────────────────────────────────────────────────────────────────────────────────┤
│  POOL: users-pool (Strategy: round_robin)                                              │
│  ┌────────────────────────────────────┐  ┌────────────────────────────────────┐        │
│  │ users-upstream-1        [ HEALTHY ]│  │ users-upstream-2        [ HEALTHY ]│        │
│  │ URL: http://upstream-a:9001        │  │ URL: http://upstream-b:9002        │        │
│  │ Active Conns: 4                    │  │ Active Conns: 2                    │        │
│  │ Breaker: [● CLOSED] (0 Fails)      │  │ Breaker: [● CLOSED] (0 Fails)      │        │
│  │ ────────────────────────────────── │  │ ────────────────────────────────── │        │
│  │ Fault Injection: [───●──────] 25%  │  │ Fault Injection: [●─────────] 0%   │        │
│  │ [0% Clean] [25% Flaky] [100% Trip] │  │ [0% Clean] [25% Flaky] [100% Trip] │        │
│  └────────────────────────────────────┘  └────────────────────────────────────┘        │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

### Control Plane Capabilities
1. **Interactive Traffic Simulator**: Test rate limiting live from the UI. Select endpoints (`/api/v1/users`, `/api/v1/orders`), choose tier credentials (`free-key-001`, `pro-key-001`, `enterprise-key-001`), fire bursts of $10$ to $100$ requests, and inspect real-time RFC-6585 headers and status code distributions ($200$ vs $429$ vs $503$).
2. **SVG Sparkline Micro-Charts**: Zero-dependency rolling 25-point SVG graphs rendering live throughput ($\text{req/s}$) and 429 rejection patterns.
3. **Runtime Chaos Fault Injection**: Sliders and quick presets (`0% Clean`, `25% Flaky`, `50% Loss`, `100% Trip`) directly dispatch `POST /chaos` payloads to mock upstreams, triggering real circuit breaker trips on the fly.
4. **Admin Authentication**: Supports Bearer token authorization persisted in `localStorage` for secured admin endpoints.
5. **Offline Simulation Mode**: 1-click toggle allowing recruiters and interviewers to explore the entire UI with realistic live-jitter data without starting Redis or backend services.

---

## 🚀 Quickstart Guide

### Option 1: Full Docker Compose Stack (Recommended)

Spins up the Gateway, 3 Mock Services, Redis, Caddy (HTTPS & CORS), Prometheus, and Grafana:

```bash
# Clone the repository
git clone https://github.com/ANSUJKMEHER/Flux.git
cd Flux/deployments

# Launch the full distributed cluster
docker-compose up --build -d

# Verify all services are healthy
docker-compose ps
```

| Service | Access URL | Credentials |
|---|---|---|
| **Public Gateway** | `http://localhost:8080` (or `:8085`) | Send `X-API-Key: pro-key-001` |
| **Control Plane UI** | `http://localhost:9091/dashboard/` | Bearer Token (if configured) |
| **Prometheus Metrics**| `http://localhost:9090` | Public |
| **Grafana Dashboards**| `http://localhost:3000` | `admin` / `admin` |

---

### Option 2: Local Development (Bare Metal)

#### Prerequisites
* Go 1.23+
* Redis (`localhost:6379`)
* Node.js 18+ (for frontend dashboard development)

```bash
# 1. Start Redis
docker run -d -p 6379:6379 --name flux-redis redis:alpine

# 2. Launch Mock Upstream Instances
go run ./cmd/mockservice/ &
MOCK_PORT=9002 MOCK_SERVICE_NAME=service-B go run ./cmd/mockservice/ &
MOCK_PORT=9003 MOCK_SERVICE_NAME=service-C go run ./cmd/mockservice/ &

# 3. Launch Gateway
go run ./cmd/gateway/ -config configs/gateway.yaml
```

#### Run the Frontend Dashboard
```bash
cd web/dashboard
npm install
npm run dev
# Open http://localhost:5173/dashboard/
```

---

## 🧪 Testing & Verification

Flux-GO maintains 100% test pass rates across all core packages with zero data races:

```bash
# Execute comprehensive test suite with race detector enabled
go test ./... -v -race -count=1

# Run static analysis
go vet ./...

# Run frontend linting & production build
cd web/dashboard
npm run lint      # 0 warnings, 0 errors (oxlint)
npm run build     # Compiles production assets into dist/
```

---

## 📡 API & Admin Reference

### Client Traffic Endpoints

| Method | Path | Routing Target | Rate Limit Tier | Algorithm |
|---|---|---|---|---|
| `GET` | `/api/v1/users` | `users-pool` | Auth-derived (`free`/`pro`) | Token Bucket |
| `GET` | `/api/v1/orders` | `orders-pool` | Auth-derived (`free`/`pro`) | Sliding Window Log |
| `GET` | `/api/v1/products`| `products-pool`| Default Free Tier | Token Bucket |

#### Client Request Example:
```bash
curl -i -H "X-API-Key: pro-key-001" http://localhost:8080/api/v1/users
```
```http
HTTP/1.1 200 OK
Content-Type: application/json
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 99
X-RateLimit-Reset: 1
X-Request-Id: 3d1f0bb8-a3f1-43ef-b586-cfc756f7ef04

{"service":"service-A","path":"/api/v1/users","latency_ms":18}
```

---

### Admin & Telemetry Endpoints (Port `:9091`)

| Method | Path | Description | Protected |
|---|---|---|:---:|
| `GET` | `/admin/health` | Active liveness & readiness probe | No |
| `GET` | `/admin/upstreams` | Health status and active connections per upstream | Yes |
| `GET` | `/admin/breakers` | Circuit breaker state machine metrics | Yes |
| `GET` | `/admin/stats` | Cumulative request & 429 rejection counts | Yes |
| `GET` | `/admin/config` | Sanitized runtime configuration dump | Yes |
| `PUT` | `/admin/config` | Hot-reload gateway YAML configuration | Yes |
| `GET` | `/metrics` | Prometheus metrics endpoint | No |

---

## 📂 Repository Layout

```
Flux-GO/
├── cmd/
│   ├── gateway/main.go          # Gateway server entry point & graceful shutdown
│   ├── mockservice/main.go      # Upstream service emulator with /chaos endpoint
│   └── loadtest/                # Synthetic load generators
├── internal/
│   ├── admin/                   # Admin HTTP API, sanitized config & CORS
│   ├── breaker/                 # Circuit breaker FSM (Closed/Half-Open/Open)
│   ├── config/                  # YAML parser, validator & atomic config holder
│   ├── hashring/                # Ketama consistent hash ring with virtual nodes
│   ├── health/                  # Background active health probing & hysteresis
│   ├── loadbalancer/            # RR, Least-Conn, Weighted RR, P2C balancers
│   ├── middleware/              # Auth, Prometheus metrics, RequestID, CORS
│   ├── ratelimit/               # Token Bucket, Sliding Window & Redis Lua scripts
│   │   └── lua/                 # Embedded atomic Redis scripts
│   └── router/                  # Path prefix & host-based route matching
├── web/
│   └── dashboard/               # Observability & Chaos Control Plane UI
│       ├── src/
│       │   ├── components/      # StatsBar, UpstreamCard, TrafficGenerator, ConfigViewer
│       │   ├── api.js           # Admin & Gateway client with auth token support
│       │   └── demoData.js      # Offline simulation engine
│       └── dist/                # Production static assets served by Go
├── configs/
│   └── gateway.yaml             # Declarative gateway routing & rate limit tiers
├── deployments/                 # Docker Compose, Caddyfile, Prometheus, Grafana
├── benchmarks/                  # k6 load testing scripts & analysis
├── AUDIT_REPORT.md              # 33-point production hardening audit report
└── Dockerfile                   # Multi-stage production container build
```

---

## 🎯 System Design Interview Talking Points

Ready-to-use responses for Senior/Staff Backend & Distributed Systems interviews:

1. **How do you avoid race conditions in distributed rate limiting?**
   > *"We avoid distributed locks entirely by executing token updates inside single-turn Redis Lua scripts. Because Redis evaluates Lua scripts atomically on its main thread, the read-modify-write cycle of checking remaining tokens and decrementing them happens without interleaving from other gateway replicas."*

2. **Why use Sliding Window Log over Fixed Window?**
   > *"Fixed windows suffer from the $2\times$ boundary burst problem: a client can exhaust their quota in the last second of window 1 and the first second of window 2, effectively doubling their allowed rate. Our sliding window log uses a Redis `ZSET` scored by microsecond timestamps, trimming expired events with `ZREMRANGEBYSCORE` to measure precise request frequency."*

3. **How does your circuit breaker handle transient network blips?**
   > *"We employ state hysteresis counters rather than single-error triggers. An upstream must fail $N$ consecutive times (default: 5) to trip from `CLOSED` to `OPEN`. In `HALF-OPEN`, probe requests are bounded; only after $M$ consecutive canary successes does the breaker safely transition back to `CLOSED`."*

4. **What happened when upstream latency was reduced to 0ms during your load test?**
   > *"Tail latency (p99) worsened from 187ms to 537ms because downstream latency acted as an implicit client pacing mechanism. Removing it flooded the gateway with concurrent connections, causing context switching overhead and socket exhaustion. This demonstrates why ingress gateways require rate limiting and connection pooling regardless of backend speed."*

---

## 📜 License

Licensed under the [MIT License](LICENSE). Copyright © 2026 ANSUJ MEHER.
