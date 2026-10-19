import React, { useState } from 'react';
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

  const getBreakerClass = (state) => {
    switch (state?.toLowerCase()) {
      case 'closed':
        return 'breaker-closed';
      case 'open':
        return 'breaker-open';
      case 'half-open':
      case 'halfopen':
        return 'breaker-halfopen';
      default:
        return 'breaker-closed';
    }
  };

  const breakerState = breaker?.state || 'closed';
  const breakerStats = breaker?.stats || {};

  return (
    <div className={`upstream-card ${!upstream.healthy ? 'card-unhealthy' : ''}`}>
      {/* Header */}
      <div className="upstream-header">
        <div className="upstream-identity">
          <div className="upstream-title">{upstream.id}</div>
          <span className="upstream-pool-tag">{upstream.pool || 'default-pool'}</span>
        </div>
        <span className={`status-pill ${upstream.healthy ? 'pill-healthy' : 'pill-unhealthy'}`}>
          <span className="status-dot"></span>
          {upstream.healthy ? 'HEALTHY' : 'OFFLINE'}
        </span>
      </div>

      {/* Meta Info */}
      <div className="upstream-meta">
        <div className="meta-row">
          <span className="meta-label">Target URL</span>
          <span className="meta-val font-mono">{upstream.url}</span>
        </div>

        <div className="meta-row">
          <span className="meta-label">Active Connections</span>
          <span className="meta-val font-mono">
            <span className="active-conn-badge">{upstream.active_connections || 0}</span>
          </span>
        </div>

        <div className="meta-row">
          <span className="meta-label">Circuit Breaker</span>
          <span className={`breaker-badge ${getBreakerClass(breakerState)}`}>
            <span className="breaker-dot"></span>
            {breakerState.toUpperCase()}
          </span>
        </div>
      </div>

      {/* Circuit Breaker Detailed Telemetry */}
      {breaker && (
        <div className="breaker-details-box">
          <div className="breaker-stat-item">
            <span className="b-label">Consecutive Fails</span>
            <span className="b-val" style={{ color: (breakerStats.consecutive_failures || 0) > 0 ? 'var(--orange)' : 'var(--text-main)' }}>
              {breakerStats.consecutive_failures || 0}
            </span>
          </div>
          <div className="breaker-stat-item">
            <span className="b-label">Total Failures</span>
            <span className="b-val" style={{ color: (breakerStats.failures || 0) > 0 ? 'var(--red)' : 'var(--text-main)' }}>
              {breakerStats.failures || 0}
            </span>
          </div>
          <div className="breaker-stat-item">
            <span className="b-label">Total Successes</span>
            <span className="b-val" style={{ color: 'var(--green)' }}>
              {breakerStats.successes || 0}
            </span>
          </div>
        </div>
      )}

      {/* Chaos Injection Sandbox */}
      <div className="chaos-section">
        <div className="chaos-header">
          <span className="chaos-title">Chaos Fault Injection</span>
          <span className="chaos-percent">{chaosValue}% Error</span>
        </div>

        <input
          type="range"
          min="0"
          max="100"
          value={chaosValue}
          onChange={(e) => setChaosValue(e.target.value)}
          className="chaos-slider"
        />

        {/* Quick Presets */}
        <div className="chaos-presets">
          {[
            { label: '0% Clean', val: 0 },
            { label: '25% Flaky', val: 25 },
            { label: '50% Loss', val: 50 },
            { label: '100% Trip', val: 100 },
          ].map(p => (
            <button
              key={p.val}
              type="button"
              className={`preset-btn ${parseInt(chaosValue, 10) === p.val ? 'preset-active' : ''}`}
              onClick={() => {
                setChaosValue(p.val);
                applyChaos(p.val);
              }}
            >
              {p.label}
            </button>
          ))}
        </div>

        <button
          className="btn-apply-chaos"
          onClick={() => applyChaos(chaosValue)}
          disabled={applying}
        >
          {applying ? 'Injecting Faults...' : `Apply ${chaosValue}% Failure Rate`}
        </button>

        {chaosStatus && (
          <div className={`chaos-status-msg msg-${chaosStatus.type}`}>
            {chaosStatus.msg}
          </div>
        )}
      </div>
    </div>
  );
}
