import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { AlertTriangle, RotateCcw, Sparkles, ExternalLink, Server } from 'lucide-react';
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
      {/* Top Navbar with clear navigation tabs & controls */}
      <AdminAuthBar
        isDemoMode={isDemoMode}
        setIsDemoMode={setIsDemoMode}
        connectionError={connectionError}
        activeTab={activeTab}
        setActiveTab={setActiveTab}
      />

      <main className="narv-main">
        {/* Soft, friendly connection alert banner */}
        {connectionError && !isDemoMode && (
          <div className="clean-alert-banner">
            <div className="alert-content-left">
              <AlertTriangle size={18} className="text-rose alert-icon" />
              <div className="alert-text-block">
                <span className="alert-title font-semibold">Gateway Offline (:9091)</span>
                <span className="alert-desc text-muted">
                  Cannot connect to the live gateway. Switch to Simulation Mode to explore real-time graphs, chaos injection, and rate limiting with synthetic traffic.
                </span>
              </div>
            </div>
            <div className="alert-actions-right">
              <button
                type="button"
                className="btn-accent-sm font-medium"
                onClick={() => setIsDemoMode(true)}
              >
                <Sparkles size={13} />
                <span>Enable Simulation Mode</span>
              </button>
              <button
                type="button"
                className="btn-outline-sm font-mono"
                onClick={fetchState}
              >
                <RotateCcw size={12} />
                <span>Retry</span>
              </button>
            </div>
          </div>
        )}

        {/* Global Key Metrics Section */}
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
              <div className="section-hero-header">
                <div>
                  <div className="section-tag-row font-mono">
                    <span className="tag-orange">[TOPO. 01 / 04]</span>
                    <span className="tag-sep">&gt;</span>
                    <span className="tag-text">UPSTREAM TOPOLOGY &amp; FAULT INJECTION</span>
                  </div>

                  <h2 className="section-main-heading">
                    <span className="slash-accent">/ </span>
                    <span className="text-black">Zero cascading failures.</span>{' '}
                    <span className="text-muted-heading">Active load distribution and live fault induction.</span>
                    <span className="slash-accent"> /</span>
                  </h2>
                </div>

                <div className="topology-badge-pill font-mono">
                  <Server size={14} className="text-orange" />
                  <span>{Object.keys(pools).length} POOLS</span>
                  <span className="tag-sep">•</span>
                  <span>{upstreams.length} NODES</span>
                </div>
              </div>

              {Object.keys(pools).sort().map((poolName) => (
                <div key={poolName} className="pool-block-card">
                  <div className="pool-block-header font-mono">
                    <div className="pool-title-group">
                      <span className="pool-indicator-dot"></span>
                      <span className="pool-name-label">POOL: {poolName.toUpperCase()}</span>
                    </div>
                    <span className="pool-size-badge">{pools[poolName].length} Instances</span>
                  </div>

                  <div className="nodes-grid">
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
                <div className="soft-empty-state">
                  <div className="font-mono text-muted">
                    No active pools registered in gateway.yaml
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
              <ConfigViewer isDemoMode={isDemoMode} />
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {/* Modern Footer */}
      <footer className="modern-footer">
        <div className="footer-left font-mono">
          <span className="footer-dot-orange">■</span>
          <span className="footer-title">FLUX-GO CONTROL PLANE</span>
          <span className="footer-sep">//</span>
          <span className="footer-subtitle">ATOMIC REDIS LUA &amp; KETAMA RING</span>
        </div>
        <div className="footer-right">
          <a
            href="https://github.com/ANSUJKMEHER/Flux"
            target="_blank"
            rel="noreferrer"
            className="footer-github-link"
          >
            <span>GitHub Repository</span>
            <ExternalLink size={13} />
          </a>
        </div>
      </footer>
    </div>
  );
}

export default App;
