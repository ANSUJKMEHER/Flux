import React, { useState, useEffect, useRef } from 'react';
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

      // Simulate live jitter in demo mode
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
    <div className="dashboard-wrapper">
      {/* Global Top Navbar */}
      <AdminAuthBar
        isDemoMode={isDemoMode}
        setIsDemoMode={setIsDemoMode}
        connectionError={connectionError}
        activeTab={activeTab}
        setActiveTab={setActiveTab}
      />

      <main className="dashboard-content">
        {/* Offline Connection Alert Banner */}
        {connectionError && !isDemoMode && (
          <div className="banner-offline">
            <div className="banner-content">
              <span className="banner-icon">⚠️</span>
              <div>
                <strong>Gateway Control Plane Unreachable (Port :9091)</strong>
                <p>
                  Start the gateway backend with <code>go run cmd/gateway/main.go</code>, or enable{' '}
                  <button className="link-button" onClick={() => setIsDemoMode(true)}>
                    Demo Simulation Mode
                  </button>{' '}
                  to interact with the UI offline.
                </p>
              </div>
            </div>
            <button className="btn-secondary" onClick={fetchState}>
              Retry Connection
            </button>
          </div>
        )}

        {/* Global Statistics Bar */}
        <StatsBar stats={stats} upstreams={upstreams} />

        {/* TAB 1: Topology & Upstream Pools */}
        {activeTab === 'topology' && (
          <section className="tab-pane">
            <div className="pane-header">
              <div>
                <h2 className="section-title">Upstream Pools & Circuit Breaker Topology</h2>
                <p className="section-subtitle">
                  Real-time health telemetry, active in-flight connection tracking, and runtime chaos fault injection per upstream target.
                </p>
              </div>
              <div className="pane-stats-pill">
                <span>{Object.keys(pools).length} Pools</span>
                <span className="dot-sep">•</span>
                <span>{upstreams.length} Instances</span>
              </div>
            </div>

            {Object.keys(pools).sort().map(poolName => (
              <div key={poolName} className="pool-container">
                <div className="pool-header">
                  <div className="pool-title-group">
                    <span className="pool-icon">📦</span>
                    <h3 className="pool-name">{poolName}</h3>
                  </div>
                  <div className="pool-meta">
                    <span className="pool-badge">{pools[poolName].length} Instances</span>
                  </div>
                </div>

                <div className="upstreams-grid">
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
              <div className="empty-state">
                <div className="empty-icon">🔌</div>
                <h3>No Upstream Pools Registered</h3>
                <p>Ensure gateway routing and pools are defined in <code>configs/gateway.yaml</code>.</p>
              </div>
            )}
          </section>
        )}

        {/* TAB 2: Traffic & Rate Limit Simulator */}
        {activeTab === 'traffic' && (
          <section className="tab-pane">
            <TrafficGenerator onTrafficGenerated={fetchState} />
          </section>
        )}

        {/* TAB 3: Gateway Configuration */}
        {activeTab === 'config' && (
          <section className="tab-pane">
            <ConfigViewer />
          </section>
        )}
      </main>

      {/* Footer */}
      <footer className="dashboard-footer">
        <div className="footer-left">
          <span>Flux-GO Enterprise Control Plane</span>
          <span className="footer-dot">•</span>
          <span>Zero-Allocation Token Bucket & Sliding Window Log</span>
        </div>
        <div className="footer-right">
          <a href="https://github.com/ANSUJKMEHER/Flux" target="_blank" rel="noreferrer" className="footer-link">
            GitHub Repository
          </a>
        </div>
      </footer>
    </div>
  );
}

export default App;
