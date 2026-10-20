import React, { useState } from 'react';
import { motion } from 'motion/react';
import { Server, Zap, ShieldCheck, ShieldAlert, AlertOctagon, CheckCircle2, AlertCircle } from 'lucide-react';
import { injectChaos } from '../api';

export default function UpstreamCard({ upstream, breaker, onChaosApplied }) {
  const [chaosValue, setChaosValue] = useState(0);
  const [applying, setApplying] = useState(false);
  const [chaosStatus, setChaosStatus] = useState(null);

  const applyChaos = async (valueToApply = chaosValue) => {
    setApplying(true);
    setChaosStatus(null);
    const errorRate = parseInt(valueToApply, 10) / 100.0;

    try {
      await injectChaos(upstream, errorRate);
      setChaosStatus({ type: 'success', msg: `Fault injected: ${valueToApply}% error rate applied.` });
      if (onChaosApplied) onChaosApplied();
    } catch (e) {
      console.warn("Chaos injection failed (mockservice may not be running locally):", e.message);
      setChaosStatus({ type: 'warn', msg: `Endpoint unreachable: ${e.message}` });
    } finally {
      setApplying(false);
      setTimeout(() => setChaosStatus(null), 3500);
    }
  };

  const breakerState = breaker?.state || 'closed';
  const breakerStats = breaker?.stats || {};

  const isTrip = breakerState.toLowerCase() === 'open';
  const isHalf = breakerState.toLowerCase().includes('half');

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      whileHover={{ y: -2 }}
      transition={{ duration: 0.2 }}
      className={`upstream-node-card ${isTrip ? 'card-border-tripped' : isHalf || chaosValue > 0 ? 'card-border-chaos' : ''}`}
    >
      {/* Card Header */}
      <div className="node-card-header">
        <div className="node-title-group">
          <Server size={15} className="text-orange" />
          <h3 className="node-id font-mono">{upstream.id}</h3>
        </div>
        <div className={`status-badge-dot ${upstream.healthy ? 'status-healthy' : 'status-offline'}`}>
          <span className="pulse-indicator-dot"></span>
          <span>{upstream.healthy ? 'HEALTHY' : 'OFFLINE'}</span>
        </div>
      </div>

      <p className="node-url font-mono text-xs text-muted">{upstream.url}</p>

      {/* Circuit Breaker & Sockets Status */}
      <div className="node-telemetry-box font-mono">
        <div className="node-telemetry-row">
          <span className="telemetry-label text-muted">CIRCUIT BREAKER</span>
          <span className={`breaker-badge ${isTrip ? 'breaker-open' : isHalf ? 'breaker-half' : 'breaker-closed'}`}>
            {isTrip ? (
              <AlertOctagon size={12} />
            ) : isHalf ? (
              <ShieldAlert size={12} />
            ) : (
              <ShieldCheck size={12} />
            )}
            <span>{breakerState.toUpperCase()}</span>
          </span>
        </div>

        <div className="node-telemetry-row">
          <span className="telemetry-label text-muted">ACTIVE SOCKETS</span>
          <span className="text-dark font-bold">{upstream.active_connections || 0} in-flight</span>
        </div>

        <div className="node-telemetry-row">
          <span className="telemetry-label text-muted">FAILS / SUCCESS</span>
          <span>
            <span className="text-rose font-bold">{breakerStats.failures || 0}F</span>
            <span className="text-muted"> / </span>
            <span className="text-emerald font-bold">{breakerStats.successes || 0}S</span>
          </span>
        </div>
      </div>

      {/* Fault Injection Sandbox */}
      <div className="node-chaos-sandbox">
        <div className="chaos-header-row font-mono">
          <span className="text-dark font-semibold text-xs">FAULT INJECTION</span>
          <span className="chaos-pct-badge font-bold text-orange">{chaosValue}%</span>
        </div>

        <input
          type="range"
          min="0"
          max="100"
          value={chaosValue}
          onChange={(e) => setChaosValue(e.target.value)}
          className="slider-modern"
        />

        {/* Clear, highly clickable preset buttons */}
        <div className="preset-chips-row font-mono">
          {[
            { label: '0% Clean', val: 0 },
            { label: '25% Flaky', val: 25 },
            { label: '50% Loss', val: 50 },
            { label: '100% Trip', val: 100 },
          ].map((p) => (
            <button
              key={p.val}
              type="button"
              className={`preset-chip-btn ${parseInt(chaosValue, 10) === p.val ? 'preset-chip-btn-active' : ''}`}
              onClick={() => {
                setChaosValue(p.val);
                applyChaos(p.val);
              }}
            >
              {p.label}
            </button>
          ))}
        </div>

        {/* Prominent Apply Button */}
        <motion.button
          whileHover={{ scale: 1.01 }}
          whileTap={{ scale: 0.98 }}
          className="btn-apply-chaos"
          onClick={() => applyChaos(chaosValue)}
          disabled={applying}
        >
          <Zap size={14} />
          <span>{applying ? 'Injecting Fault...' : `Apply ${chaosValue}% Fault Rate`}</span>
        </motion.button>

        {chaosStatus && (
          <div className={`chaos-toast-banner font-mono text-xs ${chaosStatus.type === 'success' ? 'toast-success' : 'toast-warn'}`}>
            {chaosStatus.type === 'success' ? <CheckCircle2 size={13} /> : <AlertCircle size={13} />}
            <span>{chaosStatus.msg}</span>
          </div>
        )}
      </div>

      {/* Card Footer */}
      <div className="node-card-footer font-mono">
        <span>POOL: {upstream.pool?.toUpperCase() || 'DEFAULT'}</span>
        <span className="text-muted">•</span>
        <span className="text-muted">HTTP/1.1 FAIL-OVER</span>
      </div>
    </motion.div>
  );
}
