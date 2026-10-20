import React, { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Zap, 
  Play, 
  Square, 
  RotateCcw, 
  Send, 
  Clock, 
  ShieldAlert, 
  Key, 
  Layers, 
  CheckCircle2, 
  Copy,
  Check
} from 'lucide-react';
import { sendTrafficRequest } from '../api';

const PRESET_TIERS = [
  { label: 'Free Tier (10 rps / burst 20)', key: 'free-key-001', tier: 'free', desc: 'Default public user tier' },
  { label: 'Pro Tier (100 rps / burst 200)', key: 'pro-key-001', tier: 'pro', desc: 'High-volume production key' },
  { label: 'Enterprise (1000 rps)', key: 'enterprise-key-001', tier: 'enterprise', desc: 'Hyperscale dedicated tier' },
  { label: 'Invalid Key (Expect 401)', key: 'invalid-token-demo', tier: 'invalid', desc: 'Simulate unauthorized client' },
  { label: 'Anonymous (No Key Header)', key: '', tier: 'none', desc: 'Tests fallback tier handling' },
];

const PRESET_ROUTES = [
  { path: '/api/v1/users', name: 'Users API', algo: 'Token Bucket', pool: 'users-pool' },
  { path: '/api/v1/orders', name: 'Orders API', algo: 'Sliding Window Log', pool: 'orders-pool' },
  { path: '/api/v1/products', name: 'Products API', algo: 'Token Bucket', pool: 'products-pool' },
];

