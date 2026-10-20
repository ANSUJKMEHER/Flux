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
      if (data && (data.routes || data.Routes || data.pools || data.Pools || data.rate_limits || data.RateLimits)) {
        setConfig(data);
        setUsingFallback(false);
      } else {
        setConfig(DEMO_CONFIG);
        setUsingFallback(true);
      }
    } catch (e) {
      console.warn("Failed to fetch runtime config, using local schema:", e.message);
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

  // Defensive field resolution supporting both snake_case and PascalCase
  const rawRoutes = activeConfig?.routes || activeConfig?.Routes || [];
  const routes = Array.isArray(rawRoutes) ? rawRoutes : [];

  const rawRateLimits = activeConfig?.rate_limits || activeConfig?.RateLimits || {};
  const rateLimits = (rawRateLimits && typeof rawRateLimits === 'object') ? rawRateLimits : {};

  const rawPools = activeConfig?.pools || activeConfig?.Pools || {};
  const pools = (rawPools && typeof rawPools === 'object') ? rawPools : {};

  const breaker = activeConfig?.breaker || activeConfig?.Breaker || {};
  const health = activeConfig?.health || activeConfig?.Health || {};

  // Formatted resilience values
  const failureThreshold = breaker?.failure_threshold ?? breaker?.FailureThreshold ?? breaker?.consecutive_failures ?? 5;
  let openTimeout = breaker?.open_timeout ?? breaker?.OpenTimeout ?? breaker?.timeout ?? '10s';
  if (typeof openTimeout === 'number') {
    openTimeout = `${openTimeout / 1e9}s`;
  }
  const canaryProbes = breaker?.success_threshold ?? breaker?.SuccessThreshold ?? breaker?.half_open_requests ?? 3;

  let probeInterval = health?.interval ?? health?.Interval ?? '5s';
  if (typeof probeInterval === 'number') {
    probeInterval = `${probeInterval / 1e9}s`;
  }
  const probePath = health?.path || health?.Path || '/health';

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
                {routes.map((r, i) => {
                  const prefix = r?.path_prefix || r?.PathPrefix || '/';
                  const pool = r?.pool || r?.Pool || '-';
                  const algo = r?.algorithm || r?.Algorithm || 'tier-default';
                  const tier = r?.rate_limit_tier || r?.RateLimitTier || 'auth-derived';
                  return (
                    <tr key={i}>
                      <td className="text-orange font-bold">{prefix}</td>
                      <td><span className="pool-tag">{pool}</span></td>
                      <td className="text-muted">{algo}</td>
                      <td className="text-muted">{tier}</td>
                    </tr>
                  );
                })}
                {routes.length === 0 && (
                  <tr>
                    <td colSpan={4} className="text-muted" style={{ textAlign: 'center', padding: '1.5rem' }}>
                      No routes registered
                    </td>
                  </tr>
                )}
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
              <h3 className="soft-card-title">Rate Limiting Tiers ({Object.keys(rateLimits).length})</h3>
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
                {Object.entries(rateLimits).map(([name, tier]) => {
                  const algo = tier?.algorithm || tier?.Algorithm || '-';
                  const rate = tier?.rate ?? tier?.Rate ?? '-';
                  const burst = tier?.burst ?? tier?.Burst ?? '-';
                  let windowVal = tier?.window || tier?.Window || '-';
                  if (typeof windowVal === 'number') {
                    windowVal = `${windowVal / 1e9}s`;
                  }
                  return (
                    <tr key={name}>
                      <td className="text-black font-bold">// {String(name).toUpperCase()}</td>
                      <td>{algo}</td>
                      <td className="text-orange font-bold">{rate} rps</td>
                      <td className="text-black">{burst}</td>
                      <td className="text-muted">{windowVal}</td>
                    </tr>
                  );
                })}
                {Object.keys(rateLimits).length === 0 && (
                  <tr>
                    <td colSpan={5} className="text-muted" style={{ textAlign: 'center', padding: '1.5rem' }}>
                      No tiers defined
                    </td>
                  </tr>
                )}
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
              <span className="kv-v text-orange font-bold">{failureThreshold} consecutive errors</span>
            </div>
            <div className="kv-row">
              <span className="kv-k">COOLDOWN_TIMEOUT:</span>
              <span className="kv-v">{openTimeout} before half-open</span>
            </div>
            <div className="kv-row">
              <span className="kv-k">HALF_OPEN_CANARY_PROBES:</span>
              <span className="kv-v">{canaryProbes} probe requests</span>
            </div>
            <div className="kv-row">
              <span className="kv-k">HEALTH_PROBE_INTERVAL:</span>
              <span className="kv-v">{probeInterval}</span>
            </div>
            <div className="kv-row">
              <span className="kv-k">HEALTH_PROBE_PATH:</span>
              <span className="kv-v">{probePath}</span>
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
            {Object.entries(pools).map(([poolName, poolCfg]) => {
              const rawStrategy = poolCfg?.strategy || poolCfg?.Strategy || 'round_robin';
              const strategy = String(rawStrategy).toUpperCase();
              const upstreamsList = poolCfg?.upstreams || poolCfg?.Upstreams || [];
              const nodeCount = Array.isArray(upstreamsList) ? upstreamsList.length : 0;
              return (
                <div key={poolName} className="kv-row">
                  <span className="text-black font-bold">// {poolName}</span>
                  <span className="text-orange font-bold">
                    [{strategy}] ({nodeCount} NODES)
                  </span>
                </div>
              );
            })}
            {Object.keys(pools).length === 0 && (
              <div className="text-muted" style={{ textAlign: 'center', padding: '1rem' }}>
                No pools registered
              </div>
            )}
          </div>
          <div className="soft-card-footer font-mono">
            KETAMA HASH RING // 150 VNODES
          </div>
        </div>
      </div>
    </section>
  );
}
