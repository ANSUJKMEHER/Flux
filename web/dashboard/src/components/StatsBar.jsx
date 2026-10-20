import React, { useEffect, useState, useRef } from 'react';
import { motion } from 'motion/react';

// Minimalist technical sparkline in electric orange or slate
function TechnicalSparkline({ data, color = '#ff5500', height = 36, width = 140 }) {
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
    const y = height - ((val - min) / range) * (height - 8) - 4;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });

  const polylineStr = points.join(' ');

  return (
    <svg width={width} height={height} className="sparkline-svg">
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

// Minimalist wireframe line-art SVGs
function ServerRackWireframe() {
  return (
    <svg width="44" height="44" viewBox="0 0 48 48" fill="none" stroke="#94a3b8" strokeWidth="1.3" className="wireframe-icon">
      <rect x="8" y="6" width="32" height="10" rx="2" />
      <rect x="8" y="19" width="32" height="10" rx="2" />
      <rect x="8" y="32" width="32" height="10" rx="2" />
      <circle cx="14" cy="11" r="1.5" fill="#f97316" stroke="none" />
      <circle cx="18" cy="11" r="1.5" fill="#cbd5e1" stroke="none" />
      <circle cx="14" cy="24" r="1.5" fill="#f97316" stroke="none" />
      <circle cx="18" cy="24" r="1.5" fill="#cbd5e1" stroke="none" />
      <circle cx="14" cy="37" r="1.5" fill="#f97316" stroke="none" />
      <circle cx="18" cy="37" r="1.5" fill="#cbd5e1" stroke="none" />
    </svg>
  );
}

function StarWireframe() {
  return (
    <svg width="44" height="44" viewBox="0 0 48 48" fill="none" stroke="#f97316" strokeWidth="1.4" className="wireframe-icon">
      <path d="M24 4L28.5 16.5H41.5L31 24.5L35 37L24 29.5L13 37L17 24.5L6.5 16.5H19.5L24 4Z" />
      <circle cx="24" cy="23" r="2.5" stroke="#f97316" fill="none" />
    </svg>
  );
}

function ChipWireframe() {
  return (
    <svg width="44" height="44" viewBox="0 0 48 48" fill="none" stroke="#94a3b8" strokeWidth="1.3" className="wireframe-icon">
      <rect x="12" y="12" width="24" height="24" rx="3" />
      <path d="M12 18H6M12 24H6M12 30H6" />
      <path d="M36 18H42M36 24H42M36 30H42" />
      <path d="M18 12V6M24 12V6M30 12V6" />
      <path d="M18 36V42M24 36V42M30 36V42" />
      <rect x="18" y="18" width="12" height="12" fill="#fff7ed" stroke="#f97316" rx="1" />
    </svg>
  );
}

function NetworkWireframe() {
  return (
    <svg width="44" height="44" viewBox="0 0 48 48" fill="none" stroke="#94a3b8" strokeWidth="1.3" className="wireframe-icon">
      <circle cx="24" cy="12" r="5" />
      <circle cx="12" cy="34" r="5" />
      <circle cx="36" cy="34" r="5" />
      <line x1="22" y1="17" x2="14" y2="29" />
      <line x1="26" y1="17" x2="34" y2="29" />
      <line x1="17" y1="34" x2="31" y2="34" strokeDasharray="3 3" stroke="#f97316" />
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
      num: '// 001',
      title: 'Total Traffic Ingested',
      desc: 'All-time cumulative HTTP requests routed across backend pools.',
      value: totalReq.toLocaleString(),
      illustration: <ServerRackWireframe />,
      footer: 'ATOMIC REDIS LUA',
      highlight: false,
    },
    {
      num: '// 002',
      title: 'Real-Time Throughput',
      desc: 'Paced traffic frequency measured continuously in 2-second windows.',
      value: `${liveReqSec} req/s`,
      sparkline: <TechnicalSparkline data={historyReqSec} color="#f97316" />,
      illustration: <StarWireframe />,
      footer: `${liveReqSec > 0 ? 'ACTIVE STREAMING' : 'IDLE PACING'}`,
      highlight: true,
    },
    {
      num: '// 003',
      title: 'Rate Limited Rejections',
      desc: 'Requests throttled at boundary before hitting upstream servers.',
      value: `${total429.toLocaleString()} (${rejectRate}%)`,
      sparkline: <TechnicalSparkline data={history429} color="#64748b" />,
      illustration: <ChipWireframe />,
      footer: 'RFC-6585 COMPLIANT',
      highlight: false,
    },
    {
      num: '// 004',
      title: 'Cluster Health & Sockets',
      desc: 'Active upstream nodes with live TCP socket connection tracking.',
      value: `${healthyCount} / ${totalCount} UP`,
      illustration: <NetworkWireframe />,
      footer: `${totalActiveConns} IN-FLIGHT CONNS`,
      highlight: false,
    },
  ];

  return (
    <section className="narv-section">
      {/* Top Metadata & Slashed Headline */}
      <div className="section-hero-header">
        <div>
          <div className="section-tag-row font-mono">
            <span className="tag-orange">[N. 01 / 04]</span>
            <span className="tag-sep">&gt;</span>
            <span className="tag-text">KEY TELEMETRY METRICS</span>
          </div>

          <h1 className="section-main-heading">
            <span className="slash-accent">/ </span>
            <span className="text-black">Sub-millisecond rate limiting.</span>{' '}
            <span className="text-muted-heading">Total visibility over your upstream mesh.</span>
            <span className="slash-accent"> /</span>
          </h1>
        </div>
      </div>

      {/* 4 Cards Grid */}
      <div className="telemetry-cards-grid">
        {cards.map((card, idx) => (
          <motion.div
            key={card.num}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.25, delay: idx * 0.05 }}
            className={`metric-stat-card ${card.highlight ? 'metric-card-highlight' : ''}`}
          >
            {/* Card Index */}
            <div className="metric-card-index font-mono text-orange">
              {card.num}
            </div>

            {/* Title & Desc */}
            <h3 className="metric-card-title">{card.title}</h3>
            <p className="metric-card-desc">{card.desc}</p>

            {/* Value & Metric Display */}
            <div className="metric-card-val-row">
              <div className="metric-card-val font-mono">{card.value}</div>
              {card.sparkline && <div className="metric-card-spark">{card.sparkline}</div>}
            </div>

            {/* Wireframe Illustration Area */}
            <div className="metric-card-illustration">
              {card.illustration}
            </div>

            {/* Card Footer Divider */}
            <div className="metric-card-footer font-mono">
              {card.footer}
            </div>
          </motion.div>
        ))}
      </div>
    </section>
  );
}
