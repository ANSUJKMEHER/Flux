import React, { useState, useEffect } from 'react';
import ConnectionStatus from './components/ConnectionStatus';
import StatsBar from './components/StatsBar';
import UpstreamCard from './components/UpstreamCard';

function App() {
  const [upstreams, setUpstreams] = useState([]);
  const [breakers, setBreakers] = useState([]);
  const [stats, setStats] = useState({ total_requests: 0, total_429s: 0 });
  const [connectionError, setConnectionError] = useState(false);

  // Group upstreams by pool
  const pools = upstreams.reduce((acc, u) => {
    acc[u.pool] = acc[u.pool] || [];
    acc[u.pool].push(u);
    return acc;
  }, {});

  // Map breakers for O(1) lookup
  const cbMap = {};
  breakers.forEach(b => {
    cbMap[b.upstream] = b;
  });

  const fetchState = async () => {
    // In dev mode, we use relative paths if we assume vite proxy,
    // but the backend runs on port 9091. Let's make this robust.
    const baseUrl = window.location.port === "5173" ? "http://localhost:9091" : window.location.origin;
    
    try {
      const [resUp, resCb, resStats] = await Promise.all([
        fetch(`${baseUrl}/admin/upstreams`),
        fetch(`${baseUrl}/admin/breakers`),
        fetch(`${baseUrl}/admin/stats`)
      ]);
      
      const upData = await resUp.json();
      const cbData = await resCb.json();
      const statsData = await resStats.json();
      
      setUpstreams(upData || []);
      setBreakers(cbData || []);
      setStats(statsData || { total_requests: 0, total_429s: 0 });
      setConnectionError(false);
    } catch (e) {
      console.error("Polling error", e);
      setConnectionError(true);
    }
  };

  useEffect(() => {
    fetchState();
    const interval = setInterval(fetchState, 2000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="dashboard-container">
      <div className="dashboard-header">API Gateway Dashboard</div>
      
      <ConnectionStatus error={connectionError} />
      <StatsBar stats={stats} upstreams={upstreams} />
      
      {Object.keys(pools).sort().map(poolName => (
        <div key={poolName} style={{ marginBottom: '3rem' }}>
          <h2 style={{ fontSize: '1.25rem', marginBottom: '1rem', borderBottom: '1px solid var(--border)', paddingBottom: '0.5rem' }}>
            Pool: {poolName}
          </h2>
          <div className="upstreams-grid">
            {pools[poolName].map(up => (
              <UpstreamCard 
                key={up.id} 
                upstream={up} 
                breaker={cbMap[up.id]} 
              />
            ))}
          </div>
        </div>
      ))}
      
      {Object.keys(pools).length === 0 && !connectionError && (
        <div style={{ textAlign: 'center', marginTop: '4rem', color: 'var(--text-muted)' }}>
          No upstreams found. Ensure the gateway is running.
        </div>
      )}
    </div>
  );
}

export default App;
