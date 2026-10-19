import React, { useEffect, useState, useRef } from 'react';

// Lightweight zero-dep SVG sparkline component
function Sparkline({ data, color = '#3b82f6', height = 36, width = 120 }) {
  if (!data || data.length < 2) {
    return (
      <svg width={width} height={height} className="sparkline-svg">
        <line x1="0" y1={height / 2} x2={width} y2={height / 2} stroke="rgba(255,255,255,0.1)" strokeDasharray="3 3" />
      </svg>
    );
  }

  const max = Math.max(...data, 1);
  const min = Math.min(...data, 0);
  const range = max - min || 1;

  const points = data.map((val, index) => {
    const x = (index / (data.length - 1)) * width;
    const y = height - ((val - min) / range) * (height - 8) - 4;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });

  const polylineStr = points.join(' ');
  const areaPoints = [`0,${height}`, ...points, `${width},${height}`].join(' ');

  return (
    <svg width={width} height={height} className="sparkline-svg">
      <defs>
        <linearGradient id={`grad-${color.replace('#', '')}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.35" />
          <stop offset="100%" stopColor={color} stopOpacity="0.0" />
        </linearGradient>
      </defs>
      <polygon points={areaPoints} fill={`url(#grad-${color.replace('#', '')})`} />
      <polyline
        fill="none"
        stroke={color}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        points={polylineStr}
      />
    </svg>
  );
}

export default function StatsBar({ stats, upstreams }) {
  const [liveReqSec, setLiveReqSec] = useState(0);
  const [historyReqSec, setHistoryReqSec] = useState([0, 0, 0, 0, 0]);
  const [history429, setHistory429] = useState([0, 0, 0, 0, 0]);
  const prevStatsRef = useRef(stats);

  useEffect(() => {
    const prev = prevStatsRef.current;
    if (prev && stats) {
      const deltaReq = Math.max(0, (stats.total_requests || 0) - (prev.total_requests || 0));
      const delta429 = Math.max(0, (stats.total_429s || 0) - (prev.total_429s || 0));
      
      // Polling interval is approx 2s
      const reqPerSec = Math.round(deltaReq / 2);
      setLiveReqSec(reqPerSec);

      setHistoryReqSec(prevHist => {
        const next = [...prevHist, reqPerSec];
        return next.length > 25 ? next.slice(next.length - 25) : next;
      });

      setHistory429(prevHist => {
        const next = [...prevHist, delta429];
        return next.length > 25 ? next.slice(next.length - 25) : next;
      });
    }
    prevStatsRef.current = stats;
  }, [stats]);

  const healthyCount = upstreams.filter(u => u.healthy).length;
  const totalCount = upstreams.length;
  const totalActiveConns = upstreams.reduce((acc, u) => acc + (u.active_connections || 0), 0);

  const totalReq = stats.total_requests || 0;
  const total429 = stats.total_429s || 0;
  const rejectRate = totalReq > 0 ? ((total429 / totalReq) * 100).toFixed(1) : '0.0';

  return (
    <div className="stats-bar-container">
      {/* 1. Total Requests Card */}
      <div className="stat-card">
        <div className="stat-card-header">
          <span className="stat-label">Total Ingested</span>
          <span className="stat-badge badge-blue">ALL TIME</span>
        </div>
        <div className="stat-card-body">
          <div className="stat-value">{totalReq.toLocaleString()}</div>
          <div className="stat-subtext">Cumulative across pools</div>
        </div>
      </div>

      {/* 2. Rate Limited Card */}
      <div className="stat-card">
        <div className="stat-card-header">
          <span className="stat-label">Rate Limited (429)</span>
          <span className={`stat-badge ${total429 > 0 ? 'badge-amber' : 'badge-neutral'}`}>
            {rejectRate}% REJECTED
          </span>
        </div>
        <div className="stat-card-body">
          <div className="stat-value" style={{ color: total429 > 0 ? 'var(--orange)' : 'var(--text-main)' }}>
            {total429.toLocaleString()}
          </div>
          <div className="stat-chart-wrapper">
            <Sparkline data={history429} color="#f59e0b" width={110} height={28} />
          </div>
        </div>
      </div>

      {/* 3. Live Throughput Card */}
      <div className="stat-card">
        <div className="stat-card-header">
          <span className="stat-label">Throughput</span>
          <span className="stat-badge badge-emerald">LIVE</span>
        </div>
        <div className="stat-card-body">
          <div className="stat-value">
            {liveReqSec} <span className="stat-unit">req/s</span>
          </div>
          <div className="stat-chart-wrapper">
            <Sparkline data={historyReqSec} color="#10b981" width={110} height={28} />
          </div>
        </div>
      </div>

      {/* 4. Global Upstream Health Card */}
      <div className="stat-card">
        <div className="stat-card-header">
          <span className="stat-label">Cluster Health</span>
          <span className={`stat-badge ${healthyCount === totalCount && totalCount > 0 ? 'badge-emerald' : 'badge-amber'}`}>
            {totalActiveConns} CONNS
          </span>
        </div>
        <div className="stat-card-body">
          <div 
            className="stat-value"
            style={{ color: healthyCount === totalCount && totalCount > 0 ? 'var(--green)' : 'var(--orange)' }}
          >
            {healthyCount} / {totalCount}
            <span className="stat-unit" style={{ color: 'var(--text-muted)', marginLeft: '6px' }}>UP</span>
          </div>
          <div className="stat-subtext">
            {totalCount === 0 ? 'No upstreams registered' : healthyCount === totalCount ? 'All instances operational' : 'Degraded nodes detected'}
          </div>
        </div>
      </div>
    </div>
  );
}
