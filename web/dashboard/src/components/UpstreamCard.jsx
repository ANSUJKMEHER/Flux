import React, { useState } from 'react';
import { motion } from 'motion/react';
import { 
  Server, 
  Flame 
} from 'lucide-react';
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
      setChaosStatus({ type: 'success', msg: `Chaos set to ${valueToApply}%` });
      if (onChaosApplied) onChaosApplied();
    } catch (e) {
      console.warn("Chaos injection failed (mockservice may not be running locally):", e.message);
      setChaosStatus({ type: 'warn', msg: `Target unreachable: ${e.message}` });
    } finally {
      setApplying(false);
      setTimeout(() => setChaosStatus(null), 3000);
    }
  };

  const breakerState = breaker?.state || 'closed';
  const breakerStats = breaker?.stats || {};

  const getBreakerStyle = (state) => {
    switch (state?.toLowerCase()) {
      case 'closed':
        return {
          pillClass: 'cb-pill-closed',
          label: 'CLOSED',
          desc: 'Normal traffic flowing',
        };
      case 'open':
        return {
          pillClass: 'cb-pill-open',
          label: 'OPEN',
          desc: 'Fast-failing traffic (503)',
        };
      case 'half-open':
      case 'halfopen':
        return {
          pillClass: 'cb-pill-halfopen',
          label: 'HALF-OPEN',
          desc: 'Canary probe traffic',
        };
      default:
        return {
          pillClass: 'cb-pill-closed',
          label: 'CLOSED',
          desc: 'Normal traffic flowing',
        };
    }
  };

  const cbStyle = getBreakerStyle(breakerState);

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      whileHover={{ y: -3 }}
      transition={{ duration: 0.25 }}
      className={`upstream-node-card ${!upstream.healthy ? 'node-card-unhealthy' : ''}`}
    >
      {/* Node Header */}
      <div className="node-card-header">
        <div className="node-title-group">
          <div className="node-icon-wrapper">
            <Server size={17} />
          </div>
          <div>
            <h4 className="node-id font-mono">{upstream.id}</h4>
            <span className="node-pool-chip">{upstream.pool || 'default-pool'}</span>
          </div>
        </div>

        <span className={`node-health-badge ${upstream.healthy ? 'health-badge-ok' : 'health-badge-err'}`}>
          <span className="pulse-circle"></span>
          {upstream.healthy ? 'ONLINE' : 'OFFLINE'}
        </span>
      </div>

      {/* Meta Properties */}
      <div className="node-meta-grid">
        <div className="node-meta-item">
          <span className="meta-label">Target Address</span>
          <span className="meta-val font-mono">{upstream.url}</span>
        </div>

        <div className="node-meta-item">
          <span className="meta-label">In-Flight Conns</span>
          <span className="meta-val font-mono">
            <span className="active-conn-chip">{upstream.active_connections || 0}</span>
          </span>
        </div>

        <div className="node-meta-item">
          <span className="meta-label">Circuit Breaker</span>
          <span className={`cb-state-pill ${cbStyle.pillClass}`}>
            <span className="cb-dot"></span>
            {cbStyle.label}
          </span>
        </div>
      </div>

      {/* Circuit Breaker Detailed Telemetry */}
      {breaker && (
        <div className="breaker-telemetry-strip">
          <div className="b-metric-col">
            <span className="b-metric-label">Consecutive Fails</span>
            <span className={`b-metric-val font-mono ${(breakerStats.consecutive_failures || 0) > 0 ? 'text-amber' : ''}`}>
              {breakerStats.consecutive_failures || 0}
            </span>
          </div>
          <div className="b-metric-col">
            <span className="b-metric-label">Total Failures</span>
            <span className={`b-metric-val font-mono ${(breakerStats.failures || 0) > 0 ? 'text-rose' : ''}`}>
              {breakerStats.failures || 0}
            </span>
          </div>
          <div className="b-metric-col">
            <span className="b-metric-label">Successes</span>
            <span className="b-metric-val font-mono text-emerald">
              {breakerStats.successes || 0}
            </span>
          </div>
        </div>
      )}

      {/* Chaos Fault Injection Sandbox */}
      <div className="node-chaos-box">
        <div className="chaos-label-row">
          <div className="chaos-title-box">
            <Flame size={14} className="text-amber" />
            <span className="chaos-title-text">Chaos Fault Injection</span>
          </div>
          <span className="chaos-percentage-badge">{chaosValue}% Error Rate</span>
        </div>

        <input
          type="range"
          min="0"
          max="100"
          value={chaosValue}
          onChange={(e) => setChaosValue(e.target.value)}
          className="clean-range-slider"
        />

        <div className="chaos-preset-chips">
          {[
            { label: '0% Clean', val: 0 },
            { label: '25% Flaky', val: 25 },
            { label: '50% Loss', val: 50 },
            { label: '100% Trip', val: 100 },
          ].map((p) => (
            <button
              key={p.val}
              type="button"
              className={`preset-chip-btn ${parseInt(chaosValue, 10) === p.val ? 'preset-chip-active' : ''}`}
              onClick={() => {
                setChaosValue(p.val);
                applyChaos(p.val);
              }}
            >
              {p.label}
            </button>
          ))}
        </div>

        <motion.button
          whileTap={{ scale: 0.98 }}
          className="btn-apply-fault"
          onClick={() => applyChaos(chaosValue)}
          disabled={applying}
        >
          {applying ? 'Injecting Fault...' : `Apply ${chaosValue}% Fault Rate`}
        </motion.button>

        {chaosStatus && (
          <div className={`status-toast toast-${chaosStatus.type}`}>
            {chaosStatus.msg}
          </div>
        )}
      </div>
    </motion.div>
  );
}
