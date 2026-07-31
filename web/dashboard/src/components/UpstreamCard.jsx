import React, { useState } from 'react';

const chaosLocalPorts = {
  "mock-a": 9001,
  "mock-b": 9002,
  "mock-c": 9003
};

export default function UpstreamCard({ upstream, breaker }) {
  const [chaosValue, setChaosValue] = useState(0);
  const [applying, setApplying] = useState(false);

  const applyChaos = async () => {
    setApplying(true);
    const errorRate = parseInt(chaosValue, 10) / 100.0;
    
    // Fallback for local testing when not behind Caddy
    let targetUrl = `/chaos/${upstream.id.replace(/users-|orders-|products-/, 'mock-')}`;
    const port = window.location.port;
    if (port === "9091" || port === "5173") {
      // Map the generic pool ID to a mock ID
      const mockId = upstream.url.includes('upstream-a') ? 'mock-a' :
                     upstream.url.includes('upstream-b') ? 'mock-b' :
                     upstream.url.includes('upstream-c') ? 'mock-c' : null;
      if (mockId) {
        targetUrl = `http://localhost:${chaosLocalPorts[mockId]}/chaos`;
      }
    }

    try {
      await fetch(targetUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error_rate: errorRate })
      });
      setTimeout(() => setApplying(false), 500); // Visual fire feedback
    } catch (e) {
      console.error("Chaos injection failed", e);
      setApplying(false);
    }
  };

  const getBadgeClass = (state) => {
    switch(state.toLowerCase()) {
      case 'closed': return 'badge-green';
      case 'open': return 'badge-red';
      case 'half-open': return 'badge-orange';
      default: return 'badge-green';
    }
  };

  const breakerState = breaker ? breaker.state : 'closed';

  return (
    <div className="upstream-card">
      <div className="upstream-header">
        <h3 className="upstream-title">{upstream.id}</h3>
        <span className={`badge ${upstream.healthy ? 'badge-green' : 'badge-red'}`}>
          {upstream.healthy ? 'HEALTHY' : 'UNHEALTHY'}
        </span>
      </div>
      
      <div className="info-row">
        <span>URL</span>
        <span>{upstream.url}</span>
      </div>
      
      <div className="info-row">
        <span>Active Connections</span>
        <span>{upstream.active_connections}</span>
      </div>
      
      <div className="info-row">
        <span>Circuit Breaker</span>
        <span className={`badge ${getBadgeClass(breakerState)}`}>
          {breakerState.toUpperCase()}
        </span>
      </div>
      
      <div className="chaos-control">
        <div className="chaos-label">
          <span>Chaos (Error Rate)</span>
          <span>{chaosValue}%</span>
        </div>
        <div className="slider-container">
          <input 
            type="range" 
            min="0" max="100" 
            value={chaosValue} 
            onChange={(e) => setChaosValue(e.target.value)}
          />
          <button 
            className="btn-apply" 
            onClick={applyChaos}
            style={{ backgroundColor: applying ? 'var(--green)' : '' }}
          >
            {applying ? 'Applied!' : 'Apply'}
          </button>
        </div>
      </div>
    </div>
  );
}
