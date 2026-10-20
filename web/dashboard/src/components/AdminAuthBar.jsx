import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X } from 'lucide-react';
import { getAdminToken, setAdminToken } from '../api';

export default function AdminAuthBar({ isDemoMode, setIsDemoMode, connectionError, activeTab, setActiveTab }) {
  const [showTokenInput, setShowTokenInput] = useState(false);
  const [tokenInput, setTokenInput] = useState(getAdminToken());
  const [savedSuccess, setSavedSuccess] = useState(false);

  const handleSave = (e) => {
    e.preventDefault();
    setAdminToken(tokenInput);
    setSavedSuccess(true);
    setTimeout(() => {
      setSavedSuccess(false);
      setShowTokenInput(false);
    }, 1200);
  };

  const handleClear = () => {
    setAdminToken('');
    setTokenInput('');
  };

  const hasToken = !!getAdminToken();

  const navItems = [
    { id: 'topology', label: 'TOPOLOGY' },
    { id: 'traffic', label: 'TRAFFIC SIMULATOR' },
    { id: 'config', label: 'GATEWAY CONFIG' },
  ];

  return (
    <header className="narv-navbar">
      <div className="narv-navbar-left">
        {/* Segmented Terminal Nav Strip */}
        <div className="narv-nav-strip">
          <div className="narv-brand-block">
            &lt;FLUX.GO&gt;
          </div>
          {navItems.map((item) => {
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                className={`narv-nav-tab ${isActive ? 'narv-nav-tab-active' : ''}`}
                onClick={() => setActiveTab(item.id)}
              >
                {item.label}
              </button>
            );
          })}
        </div>

        {/* Technical Status Tag */}
        <div className="narv-status-tag font-mono">
          <span className="text-orange">[SYS. 01]</span>
          <span className="narv-status-sep">&gt;</span>
          {isDemoMode ? (
            <span className="text-purple font-bold">SIMULATION_MODE</span>
          ) : connectionError ? (
            <span className="text-rose font-bold">GATEWAY_DISCONNECTED</span>
          ) : (
            <span className="text-emerald font-bold">LIVE_TELEMETRY</span>
          )}
        </div>
      </div>

      {/* Right Controls */}
      <div className="narv-navbar-right">
        {/* Demo Mode Pill */}
        <button
          type="button"
          onClick={() => setIsDemoMode(!isDemoMode)}
          className={`narv-btn-pill font-mono ${isDemoMode ? 'narv-btn-pill-active' : ''}`}
        >
          [ DEMO: {isDemoMode ? 'ON' : 'OFF'} ]
        </button>

        {/* CTA Black Button with Orange Square */}
        <motion.button
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
          className="narv-btn-black"
          onClick={() => setShowTokenInput(!showTokenInput)}
        >
          <span className="narv-square-indicator">■</span>
          <span className="font-mono">{hasToken ? 'TOKEN ACTIVE' : 'ADMIN AUTH'}</span>
        </motion.button>
      </div>

      {/* Admin Token Modal */}
      <AnimatePresence>
        {showTokenInput && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="narv-modal-backdrop"
            onClick={() => setShowTokenInput(false)}
          >
            <motion.div
              initial={{ scale: 0.97, opacity: 0, y: 10 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.97, opacity: 0, y: 10 }}
              transition={{ duration: 0.2 }}
              className="narv-modal-box"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="narv-modal-top">
                <div className="font-mono text-orange text-xs">[AUTH. 01] &gt; BEARER_TOKEN</div>
                <button className="narv-modal-close" onClick={() => setShowTokenInput(false)}>
                  <X size={14} />
                </button>
              </div>

              <h3 className="narv-modal-title">Admin API Authentication</h3>
              <p className="narv-modal-desc font-mono">
                When <code>admin.token</code> is configured in <code>gateway.yaml</code>, requests to <code>/admin/*</code> require <code>Authorization: Bearer &lt;token&gt;</code>.
              </p>

              <form onSubmit={handleSave} className="narv-modal-form">
                <input
                  type="password"
                  placeholder="Enter admin token (or leave empty if disabled)"
                  value={tokenInput}
                  onChange={(e) => setTokenInput(e.target.value)}
                  className="narv-text-input font-mono"
                  autoFocus
                />

                <div className="narv-modal-actions">
                  {hasToken && (
                    <button type="button" className="narv-btn-subtle font-mono" onClick={handleClear}>
                      CLEAR
                    </button>
                  )}
                  <button type="submit" className="narv-btn-black font-mono">
                    <span className="narv-square-indicator">■</span>
                    {savedSuccess ? 'SAVED' : 'SAVE TOKEN'}
                  </button>
                </div>
              </form>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </header>
  );
}
