import React, { useState, useEffect, useCallback } from 'react';
import { RefreshCw, Route, Shield, Layers, Server, AlertCircle } from 'lucide-react';
import { fetchConfig } from '../api';
import { DEMO_CONFIG } from '../demoData';

export default function ConfigViewer({ isDemoMode }) {
  const [config, setConfig] = useState(isDemoMode ? DEMO_CONFIG : null);
  const [loading, setLoading] = useState(!isDemoMode);
  const [usingFallback, setUsingFallback] = useState(false);

  const loadConfig = useCallback(async () => {
    if (isDemoMode) {
      setConfig(DEMO_CONFIG);
      setLoading(false);
      setUsingFallback(false);
      return;
    }

    setLoading(true);
    try {
      const data = await fetchConfig();
      if (data && (data.routes || data.pools || data.rate_limits)) {
        setConfig(data);
        setUsingFallback(false);
      } else {
        setConfig(DEMO_CONFIG);
        setUsingFallback(true);
      }
    } catch (e) {
      console.warn("Failed to fetch runtime config, using local schema:", e.message);
      // Gracefully fall back to local config schema so the tab never breaks
      setConfig(DEMO_CONFIG);
      setUsingFallback(true);
    } finally {
      setLoading(false);
    }
  }, [isDemoMode]);

  useEffect(() => {
    loadConfig();
  }, [loadConfig]);

  const activeConfig = config || DEMO_CONFIG;
  const { routes = [], rate_limits = {}, breaker = {}, health = {}, pools = {} } = activeConfig;

  return (
    <section className="narv-section">
      {/* Section Header */}
      <div className="section-hero-header">
        <div>
          <div className="section-tag-row font-mono">
            <span className="tag-orange">[CONFIG. 03 / 04]</span>
            <span className="tag-sep">&gt;</span>
            <span className="tag-text">GATEWAY SPECIFICATION &amp; POLICIES</span>
          </div>

          <h2 className="section-main-heading">
            <span className="slash-accent">/ </span>
            <span className="text-black">Declarative routing &amp; tier limits.</span>{' '}
            <span className="text-muted-heading">Live runtime policies and breaker thresholds.</span>
            <span className="slash-accent"> /</span>
          </h2>
        </div>

        <button
          type="button"
          className="btn-soft-secondary font-mono"
          onClick={loadConfig}
          disabled={loading}
        >
          <RefreshCw size={13} className={loading ? 'spin-icon' : ''} />
          <span>{loading ? 'REFRESHING...' : 'REFRESH'}</span>
        </button>
      </div>

      {usingFallback && !isDemoMode && (
        <div className="info-banner-soft font-mono">
          <AlertCircle size={15} className="text-orange" />
          <span>Showing cached gateway specification (Live <code>/admin/config</code> requires admin token or is connecting).</span>
        </div>
      )}

      {/* 2x2 Clean Cards Grid */}
      <div className="narv-grid-two">
        {/* 1. Routing Rules */}
        <div className="soft-card">
          <div className="soft-card-header">
            <div className="card-title-with-icon">
              <Route size={16} className="text-orange" />
              <h3 className="soft-card-title">Routing Rules ({routes.length})</h3>
            </div>
            <span className="badge-pill-neutral font-mono">First-Match Wins</span>
          </div>

          <div className="soft-card-body table-scroll">
            <table className="clean-schema-table font-mono">
              <thead>
                <tr>
                  <th>PATH PREFIX</th>
                  <th>POOL</th>
                  <th>ALGORITHM</th>
                  <th>TIER</th>
                </tr>
              </thead>
              <tbody>
                {routes.map((r, i) => (
                  <tr key={i}>
                    <td className="text-orange font-bold">{r.path_prefix}</td>
                    <td><span className="pool-tag">{r.pool}</span></td>
                    <td className="text-muted">{r.algorithm || 'tier-default'}</td>
                    <td className="text-muted">{r.rate_limit_tier || 'auth-derived'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="soft-card-footer font-mono">
            DYNAMIC PREFIX MATCHING // STRIP_PREFIX SUPPORTED
          </div>
        </div>

        {/* 2. Rate Limiting Tiers */}
        <div className="soft-card">
          <div className="soft-card-header">
            <div className="card-title-with-icon">
              <Layers size={16} className="text-orange" />
              <h3 className="soft-card-title">Rate Limiting Tiers ({Object.keys(rate_limits).length})</h3>
            </div>
            <span className="badge-pill-orange font-mono">Atomic Redis Lua</span>
          </div>

          <div className="soft-card-body table-scroll">
            <table className="clean-schema-table font-mono">
              <thead>
                <tr>
                  <th>TIER</th>
                  <th>ALGORITHM</th>
                  <th>REFILL RATE</th>
                  <th>BURST</th>
                  <th>WINDOW</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(rate_limits).map(([name, tier]) => (
                  <tr key={name}>
                    <td className="text-black font-bold">// {name.toUpperCase()}</td>
                    <td>{tier.algorithm}</td>
                    <td className="text-orange font-bold">{tier.rate} rps</td>
                    <td className="text-black">{tier.burst}</td>
                    <td className="text-muted">{tier.window || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="soft-card-footer font-mono">
            ZERO RACE CONDITIONS // DISTRIBUTED REFILL
          </div>
        </div>

        {/* 3. Circuit Breaker Settings */}
        <div className="soft-card">
          <div className="soft-card-header">
            <div className="card-title-with-icon">
              <Shield size={16} className="text-orange" />
              <h3 className="soft-card-title">Resilience &amp; Circuit Breaker</h3>
            </div>
            <span className="badge-pill-emerald font-mono">FSM Active</span>
          </div>

          <div className="soft-card-body font-mono">
            <div className="kv-row">
              <span className="kv-k">FAILURE_TRIP_THRESHOLD:</span>
              <span className="kv-v text-orange font-bold">{breaker.consecutive_failures ?? 5} consecutive errors</span>
            </div>
            <div className="kv-row">
              <span className="kv-k">COOLDOWN_TIMEOUT:</span>
              <span className="kv-v">{breaker.timeout ?? '10s'} before half-open</span>
            </div>
            <div className="kv-row">
              <span className="kv-k">HALF_OPEN_CANARY_PROBES:</span>
              <span className="kv-v">{breaker.half_open_requests ?? 3} probe requests</span>
            </div>
            <div className="kv-row">
              <span className="kv-k">HEALTH_PROBE_INTERVAL:</span>
              <span className="kv-v">{health.interval ?? '5s'}</span>
            </div>
            <div className="kv-row">
              <span className="kv-k">HEALTH_PROBE_PATH:</span>
              <span className="kv-v">{health.path ?? '/health'}</span>
            </div>
          </div>
          <div className="soft-card-footer font-mono">
            HYSTERESIS CASCADE PREVENTION
          </div>
        </div>

        {/* 4. Upstream Pools */}
        <div className="soft-card">
          <div className="soft-card-header">
            <div className="card-title-with-icon">
              <Server size={16} className="text-orange" />
              <h3 className="soft-card-title">Registered Upstream Pools ({Object.keys(pools).length})</h3>
            </div>
            <span className="badge-pill-neutral font-mono">Load Balanced</span>
          </div>

          <div className="soft-card-body font-mono">
            {Object.entries(pools).map(([poolName, poolCfg]) => (
              <div key={poolName} className="kv-row">
                <span className="text-black font-bold">// {poolName}</span>
                <span className="text-orange font-bold">
                  [{poolCfg.strategy.toUpperCase()}] ({poolCfg.upstreams?.length || 0} NODES)
                </span>
              </div>
            ))}
          </div>
          <div className="soft-card-footer font-mono">
            KETAMA HASH RING // 150 VNODES
          </div>
        </div>
      </div>
    </section>
  );
}
