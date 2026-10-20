import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Layers, AlertTriangle, Server, ArrowRight, ShieldCheck } from 'lucide-react';
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
  breakers.forEach(b => {
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
      console.warn("Gateway polling error:", e.message);
      setConnectionError(true);
    }
  }, [isDemoMode]);

  // Polling loop
  useEffect(() => {
    if (isDemoMode) {
      setUpstreams(DEMO_UPSTREAMS);
      setBreakers(DEMO_BREAKERS);
      setStats({ total_requests: 48520, total_429s: 142 });
      setConnectionError(false);

      demoIntervalRef.current = setInterval(() => {
        setStats(prev => ({
          total_requests: prev.total_requests + Math.floor(Math.random() * 25) + 5,
          total_429s: prev.total_429s + (Math.random() > 0.8 ? 1 : 0),
        }));
        setUpstreams(prev =>
          prev.map(u => ({
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
    <div className="dashboard-light-wrapper">
      {/* Global Top Navbar */}
      <AdminAuthBar
        isDemoMode={isDemoMode}
        setIsDemoMode={setIsDemoMode}
        connectionError={connectionError}
        activeTab={activeTab}
        setActiveTab={setActiveTab}
      />

      <main className="dashboard-main-content">
        {/* Offline Connection Alert Banner */}
        {connectionError && !isDemoMode && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            className="clean-alert-banner"
          >
            <div className="alert-content-left">
              <div className="alert-icon-circle">
                <AlertTriangle size={18} />
              </div>
              <div>
                <h4 className="alert-heading">Gateway Control Plane Offline (Port :9091)</h4>
                <p className="alert-message">
                  Unable to poll gateway telemetry. Start the backend with <code>go run cmd/gateway/main.go</code> or enable{' '}
                  <button className="inline-action-btn" onClick={() => setIsDemoMode(true)}>
                    Demo Simulation Mode
                  </button>{' '}
                  to interact with the UI offline.
                </p>
              </div>
            </div>
            <button className="btn-light-secondary" onClick={fetchState}>
              Retry Connection
            </button>
          </motion.div>
        )}

        {/* Global Statistics KPI Bar */}
        <StatsBar stats={stats} upstreams={upstreams} />

        {/* Animated Tab Views */}
        <AnimatePresence mode="wait">
          {activeTab === 'topology' && (
            <motion.section
              key="topology"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.25 }}
              className="tab-view-container"
            >
              <div className="view-header">
                <div>
                  <h2 className="view-title">Upstream Pools & Circuit Breakers</h2>
                  <p className="view-subtitle">
                    Active socket load monitoring, dynamic health check telemetry, and runtime fault injection per target node.
                  </p>
                </div>
                <div className="view-meta-pills">
                  <span className="meta-pill">{Object.keys(pools).length} Pools</span>
                  <span className="meta-pill">{upstreams.length} Instances</span>
                </div>
              </div>

              {Object.keys(pools).sort().map(poolName => (
                <div key={poolName} className="pool-card-group">
                  <div className="pool-card-header">
                    <div className="pool-heading-left">
                      <div className="pool-icon-badge">
                        <Layers size={16} />
                      </div>
                      <h3 className="pool-title">{poolName}</h3>
                    </div>
                    <span className="badge-soft-blue">{pools[poolName].length} Targets</span>
                  </div>

                  <div className="upstreams-grid-layout">
                    {pools[poolName].map(up => (
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
                <div className="empty-panel-box">
                  <Server size={32} className="empty-icon-subtle" />
                  <h3>No Upstream Pools Registered</h3>
                  <p>Check gateway routing and pools configured in <code>configs/gateway.yaml</code>.</p>
                </div>
              )}
            </motion.section>
          )}

          {activeTab === 'traffic' && (
            <motion.section
              key="traffic"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.25 }}
              className="tab-view-container"
            >
              <TrafficGenerator onTrafficGenerated={fetchState} />
            </motion.section>
          )}

          {activeTab === 'config' && (
            <motion.section
              key="config"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.25 }}
              className="tab-view-container"
            >
              <ConfigViewer />
            </motion.section>
          )}
        </AnimatePresence>
      </main>

      {/* Modern Clean Footer */}
      <footer className="dashboard-light-footer">
        <div className="footer-left-content">
          <ShieldCheck size={14} className="text-emerald" />
          <span>Flux-GO Enterprise Control Plane</span>
          <span className="footer-divider">•</span>
          <span>Zero-Allocation Token Bucket & Sliding Window Log</span>
        </div>
        <div className="footer-right-content">
          <a
            href="https://github.com/ANSUJKMEHER/Flux"
            target="_blank"
            rel="noreferrer"
            className="footer-nav-link"
          >
            GitHub Repository <ArrowRight size={12} className="inline-arrow" />
          </a>
        </div>
      </footer>
    </div>
  );
}

export default App;
