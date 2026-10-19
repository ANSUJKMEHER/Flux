// Realistic mock data for offline dashboard exploration and portfolio review

export const DEMO_UPSTREAMS = [
  { id: 'users-upstream-1', url: 'http://upstream-a:9001', pool: 'users-pool', healthy: true, active_connections: 4 },
  { id: 'users-upstream-2', url: 'http://upstream-b:9002', pool: 'users-pool', healthy: true, active_connections: 2 },
  { id: 'orders-upstream-1', url: 'http://upstream-c:9003', pool: 'orders-pool', healthy: true, active_connections: 8 },
  { id: 'orders-upstream-2', url: 'http://upstream-d:9004', pool: 'orders-pool', healthy: true, active_connections: 5 },
  { id: 'products-upstream-1', url: 'http://upstream-e:9005', pool: 'products-pool', healthy: true, active_connections: 1 },
];

export const DEMO_BREAKERS = [
  { upstream: 'users-upstream-1', state: 'closed', stats: { consecutive_failures: 0, failures: 2, successes: 1420 } },
  { upstream: 'users-upstream-2', state: 'closed', stats: { consecutive_failures: 0, failures: 0, successes: 1390 } },
  { upstream: 'orders-upstream-1', state: 'closed', stats: { consecutive_failures: 0, failures: 1, successes: 890 } },
  { upstream: 'orders-upstream-2', state: 'half-open', stats: { consecutive_failures: 3, failures: 12, successes: 410 } },
  { upstream: 'products-upstream-1', state: 'closed', stats: { consecutive_failures: 0, failures: 0, successes: 620 } },
];

export const DEMO_CONFIG = {
  server: { listen_addr: ':8085', read_timeout: '15s', write_timeout: '15s', drain_timeout: '30s' },
  admin: { listen_addr: ':9091', enabled: true },
  routes: [
    { path_prefix: '/api/v1/users', pool: 'users-pool', algorithm: 'token_bucket', rate_limit_tier: 'auth-derived' },
    { path_prefix: '/api/v1/orders', pool: 'orders-pool', algorithm: 'sliding_window', rate_limit_tier: 'auth-derived' },
    { path_prefix: '/api/v1/products', pool: 'products-pool', algorithm: 'token_bucket', rate_limit_tier: 'free' },
  ],
  rate_limits: {
    free: { algorithm: 'token_bucket', rate: 10, burst: 20, window: '1m' },
    pro: { algorithm: 'token_bucket', rate: 100, burst: 200, window: '1m' },
    enterprise: { algorithm: 'token_bucket', rate: 1000, burst: 2000, window: '1m' },
  },
  breaker: { consecutive_failures: 5, timeout: '10s', half_open_requests: 3 },
  health: { interval: '5s', timeout: '2s', path: '/health' },
  pools: {
    'users-pool': { strategy: 'round_robin', upstreams: ['users-upstream-1', 'users-upstream-2'] },
    'orders-pool': { strategy: 'least_conn', upstreams: ['orders-upstream-1', 'orders-upstream-2'] },
    'products-pool': { strategy: 'round_robin', upstreams: ['products-upstream-1'] },
  },
};
