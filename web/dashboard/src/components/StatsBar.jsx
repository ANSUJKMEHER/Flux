import React, { useEffect, useState } from 'react';

export default function StatsBar({ stats, upstreams }) {
  const [liveReqSec, setLiveReqSec] = useState(0);
  const [prevStats, setPrevStats] = useState(stats);

  useEffect(() => {
    if (prevStats.total_requests !== stats.total_requests) {
      // Delta over 2 seconds (polling interval)
      const delta = stats.total_requests - prevStats.total_requests;
      setLiveReqSec(Math.max(0, Math.floor(delta / 2)));
      setPrevStats(stats);
    }
  }, [stats]);

  const healthyCount = upstreams.filter(u => u.healthy).length;
  const totalCount = upstreams.length;

  return (
    <div className="stats-bar">
      <div className="stat-box">
        <h3>Total Requests</h3>
        <div className="value">{stats.total_requests || 0}</div>
      </div>
      <div className="stat-box">
        <h3>Rate Limited (429)</h3>
        <div className="value">{stats.total_429s || 0}</div>
      </div>
      <div className="stat-box">
        <h3>Live Throughput</h3>
        <div className="value">{liveReqSec} req/s</div>
      </div>
      <div className="stat-box">
        <h3>Global Health</h3>
        <div className="value" style={{ color: healthyCount === totalCount && totalCount > 0 ? 'var(--green)' : 'var(--orange)' }}>
          {healthyCount} / {totalCount} Up
        </div>
      </div>
    </div>
  );
}
