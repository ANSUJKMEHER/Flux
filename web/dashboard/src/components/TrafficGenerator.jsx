import React, { useState, useEffect, useRef } from 'react';
import { sendTrafficRequest } from '../api';

const PRESET_TIERS = [
  { label: 'Free Tier (10 rps / burst 20)', key: 'free-key-001', tier: 'free' },
  { label: 'Pro Tier (100 rps / burst 200)', key: 'pro-key-001', tier: 'pro' },
  { label: 'Enterprise Tier (1000 rps)', key: 'enterprise-key-001', tier: 'enterprise' },
  { label: 'Invalid Key (Expect 401)', key: 'invalid-token-demo', tier: 'invalid' },
  { label: 'Anonymous (No Key Header)', key: '', tier: 'none' },
];

const PRESET_ROUTES = [
  { path: '/api/v1/users', name: 'Users API (Token Bucket)', pool: 'users-pool' },
  { path: '/api/v1/orders', name: 'Orders API (Sliding Window Log)', pool: 'orders-pool' },
  { path: '/api/v1/products', name: 'Products API (Default)', pool: 'products-pool' },
];

export default function TrafficGenerator({ onTrafficGenerated }) {
  const [selectedRoute, setSelectedRoute] = useState('/api/v1/users');
  const [selectedTier, setSelectedTier] = useState(PRESET_TIERS[0]);
  const [burstSize, setBurstSize] = useState(25);
  const [isRunning, setIsRunning] = useState(false);
  const [isLooping, setIsLooping] = useState(false);
  const [logs, setLogs] = useState([]);
  const [latestHeaders, setLatestHeaders] = useState(null);

  // Status breakdown counters
  const [counts, setCounts] = useState({ ok: 0, rateLimited: 0, breakerOpen: 0, unauthorized: 0, error: 0 });
  const [latencies, setLatencies] = useState([]);

  const loopTimerRef = useRef(null);

  // Send a single batch of requests
  const runBurst = React.useCallback(async (size = burstSize) => {
    setIsRunning(true);

    const promises = Array.from({ length: size }, () =>
      sendTrafficRequest(selectedRoute, selectedTier.key)
    );

    const results = await Promise.all(promises);

    let batchOk = 0;
    let batch429 = 0;
    let batch503 = 0;
    let batch401 = 0;
    let batchErr = 0;
    const batchLatencies = [];

    results.forEach(res => {
      batchLatencies.push(res.duration);
      if (res.status === 200) batchOk++;
      else if (res.status === 429) batch429++;
      else if (res.status === 503) batch503++;
      else if (res.status === 401) batch401++;
      else batchErr++;

      if (res.rateLimitHeaders && Object.keys(res.rateLimitHeaders).length > 0) {
        setLatestHeaders(res.rateLimitHeaders);
      }
    });

    setCounts(prev => ({
      ok: prev.ok + batchOk,
      rateLimited: prev.rateLimited + batch429,
      breakerOpen: prev.breakerOpen + batch503,
      unauthorized: prev.unauthorized + batch401,
      error: prev.error + batchErr,
    }));

    setLatencies(prev => [...prev.slice(-100), ...batchLatencies]);

    // Keep last 40 log lines
    setLogs(prev => [...results.reverse(), ...prev].slice(0, 40));

    setIsRunning(false);
    if (onTrafficGenerated) onTrafficGenerated();
  }, [burstSize, selectedRoute, selectedTier.key, onTrafficGenerated]);

  // Continuous background traffic simulator
  useEffect(() => {
    if (isLooping) {
      loopTimerRef.current = setInterval(() => {
        runBurst(3); // send 3 requests every 600ms
      }, 600);
    } else {
      if (loopTimerRef.current) clearInterval(loopTimerRef.current);
    }
    return () => {
      if (loopTimerRef.current) clearInterval(loopTimerRef.current);
    };
  }, [isLooping, runBurst]);

  const clearHistory = () => {
    setLogs([]);
    setCounts({ ok: 0, rateLimited: 0, breakerOpen: 0, unauthorized: 0, error: 0 });
    setLatencies([]);
    setLatestHeaders(null);
  };

  // Calculate latency statistics
  const avgLatency = latencies.length > 0
    ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length)
    : 0;
  const minLatency = latencies.length > 0 ? Math.min(...latencies) : 0;
  const maxLatency = latencies.length > 0 ? Math.max(...latencies) : 0;
  const totalSent = counts.ok + counts.rateLimited + counts.breakerOpen + counts.unauthorized + counts.error;

  return (
    <div className="traffic-gen-panel">
      <div className="traffic-gen-header">
        <div>
          <h2 className="section-title">Traffic & Rate Limit Simulator</h2>
          <p className="section-subtitle">
            Generate synthetic high-concurrency bursts to test token bucket refills, sliding-window accuracy, and circuit breakers in real time.
          </p>
        </div>
        <div className="traffic-gen-actions">
          <button
            className={`btn-loop ${isLooping ? 'btn-loop-active' : ''}`}
            onClick={() => setIsLooping(!isLooping)}
            title="Continuously pump 5 req/s"
          >
            {isLooping ? '■ Stop Stream' : '▶ Continuous Pulse'}
          </button>
          <button className="btn-secondary" onClick={clearHistory} disabled={totalSent === 0}>
            Clear Metrics
          </button>
        </div>
      </div>

      {/* Controls Bar */}
      <div className="traffic-controls-grid">
        <div className="control-group">
          <label>Target Route</label>
          <select
            className="input-select"
            value={selectedRoute}
            onChange={e => setSelectedRoute(e.target.value)}
          >
            {PRESET_ROUTES.map(r => (
              <option key={r.path} value={r.path}>
                {r.name}
              </option>
            ))}
          </select>
        </div>

        <div className="control-group">
          <label>Client Identity / Tier Key</label>
          <select
            className="input-select"
            value={selectedTier.key}
            onChange={e => {
              const found = PRESET_TIERS.find(t => t.key === e.target.value) || PRESET_TIERS[0];
              setSelectedTier(found);
            }}
          >
            {PRESET_TIERS.map(t => (
              <option key={t.key} value={t.key}>
                {t.label}
              </option>
            ))}
          </select>
        </div>

        <div className="control-group">
          <label>Burst Magnitude</label>
          <div className="burst-pills">
            {[1, 10, 25, 50, 100].map(sz => (
              <button
                key={sz}
                className={`pill-btn ${burstSize === sz ? 'pill-active' : ''}`}
                onClick={() => setBurstSize(sz)}
              >
                {sz}
              </button>
            ))}
          </div>
        </div>

        <div className="control-group action-trigger">
          <button
            className="btn-primary-glow"
            onClick={() => runBurst()}
            disabled={isRunning}
          >
            {isRunning ? (
              <span className="flex-center">
                <span className="spinner-mini"></span> Sending {burstSize}...
              </span>
            ) : (
              `Send ${burstSize} Requests`
            )}
          </button>
        </div>
      </div>

      {/* Live Response Telemetry Metrics */}
      <div className="telemetry-bar">
        <div className="telemetry-pill telem-ok">
          <span className="telem-label">200 OK</span>
          <span className="telem-count">{counts.ok}</span>
        </div>
        <div className="telemetry-pill telem-limited">
          <span className="telem-label">429 RATE LIMITED</span>
          <span className="telem-count">{counts.rateLimited}</span>
        </div>
        <div className="telemetry-pill telem-breaker">
          <span className="telem-label">503 CB OPEN</span>
          <span className="telem-count">{counts.breakerOpen}</span>
        </div>
        <div className="telemetry-pill telem-unauth">
          <span className="telem-label">401 UNAUTHORIZED</span>
          <span className="telem-count">{counts.unauthorized}</span>
        </div>
        {counts.error > 0 && (
          <div className="telemetry-pill telem-err">
            <span className="telem-label">OTHER ERR</span>
            <span className="telem-count">{counts.error}</span>
          </div>
        )}
        <div className="telemetry-pill telem-latency">
          <span className="telem-label">LATENCY (AVG / MIN / MAX)</span>
          <span className="telem-count">
            {avgLatency}ms <span className="telem-sub">({minLatency} / {maxLatency}ms)</span>
          </span>
        </div>
      </div>

      {/* Two-column layout: Header Inspector + Live Stream Log */}
      <div className="traffic-details-grid">
        {/* Left: Rate-Limit Headers Inspector */}
        <div className="details-card">
          <div className="details-card-header">
            <h3>Gateway Rate-Limit Headers</h3>
            <span className="badge-tag">RFC-6585</span>
          </div>
          {latestHeaders && Object.keys(latestHeaders).length > 0 ? (
            <div className="headers-table">
              {Object.entries(latestHeaders).map(([key, val]) => (
                <div key={key} className="header-row">
                  <span className="header-key">{key}:</span>
                  <span className="header-val">{val}</span>
                </div>
              ))}
            </div>
          ) : (
            <div className="empty-hint">
              Fire a request to capture and inspect real-time rate limit headers returned by the gateway.
            </div>
          )}
          <div className="details-info-box">
            <p>
              <strong>Rate Limiting Mechanics:</strong> Requests hitting token exhaustion instantly receive HTTP 429 with standard headers:
              <code>X-RateLimit-Limit</code>, <code>X-RateLimit-Remaining</code>, and <code>Retry-After</code>.
            </p>
          </div>
        </div>

        {/* Right: Live Request Stream */}
        <div className="details-card">
          <div className="details-card-header">
            <h3>Live Telemetry Stream</h3>
            <span className="stream-badge">{logs.length} events</span>
          </div>
          <div className="stream-log-container">
            {logs.length === 0 ? (
              <div className="empty-hint">Awaiting traffic events...</div>
            ) : (
              logs.map((log, idx) => (
                <div key={idx} className="stream-log-row">
                  <span className="log-time">{log.timestamp}</span>
                  <span
                    className={`log-status ${
                      log.status === 200
                        ? 'status-200'
                        : log.status === 429
                        ? 'status-429'
                        : log.status === 503
                        ? 'status-503'
                        : log.status === 401
                        ? 'status-401'
                        : 'status-err'
                    }`}
                  >
                    {log.status || 'ERR'}
                  </span>
                  <span className="log-endpoint">{log.endpoint}</span>
                  <span className="log-duration">{log.duration}ms</span>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
