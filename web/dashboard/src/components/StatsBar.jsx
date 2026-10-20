import React, { useEffect, useState, useRef } from 'react';
import { motion } from 'motion/react';
import { TrendingUp, AlertOctagon, Gauge, Server } from 'lucide-react';

// Refined lightweight SVG sparkline for modern light mode
function Sparkline({ data, color = '#4f46e5', height = 38, width = 130 }) {
  if (!data || data.length < 2) {
    return (
      <svg width={width} height={height} className="sparkline-svg">
        <line x1="0" y1={height / 2} x2={width} y2={height / 2} stroke="#e2e8f0" strokeDasharray="3 3" />
      </svg>
    );
  }

  const max = Math.max(...data, 1);
  const min = Math.min(...data, 0);
  const range = max - min || 1;

  const points = data.map((val, index) => {
    const x = (index / (data.length - 1)) * width;
    const y = height - ((val - min) / range) * (height - 10) - 5;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });

  const polylineStr = points.join(' ');
  const areaPoints = [`0,${height}`, ...points, `${width},${height}`].join(' ');
  const gradId = `grad-${color.replace('#', '')}`;

  return (
    <svg width={width} height={height} className="sparkline-svg">
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.22" />
          <stop offset="100%" stopColor={color} stopOpacity="0.0" />
        </linearGradient>
      </defs>
      <polygon points={areaPoints} fill={`url(#${gradId})`} />
      <polyline
        fill="none"
        stroke={color}
        strokeWidth="2.2"
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

      const reqPerSec = Math.round(deltaReq / 2);
      setLiveReqSec(reqPerSec);

      setHistoryReqSec((prevHist) => {
        const next = [...prevHist, reqPerSec];
        return next.length > 25 ? next.slice(next.length - 25) : next;
      });

      setHistory429((prevHist) => {
        const next = [...prevHist, delta429];
        return next.length > 25 ? next.slice(next.length - 25) : next;
      });
    }
    prevStatsRef.current = stats;
  }, [stats]);

  const healthyCount = upstreams.filter((u) => u.healthy).length;
  const totalCount = upstreams.length;
  const totalActiveConns = upstreams.reduce((acc, u) => acc + (u.active_connections || 0), 0);

  const totalReq = stats.total_requests || 0;
  const total429 = stats.total_429s || 0;
  const rejectRate = totalReq > 0 ? ((total429 / totalReq) * 100).toFixed(1) : '0.0';

  const cards = [
    {
      label: 'Total Requests',
      value: totalReq.toLocaleString(),
      subtext: 'Cumulative traffic processed',
      icon: TrendingUp,
      badgeText: 'All Time',
      badgeClass: 'badge-soft-blue',
      chart: null,
    },
    {
      label: 'Rate Limited (429)',
      value: total429.toLocaleString(),
      subtext: `${rejectRate}% quota rejection rate`,
      icon: AlertOctagon,
      badgeText: `${rejectRate}%`,
      badgeClass: total429 > 0 ? 'badge-soft-amber' : 'badge-soft-neutral',
      chart: <Sparkline data={history429} color="#d97706" />,
    },
    {
      label: 'Live Throughput',
      value: (
        <span>
          {liveReqSec} <span className="stat-unit">req/s</span>
        </span>
      ),
      subtext: 'Rolling window request frequency',
      icon: Gauge,
      badgeText: 'Live',
      badgeClass: 'badge-soft-emerald',
      chart: <Sparkline data={historyReqSec} color="#4f46e5" />,
    },
    {
      label: 'Upstream Health',
      value: (
        <span>
          {healthyCount} <span className="stat-unit">/ {totalCount} Up</span>
        </span>
      ),
      subtext: `${totalActiveConns} active in-flight sockets`,
      icon: Server,
      badgeText: `${totalActiveConns} Conns`,
      badgeClass: healthyCount === totalCount && totalCount > 0 ? 'badge-soft-emerald' : 'badge-soft-amber',
      chart: null,
    },
  ];

  return (
    <div className="stats-kpi-grid">
      {cards.map((card, index) => {
        const Icon = card.icon;
        return (
          <motion.div
            key={card.label}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.35, delay: index * 0.06 }}
            className="kpi-card"
          >
            <div className="kpi-header">
              <div className="kpi-label-group">
                <div className="kpi-icon-box">
                  <Icon size={16} />
                </div>
                <span className="kpi-label">{card.label}</span>
              </div>
              <span className={`kpi-chip ${card.badgeClass}`}>{card.badgeText}</span>
            </div>

            <div className="kpi-body">
              <div className="kpi-metrics-row">
                <div className="kpi-value">{card.value}</div>
                {card.chart && <div className="kpi-chart-box">{card.chart}</div>}
              </div>
              <div className="kpi-subtext">{card.subtext}</div>
            </div>
          </motion.div>
        );
      })}
    </div>
  );
}
