import React, { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Send, Play, Square, RotateCcw, Copy, Check, FileText, Activity } from 'lucide-react';
import { sendTrafficRequest } from '../api';

const PRESET_TIERS = [
  { label: 'Free Tier (10 rps / burst 20)', key: 'free-key-001', tier: 'free' },
  { label: 'Pro Tier (100 rps / burst 200)', key: 'pro-key-001', tier: 'pro' },
  { label: 'Enterprise Tier (1000 rps)', key: 'enterprise-key-001', tier: 'enterprise' },
  { label: 'Invalid Key (Expect 401)', key: 'invalid-token-demo', tier: 'invalid' },
  { label: 'Anonymous (No Key Header)', key: '', tier: 'none' },
];

const PRESET_ROUTES = [
  { path: '/api/v1/users', name: 'Users API', algo: 'Token Bucket' },
  { path: '/api/v1/orders', name: 'Orders API', algo: 'Sliding Window Log' },
  { path: '/api/v1/products', name: 'Products API', algo: 'Token Bucket' },
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
    <section className="narv-section">
      {/* Header */}
      <div className="section-hero-header">
        <div>
          <div className="section-tag-row font-mono">
            <span className="tag-orange">[SIM. 02 / 04]</span>
            <span className="tag-sep">&gt;</span>
            <span className="tag-text">SYNTHETIC TRAFFIC &amp; RATE LIMIT SUITE</span>
          </div>

          <h2 className="section-main-heading">
            <span className="slash-accent">/ </span>
            <span className="text-black">Push concurrency to the limit.</span>{' '}
            <span className="text-muted-heading">Observe token refills and sliding window accuracy in real-time.</span>
            <span className="slash-accent"> /</span>
          </h2>
        </div>

        <div className="header-actions-group">
          <button
            type="button"
            className={`btn-stream-toggle ${isLooping ? 'btn-stream-active' : ''}`}
            onClick={() => setIsLooping(!isLooping)}
          >
            {isLooping ? <Square size={13} className="fill-current" /> : <Play size={13} className="fill-current" />}
            <span>{isLooping ? 'Stop Stream' : 'Continuous Pulse'}</span>
          </button>
          <button
            type="button"
            className="btn-soft-secondary font-mono"
            onClick={clearHistory}
            disabled={totalSent === 0}
          >
            <RotateCcw size={13} />
            <span>Reset</span>
          </button>
        </div>
      </div>

      {/* Control Panel Card */}
      <div className="control-panel-card">
        <div className="control-inputs-row">
          {/* Target Route */}
          <div className="input-group-modern">
            <label className="input-label-modern font-mono">TARGET ROUTE</label>
            <select
              className="select-modern font-mono"
              value={selectedRoute}
              onChange={(e) => setSelectedRoute(e.target.value)}
            >
              {PRESET_ROUTES.map((r) => (
                <option key={r.path} value={r.path}>
                  {r.name} [{r.algo}] ({r.path})
                </option>
              ))}
            </select>
          </div>

          {/* Client Identity / Tier */}
          <div className="input-group-modern">
            <label className="input-label-modern font-mono">CLIENT IDENTITY / TIER</label>
            <select
              className="select-modern font-mono"
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

          {/* Burst Magnitude */}
          <div className="input-group-modern">
            <label className="input-label-modern font-mono">BURST MAGNITUDE</label>
            <div className="pill-selector-row">
              {[1, 10, 25, 50, 100].map((sz) => (
                <button
                  key={sz}
                  type="button"
                  className={`pill-selector-btn font-mono ${burstSize === sz ? 'pill-selector-btn-active' : ''}`}
                  onClick={() => setBurstSize(sz)}
                >
                  {sz}
                </button>
              ))}
            </div>
          </div>

          {/* Unmistakable Primary Button */}
          <div className="input-group-action">
            <motion.button
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              className="btn-primary-action"
              onClick={() => runBurst()}
              disabled={isRunning}
            >
              <Send size={15} />
              <span>{isRunning ? `Sending ${burstSize}...` : `Send ${burstSize} Requests`}</span>
            </motion.button>
          </div>
        </div>
      </div>

      {/* Telemetry Counter Ribbon */}
      <div className="telemetry-ribbon-grid">
        <div className="telemetry-chip chip-emerald">
          <div className="chip-label font-mono">200 OK</div>
          <div className="chip-value font-mono">{counts.ok.toLocaleString()}</div>
        </div>
        <div className="telemetry-chip chip-orange">
          <div className="chip-label font-mono">429 LIMITED</div>
          <div className="chip-value font-mono">{counts.rateLimited.toLocaleString()}</div>
        </div>
        <div className="telemetry-chip chip-rose">
          <div className="chip-label font-mono">503 CB OPEN</div>
          <div className="chip-value font-mono">{counts.breakerOpen.toLocaleString()}</div>
        </div>
        <div className="telemetry-chip chip-purple">
          <div className="chip-label font-mono">401 UNAUTHORIZED</div>
          <div className="chip-value font-mono">{counts.unauthorized.toLocaleString()}</div>
        </div>
        <div className="telemetry-chip chip-slate">
          <div className="chip-label font-mono">LATENCY (AVG / MIN / MAX)</div>
          <div className="chip-value font-mono">
            {avgLatency}ms <span className="chip-subval font-mono">{minLatency}/{maxLatency}ms</span>
          </div>
        </div>
      </div>

      {/* Two Column Grid */}
      <div className="narv-grid-two">
        {/* Left: Headers Inspector */}
        <div className="soft-card">
          <div className="soft-card-header">
            <div className="card-title-with-icon">
              <FileText size={16} className="text-orange" />
              <h3 className="soft-card-title">Rate Limit Headers (RFC-6585)</h3>
            </div>
            {latestHeaders && Object.keys(latestHeaders).length > 0 && (
              <button
                type="button"
                className="btn-soft-secondary font-mono text-xs"
                onClick={copyHeadersJson}
              >
                {copiedHeader ? <Check size={12} className="text-emerald" /> : <Copy size={12} />}
                <span>{copiedHeader ? 'COPIED' : 'COPY JSON'}</span>
              </button>
            )}
          </div>

          <div className="soft-card-body">
            {latestHeaders && Object.keys(latestHeaders).length > 0 ? (
              <div className="headers-key-value-list">
                {Object.entries(latestHeaders).map(([key, val]) => (
                  <div key={key} className="header-kv-row font-mono">
                    <span className="header-key text-orange font-bold">{key}:</span>
                    <span className="header-val text-dark">{val}</span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="soft-empty-state">
                <span className="font-mono text-xs text-muted">
                  Awaiting traffic to capture upstream X-RateLimit-* headers
                </span>
              </div>
            )}
          </div>

          <div className="soft-card-footer font-mono">
            RFC-6585 RATE-LIMITING PROTOCOL ENFORCEMENT
          </div>
        </div>

        {/* Right: Live Activity Stream */}
        <div className="soft-card">
          <div className="soft-card-header">
            <div className="card-title-with-icon">
              <Activity size={16} className="text-orange" />
              <h3 className="soft-card-title">Live Request Stream ({logs.length})</h3>
            </div>
            <span className="badge-pill-neutral font-mono">In-Flight Dispatch</span>
          </div>

          <div className="soft-card-body scroll-activity-body">
            {logs.length === 0 ? (
              <div className="soft-empty-state">
                <span className="font-mono text-xs text-muted">
                  No requests dispatched yet. Click "Send Requests" above.
                </span>
              </div>
            ) : (
              <div className="activity-stream-list font-mono">
                <AnimatePresence initial={false}>
                  {logs.map((log, idx) => (
                    <motion.div
                      key={idx}
                      initial={{ opacity: 0, x: -6 }}
                      animate={{ opacity: 1, x: 0 }}
                      className="stream-log-entry"
                    >
                      <span className="text-muted text-xs">{log.timestamp}</span>
                      <span
                        className={`status-chip-sm ${
                          log.status === 200
                            ? 'status-chip-200'
                            : log.status === 429
                            ? 'status-chip-429'
                            : log.status === 503
                            ? 'status-chip-503'
                            : log.status === 401
                            ? 'status-chip-401'
                            : 'status-chip-err'
                        }`}
                      >
                        {log.status || 'ERR'}
                      </span>
                      <span className="text-dark font-medium flex-1 truncate">{log.endpoint}</span>
                      <span className="text-orange font-bold text-xs">{log.duration}ms</span>
                    </motion.div>
                  ))}
                </AnimatePresence>
              </div>
            )}
          </div>

          <div className="soft-card-footer font-mono">
            REAL-TIME EVENT DISPATCH LOGGER
          </div>
        </div>
      </div>
    </section>
  );
}
