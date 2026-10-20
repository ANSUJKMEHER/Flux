import React, { useState, useEffect } from 'react';
import { motion } from 'motion/react';
import { Settings, RefreshCw, Route, Shield, Layers, Server } from 'lucide-react';
import { fetchConfig } from '../api';

export default function ConfigViewer() {
  const [config, setConfig] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const loadConfig = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchConfig();
      setConfig(data);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadConfig();
  }, []);

  if (loading) {
    return (
      <div className="surface-card">
        <div className="empty-studio-box">
          <RefreshCw size={24} className="spin-icon text-indigo" />
          <p>Fetching sanitized gateway configuration from <code>/admin/config</code>...</p>
        </div>
      </div>
    );
  }

  if (error || !config) {
    return (
      <div className="surface-card">
        <div className="banner-alert-box">
          <p>Unable to load configuration: {error || 'No data returned'}</p>
          <button className="btn-light-secondary" onClick={loadConfig}>
            Retry
          </button>
        </div>
      </div>
    );
  }

  const { routes = [], rate_limits = {}, breaker = {}, health = {}, pools = {} } = config;

  return (
    <div className="config-inspector-container">
      {/* Header */}
      <div className="studio-header">
        <div>
          <div className="studio-title-row">
            <div className="studio-icon-box">
              <Settings size={18} />
            </div>
            <h2 className="studio-title">Gateway Configuration Inspector</h2>
          </div>
          <p className="studio-desc">
            Sanitized live configuration from <code>/admin/config</code>. All sensitive credentials, tokens, and internal keys are automatically redacted by the admin control plane.
          </p>
        </div>

        <motion.button
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
          className="btn-light-secondary"
          onClick={loadConfig}
        >
          <RefreshCw size={14} /> Refresh Configuration
        </motion.button>
      </div>

      <div className="config-cards-grid">
        {/* Routing Rules */}
        <div className="surface-card">
          <div className="surface-card-header">
            <div className="card-title-group">
              <Route size={16} className="text-indigo" />
              <h3 className="card-title">Routing Rules ({routes.length})</h3>
            </div>
            <span className="badge-soft-blue">First-Match Wins</span>
          </div>

          <div className="table-wrapper">
            <table className="clean-table">
              <thead>
                <tr>
                  <th>Path Prefix</th>
                  <th>Target Pool</th>
                  <th>Algorithm</th>
                  <th>Tier Override</th>
                </tr>
              </thead>
              <tbody>
                {routes.map((r, i) => (
                  <tr key={i}>
                    <td className="font-mono text-indigo font-bold">{r.path_prefix}</td>
                    <td><span className="pool-chip">{r.pool}</span></td>
                    <td className="font-mono text-slate">{r.algorithm || 'tier-default'}</td>
                    <td><span className="badge-soft-neutral">{r.rate_limit_tier || 'auth-derived'}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Rate Limiting Tiers */}
        <div className="surface-card">
          <div className="surface-card-header">
            <div className="card-title-group">
              <Layers size={16} className="text-indigo" />
              <h3 className="card-title">Rate Limiting Tiers ({Object.keys(rate_limits).length})</h3>
            </div>
            <span className="badge-soft-emerald">Atomic Redis Lua</span>
          </div>

          <div className="table-wrapper">
            <table className="clean-table">
              <thead>
                <tr>
                  <th>Tier</th>
                  <th>Algorithm</th>
                  <th>Refill Rate</th>
                  <th>Burst Capacity</th>
                  <th>Window</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(rate_limits).map(([name, tier]) => (
                  <tr key={name}>
                    <td className="font-bold text-slate-dark">{name.toUpperCase()}</td>
                    <td className="font-mono text-slate">{tier.algorithm}</td>
                    <td className="font-mono font-bold text-indigo">{tier.rate} <span className="table-unit">tokens/s</span></td>
                    <td className="font-mono">{tier.burst} <span className="table-unit">burst</span></td>
                    <td className="text-slate">{tier.window || 'continuous'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Resilience & Health Settings */}
        <div className="surface-card">
          <div className="surface-card-header">
            <div className="card-title-group">
              <Shield size={16} className="text-indigo" />
              <h3 className="card-title">Resilience & Circuit Breaker Settings</h3>
            </div>
          </div>

          <div className="meta-key-value-list">
            <div className="meta-kv-item">
              <span className="kv-label">Failure Trip Threshold</span>
              <span className="kv-val font-mono">{breaker.consecutive_failures ?? 5} consecutive errors</span>
            </div>
            <div className="meta-kv-item">
              <span className="kv-label">Breaker Cooldown Duration</span>
              <span className="kv-val font-mono">{breaker.timeout ?? '10s'}</span>
            </div>
            <div className="meta-kv-item">
              <span className="kv-label">Half-Open Canary Quota</span>
              <span className="kv-val font-mono">{breaker.half_open_requests ?? 3} probes</span>
            </div>
            <div className="meta-kv-item">
              <span className="kv-label">Active Health Probe Interval</span>
              <span className="kv-val font-mono">{health.interval ?? '5s'}</span>
            </div>
            <div className="meta-kv-item">
              <span className="kv-label">Health Check HTTP Path</span>
              <span className="kv-val font-mono">{health.path ?? '/health'}</span>
            </div>
          </div>
        </div>

        {/* Upstream Pools */}
        <div className="surface-card">
          <div className="surface-card-header">
            <div className="card-title-group">
              <Server size={16} className="text-indigo" />
              <h3 className="card-title">Registered Upstream Pools ({Object.keys(pools).length})</h3>
            </div>
          </div>

          <div className="meta-key-value-list">
            {Object.entries(pools).map(([poolName, poolCfg]) => (
              <div key={poolName} className="meta-kv-item">
                <div>
                  <span className="font-bold text-slate-dark">{poolName}</span>
                  <span className="pool-sub-label"> ({poolCfg.upstreams?.length || 0} instances)</span>
                </div>
                <span className="badge-soft-blue font-mono">Strategy: {poolCfg.strategy}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
