import React, { useState } from 'react';
import { motion } from 'motion/react';
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

  const isTrip = breakerState.toLowerCase() === 'open';
  const isHalf = breakerState.toLowerCase().includes('half');

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      whileHover={{ y: -2 }}
      transition={{ duration: 0.2 }}
      className={`narv-node-card ${isTrip ? 'node-card-tripped' : isHalf || chaosValue > 0 ? 'node-card-highlight' : ''}`}
    >
      {/* Index Tag */}
      <div className="narv-card-top-row font-mono">
        <span className="text-orange">// {upstream.id.toUpperCase()}</span>
        <span className={`narv-node-status-dot ${upstream.healthy ? 'status-dot-ok' : 'status-dot-err'}`}>
          {upstream.healthy ? 'HEALTHY' : 'OFFLINE'}
        </span>
      </div>

      {/* Title & URL */}
      <h3 className="narv-node-title font-mono">{upstream.id}</h3>
      <p className="narv-node-url font-mono text-muted">{upstream.url}</p>

      {/* Circuit Breaker & Sockets Strip */}
      <div className="narv-node-telemetry font-mono">
        <div className="telemetry-row">
          <span className="text-muted">CIRCUIT_BREAKER:</span>
          <span className={`cb-text-badge ${isTrip ? 'text-rose' : isHalf ? 'text-orange' : 'text-emerald'}`}>
            [{breakerState.toUpperCase()}]
          </span>
        </div>

        <div className="telemetry-row">
          <span className="text-muted">ACTIVE_SOCKETS:</span>
          <span className="text-dark font-bold">{upstream.active_connections || 0} IN-FLIGHT</span>
        </div>

        <div className="telemetry-row">
          <span className="text-muted">FAILS / SUCCESS:</span>
          <span>
            <span className="text-rose font-bold">{breakerStats.failures || 0}F</span> / <span className="text-emerald font-bold">{breakerStats.successes || 0}S</span>
          </span>
        </div>
      </div>

      {/* Chaos Injection Sandbox */}
      <div className="narv-node-chaos">
        <div className="chaos-label-strip font-mono">
          <span className="text-dark font-bold">// FAULT_INJECTION:</span>
          <span className="text-orange font-bold">{chaosValue}%</span>
        </div>

        <input
          type="range"
          min="0"
          max="100"
          value={chaosValue}
          onChange={(e) => setChaosValue(e.target.value)}
          className="narv-slider"
        />

        <div className="narv-preset-row font-mono">
          {[
            { label: '0%', val: 0 },
            { label: '25%', val: 25 },
            { label: '50%', val: 50 },
            { label: '100%', val: 100 },
          ].map((p) => (
            <button
              key={p.val}
              type="button"
              className={`narv-size-pill font-mono ${parseInt(chaosValue, 10) === p.val ? 'narv-size-pill-active' : ''}`}
              onClick={() => {
                setChaosValue(p.val);
                applyChaos(p.val);
              }}
            >
              [{p.label}]
            </button>
          ))}
        </div>

        <motion.button
          whileTap={{ scale: 0.98 }}
          className="narv-btn-black font-mono narv-btn-chaos"
          onClick={() => applyChaos(chaosValue)}
          disabled={applying}
        >
          <span className="narv-square-indicator">■</span>
          <span>{applying ? 'INJECTING FAULT...' : `APPLY ${chaosValue}% ERROR`}</span>
        </motion.button>

        {chaosStatus && (
          <div className={`narv-toast-msg font-mono text-xs ${chaosStatus.type === 'success' ? 'text-emerald' : 'text-orange'}`}>
            &gt; {chaosStatus.msg}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="narv-card-footer font-mono">
        {upstream.pool || 'DEFAULT-POOL'} // HTTP/1.1 FAIL-OVER
      </div>
    </motion.div>
  );
}
