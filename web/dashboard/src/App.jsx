import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import AdminAuthBar from './components/AdminAuthBar';
import StatsBar from './components/StatsBar';
import UpstreamCard from './components/UpstreamCard';
import TrafficGenerator from './components/TrafficGenerator';
import ConfigViewer from './components/ConfigViewer';
import { fetchUpstreams, fetchBreakers, fetchStats, getDemoMode, setDemoMode as persistDemoMode } from './api';
import { DEMO_UPSTREAMS, DEMO_BREAKERS } from './demoData';

function App() {
  const [upstreams, setUpstreams] = useState([]);
  const [breakers, setBreakers] = useState([]);
  const [stats, setStats] = useState({ total_requests: 0, total_429s: 0 });
  const [connectionError, setConnectionError] = useState(false);
  const [activeTab, setActiveTab] = useState('topology');
  const [isDemoMode, setIsDemoModeState] = useState(getDemoMode());

  const demoIntervalRef = useRef(null);

  const setIsDemoMode = (enabled) => {
    setIsDemoModeState(enabled);
    persistDemoMode(enabled);
  };

  // Group upstreams by pool
  const pools = upstreams.reduce((acc, u) => {
    const poolName = u.pool || 'default-pool';
    acc[poolName] = acc[poolName] || [];
    acc[poolName].push(u);
    return acc;
  }, {});

  // Map breakers for O(1) lookup
  const cbMap = {};
  breakers.forEach((b) => {
    cbMap[b.upstream] = b;
  });

  // Polling logic for real backend
  const fetchState = React.useCallback(async () => {
    if (isDemoMode) return;
    try {
      const [upData, cbData, statsData] = await Promise.all([
        fetchUpstreams(),
        fetchBreakers(),
        fetchStats(),
      ]);

      setUpstreams(upData || []);
      setBreakers(cbData || []);
      setStats(statsData || { total_requests: 0, total_429s: 0 });
      setConnectionError(false);
    } catch (e) {
      console.warn('Gateway polling error:', e.message);
      setConnectionError(true);
    }
  }, [isDemoMode]);

  useEffect(() => {
    if (isDemoMode) {
      setUpstreams(DEMO_UPSTREAMS);
      setBreakers(DEMO_BREAKERS);
      setStats({ total_requests: 48520, total_429s: 142 });
      setConnectionError(false);

      demoIntervalRef.current = setInterval(() => {
        setStats((prev) => ({
          total_requests: prev.total_requests + Math.floor(Math.random() * 25) + 5,
          total_429s: prev.total_429s + (Math.random() > 0.8 ? 1 : 0),
        }));
        setUpstreams((prev) =>
          prev.map((u) => ({
            ...u,
            active_connections: Math.max(0, u.active_connections + Math.floor(Math.random() * 3) - 1),
          }))
        );
      }, 2000);

      return () => {
        if (demoIntervalRef.current) clearInterval(demoIntervalRef.current);
      };
    } else {
      fetchState();
      const interval = setInterval(fetchState, 2000);
      return () => clearInterval(interval);
    }
  }, [isDemoMode, fetchState]);

  return (
    <div className="narv-app-wrapper">
      {/* Top Terminal Strip Navigation */}
      <AdminAuthBar
        isDemoMode={isDemoMode}
        setIsDemoMode={setIsDemoMode}
        connectionError={connectionError}
        activeTab={activeTab}
        setActiveTab={setActiveTab}
      />

      <main className="narv-main">
        {/* Connection Notice */}
        {connectionError && !isDemoMode && (
          <div className="narv-notice-banner font-mono">
            <span className="text-rose font-bold">[WARN. 01]</span>
            <span>Gateway offline on :9091. Run <code>go run cmd/gateway/main.go</code> or enable</span>
            <button className="narv-link-btn" onClick={() => setIsDemoMode(true)}>
              [ SIMULATION MODE ]
            </button>
            <button className="narv-btn-black font-mono text-xs ml-auto" onClick={fetchState}>
              [ RETRY ]
            </button>
          </div>
        )}

        {/* Global KPI Metrics Section (The 4 Cards) */}
        <StatsBar stats={stats} upstreams={upstreams} />

        {/* Dynamic Tab Views */}
        <AnimatePresence mode="wait">
          {activeTab === 'topology' && (
            <motion.section
              key="topology"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.2 }}
              className="narv-section"
            >
              <div className="narv-hero-header">
                <div className="narv-sub-tag font-mono">
                  <span className="text-orange">[TOPO. 01 / 04]</span>
                  <span className="narv-status-sep">&gt;</span>
                  <span className="text-dark font-bold">UPSTREAM TOPOLOGY &amp; FAULT INJECTION</span>
                </div>

                <div className="narv-header-action-row">
                  <h2 className="narv-slashed-heading">
                    <span className="slash-token">/ </span>
                    <span className="heading-bold">Zero cascading failures.</span>{' '}
                    <span className="heading-muted">Active load distribution and live fault induction.</span>
                    <span className="slash-token"> /</span>
                  </h2>

                  <div className="narv-header-btns font-mono text-xs text-muted">
                    <span>{Object.keys(pools).length} POOLS // {upstreams.length} NODES</span>
                  </div>
                </div>
              </div>

              {Object.keys(pools).sort().map((poolName) => (
                <div key={poolName} className="narv-pool-block">
                  <div className="narv-pool-header font-mono">
                    <span className="narv-pool-badge text-orange">&gt; POOL: {poolName.toUpperCase()}</span>
                    <span className="text-muted text-xs">[{pools[poolName].length} INSTANCES]</span>
                  </div>

                  <div className="narv-nodes-grid">
                    {pools[poolName].map((up) => (
                      <UpstreamCard
                        key={up.id}
                        upstream={up}
                        breaker={cbMap[up.id] || cbMap[up.url]}
                        onChaosApplied={fetchState}
                      />
                    ))}
                  </div>
                </div>
              ))}

              {Object.keys(pools).length === 0 && !connectionError && (
                <div className="narv-box">
                  <div className="narv-empty font-mono">
                    [ No active pools registered in gateway.yaml ]
                  </div>
                </div>
              )}
            </motion.section>
          )}

          {activeTab === 'traffic' && (
            <motion.div
              key="traffic"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.2 }}
            >
              <TrafficGenerator onTrafficGenerated={fetchState} />
            </motion.div>
          )}

          {activeTab === 'config' && (
            <motion.div
              key="config"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.2 }}
            >
              <ConfigViewer />
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {/* Terminal Minimalist Footer */}
      <footer className="narv-footer font-mono">
        <div className="narv-footer-left">
          <span className="text-orange">■</span>
          <span>FLUX-GO CONTROL PLANE</span>
          <span className="text-muted">//</span>
          <span className="text-muted">ATOMIC REDIS LUA &amp; KETAMA RING</span>
        </div>
        <div className="narv-footer-right">
          <a
            href="https://github.com/ANSUJKMEHER/Flux"
            target="_blank"
            rel="noreferrer"
            className="narv-footer-link"
          >
            [ GITHUB REPOSITORY ↗ ]
          </a>
        </div>
      </footer>
    </div>
  );
}

export default App;