export default function TrafficGenerator({ onTrafficGenerated }) {
  const [selectedRoute, setSelectedRoute] = useState('/api/v1/users');
  const [selectedTier, setSelectedTier] = useState(PRESET_TIERS[0]);
  const [burstSize, setBurstSize] = useState(25);
  const [isRunning, setIsRunning] = useState(false);
  const [isLooping, setIsLooping] = useState(false);
  const [logs, setLogs] = useState([]);
  const [latestHeaders, setLatestHeaders] = useState(null);
  const [copiedHeader, setCopiedHeader] = useState(false);

  const [counts, setCounts] = useState({ ok: 0, rateLimited: 0, breakerOpen: 0, unauthorized: 0, error: 0 });
  const [latencies, setLatencies] = useState([]);

  const loopTimerRef = useRef(null);

  const runBurst = useCallback(async (size = burstSize) => {
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

    results.forEach((res) => {
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

    setCounts((prev) => ({
      ok: prev.ok + batchOk,
      rateLimited: prev.rateLimited + batch429,
      breakerOpen: prev.breakerOpen + batch503,
      unauthorized: prev.unauthorized + batch401,
      error: prev.error + batchErr,
    }));

    setLatencies((prev) => [...prev.slice(-100), ...batchLatencies]);
    setLogs((prev) => [...results.reverse(), ...prev].slice(0, 40));

    setIsRunning(false);
    if (onTrafficGenerated) onTrafficGenerated();
  }, [burstSize, selectedRoute, selectedTier.key, onTrafficGenerated]);

  useEffect(() => {
    if (isLooping) {
      loopTimerRef.current = setInterval(() => {
        runBurst(4);
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

  const copyHeadersJson = () => {
    if (latestHeaders) {
      navigator.clipboard.writeText(JSON.stringify(latestHeaders, null, 2));
      setCopiedHeader(true);
      setTimeout(() => setCopiedHeader(false), 1500);
    }
  };

  const avgLatency = latencies.length > 0
    ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length)
    : 0;
  const minLatency = latencies.length > 0 ? Math.min(...latencies) : 0;
  const maxLatency = latencies.length > 0 ? Math.max(...latencies) : 0;
  const totalSent = counts.ok + counts.rateLimited + counts.breakerOpen + counts.unauthorized + counts.error;

  return (
    <div className="traffic-studio-container">
      {/* Studio Header */}
      <div className="studio-header">
        <div>
          <div className="studio-title-row">
            <div className="studio-icon-box">
              <Zap size={18} />
            </div>
            <h2 className="studio-title">Traffic & Rate Limit Simulator</h2>
          </div>
          <p className="studio-desc">
            Generate synthetic high-concurrency bursts against the gateway to test token bucket refills, sliding-window precision, and circuit breaker trip points in real time.
          </p>
        </div>

        <div className="studio-actions">
          <motion.button
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            className={`btn-stream-toggle ${isLooping ? 'stream-active' : ''}`}
            onClick={() => setIsLooping(!isLooping)}
          >
            {isLooping ? (
              <>
                <Square size={13} fill="currentColor" /> Stop Stream
              </>
            ) : (
              <>
                <Play size={13} fill="currentColor" /> Continuous Pulse
              </>
            )}
          </motion.button>

          <button
            className="btn-light-secondary"
            onClick={clearHistory}
            disabled={totalSent === 0}
          >
            <RotateCcw size={14} /> Clear
          </button>
        </div>
      </div>

      {/* Control Configuration Bar */}
      <div className="studio-control-card">
        <div className="control-field">
          <label className="field-label">Target Route</label>
          <div className="custom-select-wrapper">
            <select
              className="field-select"
              value={selectedRoute}
              onChange={(e) => setSelectedRoute(e.target.value)}
            >
              {PRESET_ROUTES.map((r) => (
                <option key={r.path} value={r.path}>
                  {r.name} — {r.algo} ({r.path})
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="control-field">
          <label className="field-label">Client Identity & Tier</label>
          <div className="custom-select-wrapper">
            <select
              className="field-select"
              value={selectedTier.key}
              onChange={(e) => {
                const found = PRESET_TIERS.find((t) => t.key === e.target.value) || PRESET_TIERS[0];
                setSelectedTier(found);
              }}
            >
              {PRESET_TIERS.map((t) => (
                <option key={t.key} value={t.key}>
                  {t.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="control-field">
          <label className="field-label">Burst Magnitude</label>
          <div className="magnitude-pills">
            {[1, 10, 25, 50, 100].map((sz) => (
              <button
                key={sz}
                type="button"
                className={`mag-pill ${burstSize === sz ? 'mag-pill-active' : ''}`}
                onClick={() => setBurstSize(sz)}
              >
                {sz}
              </button>
            ))}
          </div>
        </div>

        <div className="control-field action-field">
          <motion.button
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            className="btn-trigger-burst"
            onClick={() => runBurst()}
            disabled={isRunning}
          >
            {isRunning ? (
              <span className="flex-center">
                <span className="spinner-dots"></span> Bursting {burstSize}...
              </span>
            ) : (
              <span className="flex-center">
                <Send size={15} /> Send {burstSize} Requests
              </span>
            )}
          </motion.button>
        </div>
      </div>

      {/* Telemetry Summary Ribbon */}
      <div className="telemetry-ribbon">
        <div className="telem-badge telem-ok">
          <div className="telem-header">
            <CheckCircle2 size={13} />
            <span>200 OK</span>
          </div>
          <div className="telem-num">{counts.ok}</div>
        </div>

        <div className="telem-badge telem-limited">
          <div className="telem-header">
            <Clock size={13} />
            <span>429 Rate Limited</span>
          </div>
          <div className="telem-num">{counts.rateLimited}</div>
        </div>

        <div className="telem-badge telem-breaker">
          <div className="telem-header">
            <ShieldAlert size={13} />
            <span>503 CB Open</span>
          </div>
          <div className="telem-num">{counts.breakerOpen}</div>
        </div>

        <div className="telem-badge telem-unauth">
          <div className="telem-header">
            <Key size={13} />
            <span>401 Unauthorized</span>
          </div>
          <div className="telem-num">{counts.unauthorized}</div>
        </div>

        <div className="telem-badge telem-latency">
          <div className="telem-header">
            <Clock size={13} />
            <span>Latency (Avg / Min / Max)</span>
          </div>
          <div className="telem-num">
            {avgLatency}ms <span className="telem-sub">({minLatency} / {maxLatency}ms)</span>
          </div>
        </div>
      </div>

      {/* Two Column Grid: RFC Header Inspector & Live Log */}
      <div className="studio-details-grid">
        {/* Left: Headers Inspector */}
        <div className="surface-card">
          <div className="surface-card-header">
            <div className="card-title-group">
              <Layers size={16} className="text-indigo" />
              <h3 className="card-title">Gateway Rate-Limit Headers</h3>
            </div>
            {latestHeaders && (
              <button className="btn-copy-sm" onClick={copyHeadersJson}>
                {copiedHeader ? <Check size={12} /> : <Copy size={12} />}
                <span>{copiedHeader ? 'Copied' : 'JSON'}</span>
              </button>
            )}
          </div>

          <div className="surface-card-body">
            {latestHeaders && Object.keys(latestHeaders).length > 0 ? (
              <div className="headers-box">
                {Object.entries(latestHeaders).map(([key, val]) => (
                  <div key={key} className="header-entry-row">
                    <span className="header-name">{key}:</span>
                    <span className="header-value font-mono">{val}</span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="empty-studio-box">
                <Clock size={24} className="empty-icon-subtle" />
                <p>Send a request to inspect RFC-6585 rate limit headers returned by the gateway.</p>
              </div>
            )}

            <div className="callout-note">
              <strong>Rate Limiting Mechanics:</strong> Requests hitting token exhaustion immediately return HTTP 429 with <code>Retry-After</code>, <code>X-RateLimit-Limit</code>, and <code>X-RateLimit-Remaining</code> without touching upstream servers.
            </div>
          </div>
        </div>

        {/* Right: Live Telemetry Stream */}
        <div className="surface-card">
          <div className="surface-card-header">
            <div className="card-title-group">
              <Clock size={16} className="text-indigo" />
              <h3 className="card-title">Live Activity Stream</h3>
            </div>
            <span className="stream-count-pill">{logs.length} events</span>
          </div>

          <div className="surface-card-body stream-body">
            {logs.length === 0 ? (
              <div className="empty-studio-box">
                <Send size={24} className="empty-icon-subtle" />
                <p>Awaiting traffic events. Click "Send Requests" above to start streaming.</p>
              </div>
            ) : (
              <div className="stream-list">
                <AnimatePresence initial={false}>
                  {logs.map((log, idx) => (
                    <motion.div
                      key={idx}
                      initial={{ opacity: 0, x: -10 }}
                      animate={{ opacity: 1, x: 0 }}
                      className="stream-item-row"
                    >
                      <span className="stream-time">{log.timestamp}</span>
                      <span
                        className={`stream-status-pill ${
                          log.status === 200
                            ? 'pill-status-200'
                            : log.status === 429
                            ? 'pill-status-429'
                            : log.status === 503
                            ? 'pill-status-503'
                            : log.status === 401
                            ? 'pill-status-401'
                            : 'pill-status-err'
                        }`}
                      >
                        {log.status || 'ERR'}
                      </span>
                      <span className="stream-path font-mono">{log.endpoint}</span>
                      <span className="stream-latency font-mono">{log.duration}ms</span>
                    </motion.div>
                  ))}
                </AnimatePresence>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
