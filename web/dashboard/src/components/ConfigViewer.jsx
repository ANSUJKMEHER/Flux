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
      <div className="narv-box">
        <div className="narv-empty font-mono">
          [ Fetching sanitized configuration from /admin/config... ]
        </div>
      </div>
    );
  }

  if (error || !config) {
    return (
      <div className="narv-box">
        <div className="narv-empty font-mono text-rose">
          [ Error loading configuration: {error || 'No data'} ]
          <div style={{ marginTop: '0.75rem' }}>
            <button className="narv-btn-black font-mono text-xs" onClick={loadConfig}>
              [ RETRY ]
            </button>
          </div>
        </div>
      </div>
    );
  }

  const { routes = [], rate_limits = {}, breaker = {}, health = {}, pools = {} } = config;

  return (
    <section className="narv-section">
      {/* Header */}
      <div className="narv-hero-header">
        <div className="narv-sub-tag font-mono">
          <span className="text-orange">[CFG. 03 / 04]</span>
          <span className="narv-status-sep">&gt;</span>
          <span className="text-dark font-bold">GATEWAY CONFIGURATION SCHEMAS</span>
        </div>

        <div className="narv-header-action-row">
          <h1 className="narv-slashed-heading">
            <span className="slash-token">/ </span>
            <span className="heading-bold">Sanitized runtime rules.</span>{' '}
            <span className="heading-muted">First-match routing, token algorithms, and breaker parameters.</span>
            <span className="slash-token"> /</span>
          </h1>

          <button
            type="button"
            className="narv-btn-pill font-mono"
            onClick={loadConfig}
          >
            [ REFRESH CONFIG ]
          </button>
        </div>
      </div>

      <div className="narv-grid-two">
        {/* Routing Rules */}
        <div className="narv-box">
          <div className="narv-box-header">
            <span className="font-mono text-orange text-xs">[ROUTES. 01] &gt; FIRST_MATCH_ROUTING ({routes.length})</span>
          </div>
          <div className="narv-box-body">
            <table className="narv-table font-mono">
              <thead>
                <tr>
                  <th>PATH PREFIX</th>
                  <th>POOL</th>
                  <th>ALGO</th>
                  <th>TIER</th>
                </tr>
              </thead>
              <tbody>
                {routes.map((r, i) => (
                  <tr key={i}>
                    <td className="text-orange font-bold">{r.path_prefix}</td>
                    <td>[{r.pool}]</td>
                    <td>{r.algorithm || 'default'}</td>
                    <td className="text-muted">{r.rate_limit_tier || 'auth-derived'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="narv-box-footer font-mono">
              DYNAMIC PREFIX PATH RESOLUTION
            </div>
          </div>
        </div>

        {/* Rate Limiting Tiers */}
        <div className="narv-box">
          <div className="narv-box-header">
            <span className="font-mono text-orange text-xs">[TIERS. 02] &gt; RATE_LIMIT_TIERS ({Object.keys(rate_limits).length})</span>
          </div>
          <div className="narv-box-body">
            <table className="narv-table font-mono">
              <thead>
                <tr>
                  <th>TIER</th>
                  <th>ALGO</th>
                  <th>REFILL</th>
                  <th>BURST</th>
                  <th>WINDOW</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(rate_limits).map(([name, tier]) => (
                  <tr key={name}>
                    <td className="text-dark font-bold">// {name.toUpperCase()}</td>
                    <td>{tier.algorithm}</td>
                    <td className="text-orange">{tier.rate} rps</td>
                    <td>{tier.burst}</td>
                    <td className="text-muted">{tier.window || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="narv-box-footer font-mono">
              ATOMIC REDIS LUA RATE LIMITING
            </div>
          </div>
        </div>

        {/* Circuit Breaker & Health Settings */}
        <div className="narv-box">
          <div className="narv-box-header">
            <span className="font-mono text-orange text-xs">[RESILIENCE. 03] &gt; FSM_THRESHOLDS</span>
          </div>
          <div className="narv-box-body font-mono">
            <div className="narv-kv-strip">
              <span className="text-muted">FAILURE_TRIP_THRESHOLD:</span>
              <span className="text-orange font-bold">{breaker.consecutive_failures ?? 5} CONSECUTIVE</span>
            </div>
            <div className="narv-kv-strip">
              <span className="text-muted">OPEN_STATE_COOLDOWN:</span>
              <span className="text-dark font-bold">{breaker.timeout ?? '10s'}</span>
            </div>
            <div className="narv-kv-strip">
              <span className="text-muted">CANARY_HALF_OPEN_PROBES:</span>
              <span className="text-dark font-bold">{breaker.half_open_requests ?? 3} PROBES</span>
            </div>
            <div className="narv-kv-strip">
              <span className="text-muted">HEALTH_CHECK_INTERVAL:</span>
              <span className="text-dark font-bold">{health.interval ?? '5s'}</span>
            </div>
            <div className="narv-kv-strip">
              <span className="text-muted">HEALTH_CHECK_PATH:</span>
              <span className="text-dark font-bold">{health.path ?? '/health'}</span>
            </div>
            <div className="narv-box-footer font-mono">
              HYSTERESIS CASCADE PREVENTION
            </div>
          </div>
        </div>

        {/* Upstream Pools */}
        <div className="narv-box">
          <div className="narv-box-header">
            <span className="font-mono text-orange text-xs">[POOLS. 04] &gt; REGISTERED_POOLS ({Object.keys(pools).length})</span>
          </div>
          <div className="narv-box-body font-mono">
            {Object.entries(pools).map(([poolName, poolCfg]) => (
              <div key={poolName} className="narv-kv-strip">
                <span className="text-dark font-bold">// {poolName}</span>
                <span className="text-orange font-bold">[{poolCfg.strategy.toUpperCase()}] ({poolCfg.upstreams?.length || 0} NODES)</span>
              </div>
            ))}
            <div className="narv-box-footer font-mono">
              LOAD BALANCING TOPOLOGY
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
