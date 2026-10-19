import React, { useState, useEffect } from 'react';
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
      <div className="config-panel">
        <div className="empty-hint">Loading gateway configuration from `/admin/config`...</div>
      </div>
    );
  }

  if (error || !config) {
    return (
      <div className="config-panel">
        <div className="banner-warn">
          <span>Failed to load configuration: {error || 'No data'}</span>
          <button className="btn-secondary" onClick={loadConfig} style={{ marginLeft: '1rem' }}>
            Retry
          </button>
        </div>
      </div>
    );
  }

  const { routes = [], rate_limits = {}, breaker = {}, health = {}, pools = {} } = config;

  return (
    <div className="config-panel">
      <div className="config-header">
        <div>
          <h2 className="section-title">Gateway Configuration Inspector</h2>
          <p className="section-subtitle">
            Sanitized live configuration from <code>/admin/config</code>. All sensitive credentials and secrets are automatically redacted by the admin control plane.
          </p>
        </div>
        <button className="btn-secondary" onClick={loadConfig}>
          Refresh Config
        </button>
      </div>

      <div className="config-grid">
        {/* Routing Rules */}
        <div className="config-card">
          <h3 className="config-card-title">Routing Rules ({routes.length})</h3>
          <div className="table-responsive">
            <table className="config-table">
              <thead>
                <tr>
                  <th>Path Prefix</th>
                  <th>Pool Target</th>
                  <th>Algorithm Override</th>
                  <th>Tier Override</th>
                </tr>
              </thead>
              <tbody>
                {routes.map((r, i) => (
                  <tr key={i}>
                    <td className="font-mono text-cyan">{r.path_prefix}</td>
                    <td><span className="badge-pool">{r.pool}</span></td>
                    <td className="font-mono">{r.algorithm || 'tier-default'}</td>
                    <td>{r.rate_limit_tier || 'auth-derived'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Rate Limiting Tiers */}
        <div className="config-card">
          <h3 className="config-card-title">Rate Limiting Tiers ({Object.keys(rate_limits).length})</h3>
          <div className="table-responsive">
            <table className="config-table">
              <thead>
                <tr>
                  <th>Tier Name</th>
                  <th>Algorithm</th>
                  <th>Rate (Refill)</th>
                  <th>Burst Capacity</th>
                  <th>Window</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(rate_limits).map(([name, tier]) => (
                  <tr key={name}>
                    <td className="font-bold text-accent">{name.toUpperCase()}</td>
                    <td className="font-mono">{tier.algorithm}</td>
                    <td><span className="font-mono">{tier.rate}</span> tokens/s</td>
                    <td><span className="font-mono">{tier.burst}</span> burst</td>
                    <td>{tier.window || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Circuit Breaker & Health Monitoring */}
        <div className="config-card">
          <h3 className="config-card-title">Resilience & Health Settings</h3>
          <div className="meta-list">
            <div className="meta-item">
              <span className="meta-label">Breaker Consecutive Failures:</span>
              <span className="meta-val font-mono">{breaker.consecutive_failures ?? 5}</span>
            </div>
            <div className="meta-item">
              <span className="meta-label">Breaker Trip Timeout:</span>
              <span className="meta-val font-mono">{breaker.timeout ?? '10s'}</span>
            </div>
            <div className="meta-item">
              <span className="meta-label">Half-Open Canary Requests:</span>
              <span className="meta-val font-mono">{breaker.half_open_requests ?? 3}</span>
            </div>
            <div className="meta-item">
              <span className="meta-label">Health Check Interval:</span>
              <span className="meta-val font-mono">{health.interval ?? '5s'}</span>
            </div>
            <div className="meta-item">
              <span className="meta-label">Health Check Path:</span>
              <span className="meta-val font-mono">{health.path ?? '/health'}</span>
            </div>
          </div>
        </div>

        {/* Upstream Pools */}
        <div className="config-card">
          <h3 className="config-card-title">Upstream Pools ({Object.keys(pools).length})</h3>
          <div className="meta-list">
            {Object.entries(pools).map(([poolName, poolCfg]) => (
              <div key={poolName} className="meta-item">
                <span className="meta-label font-bold">{poolName}:</span>
                <span className="meta-val">
                  Strategy: <code className="text-cyan">{poolCfg.strategy}</code> | Targets: {poolCfg.upstreams?.length || 0}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
