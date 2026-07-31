// k6 Load Test for the API Gateway
// Run: k6 run benchmarks/k6-scripts/load_test.js
//
// Tests:
// 1. Mixed traffic across routes and API keys
// 2. Rate limiting behavior (free tier should hit limits)
// 3. Latency under load
// 4. Error rate tracking

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend } from 'k6/metrics';

// Custom metrics
const rateLimitedRate = new Rate('rate_limited');
const upstreamLatency = new Trend('upstream_latency');

// Test configuration
export const options = {
  stages: [
    { duration: '30s', target: 50 },   // ramp up
    { duration: '1m',  target: 200 },  // sustained load
    { duration: '30s', target: 500 },  // peak load
    { duration: '30s', target: 0 },    // ramp down
  ],
  thresholds: {
    http_req_duration: ['p(95)<500', 'p(99)<1000'], // p95 < 500ms, p99 < 1s
    rate_limited: ['rate<0.5'],                       // less than 50% rate limited
    http_req_failed: ['rate<0.1'],                    // less than 10% errors (excluding 429s)
  },
};

const BASE_URL = __ENV.GATEWAY_URL || 'http://localhost:8085';

// API keys and their tiers
const apiKeys = [
  { key: 'free-key-001', tier: 'free' },
  { key: 'free-key-002', tier: 'free' },
  { key: 'pro-key-001', tier: 'pro' },
  { key: 'pro-key-002', tier: 'pro' },
  { key: 'enterprise-key-001', tier: 'enterprise' },
];

// Routes to test
const routes = [
  '/api/v1/users',
  '/api/v1/users/123',
  '/api/v1/orders',
  '/api/v1/orders/456',
  '/api/v1/products',
  '/api/v1/products/789',
];

export default function () {
  // Pick a random API key and route
  const apiKey = apiKeys[Math.floor(Math.random() * apiKeys.length)];
  const route = routes[Math.floor(Math.random() * routes.length)];

  const params = {
    headers: {
      'X-API-Key': apiKey.key,
      'Content-Type': 'application/json',
    },
    tags: {
      tier: apiKey.tier,
      route: route,
    },
  };

  const res = http.get(`${BASE_URL}${route}`, params);

  // Track rate limiting
  const isRateLimited = res.status === 429;
  rateLimitedRate.add(isRateLimited);

  // Track upstream latency for successful requests
  if (res.status === 200) {
    upstreamLatency.add(res.timings.duration);
  }

  // Checks
  check(res, {
    'status is 200 or 429': (r) => r.status === 200 || r.status === 429,
    'has response body': (r) => r.body && r.body.length > 0,
    'has request ID': (r) => r.headers['X-Request-Id'] !== undefined,
  });

  // Small sleep to simulate realistic client behavior
  sleep(0.01);
}

// Summary handler for clean output
export function handleSummary(data) {
  const summary = {
    total_requests: data.metrics.http_reqs.values.count,
    rps: data.metrics.http_reqs.values.rate.toFixed(1),
    p50_ms: data.metrics.http_req_duration.values['med'] ? data.metrics.http_req_duration.values['med'].toFixed(1) : 'N/A',
    p95_ms: data.metrics.http_req_duration.values['p(95)'] ? data.metrics.http_req_duration.values['p(95)'].toFixed(1) : 'N/A',
    p99_ms: data.metrics.http_req_duration.values['p(99)'] ? data.metrics.http_req_duration.values['p(99)'].toFixed(1) : 'N/A',
    rate_limited_pct: (data.metrics.rate_limited.values.rate * 100).toFixed(1),
    error_rate_pct: (data.metrics.http_req_failed.values.rate * 100).toFixed(1),
  };

  console.log('\n=== Gateway Load Test Results ===');
  console.log(`Duration values: ${JSON.stringify(data.metrics.http_req_duration.values)}`);
  console.log(`Total Requests:  ${summary.total_requests}`);
  console.log(`Throughput:      ${summary.rps} req/s`);
  console.log(`Latency p50:     ${summary.p50_ms} ms`);
  console.log(`Latency p95:     ${summary.p95_ms} ms`);
  console.log(`Latency p99:     ${summary.p99_ms} ms`);
  console.log(`Rate Limited:    ${summary.rate_limited_pct}%`);
  console.log(`Error Rate:      ${summary.error_rate_pct}%`);
  console.log('================================\n');

  return {
    stdout: JSON.stringify(summary, null, 2),
  };
}
