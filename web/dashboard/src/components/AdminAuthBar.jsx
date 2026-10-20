import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Zap, 
  Activity, 
  ShieldCheck, 
  ShieldAlert, 
  Key, 
  Settings, 
  Radio, 
  X, 
  Check, 
  Lock 
} from 'lucide-react';
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
    { id: 'topology', label: 'Topology & Chaos', icon: Activity },
    { id: 'traffic', label: 'Traffic Simulator', icon: Zap },
    { id: 'config', label: 'Gateway Config', icon: Settings },
  ];

  return (
    <header className="navbar-container">
      {/* Brand & Connection Pill */}
      <div className="navbar-left">
        <div className="brand-badge">
          <div className="brand-icon-box">
            <Zap className="brand-icon-svg" size={18} />
          </div>
          <div className="brand-text-group">
            <span className="brand-title">FLUX<span className="brand-accent">.GO</span></span>
            <span className="brand-tag">v1.2 Control Plane</span>
          </div>
        </div>

        {/* Status Indicator */}
        <div className="status-pill-wrapper">
          {isDemoMode ? (
            <span className="status-pill-demo">
              <span className="pulsing-dot dot-demo"></span>
              <Radio size={12} className="status-inline-icon" />
              SIMULATION MODE
            </span>
          ) : connectionError ? (
            <span className="status-pill-offline">
              <span className="pulsing-dot dot-offline"></span>
              <ShieldAlert size={12} className="status-inline-icon" />
              GATEWAY DISCONNECTED
            </span>
          ) : (
            <span className="status-pill-live">
              <span className="pulsing-dot dot-live"></span>
              <ShieldCheck size={12} className="status-inline-icon" />
              LIVE TELEMETRY
            </span>
          )}
        </div>
      </div>

      {/* Modern Segmented Navigation Tabs */}
      <nav className="navbar-tabs">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = activeTab === item.id;
          return (
            <button
              key={item.id}
              className={`nav-tab-btn ${isActive ? 'nav-tab-btn-active' : ''}`}
              onClick={() => setActiveTab(item.id)}
            >
              <Icon size={15} className="tab-icon" />
              <span>{item.label}</span>
              {isActive && (
                <motion.div
                  layoutId="activeTabGlow"
                  className="nav-tab-indicator"
                  transition={{ type: 'spring', stiffness: 450, damping: 35 }}
                />
              )}
            </button>
          );
        })}
      </nav>

      {/* Right Controls: Auth & Demo Switch */}
      <div className="navbar-right">
        <motion.button
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.97 }}
          className={`btn-auth-chip ${hasToken ? 'auth-chip-active' : ''}`}
          onClick={() => setShowTokenInput(!showTokenInput)}
        >
          <Key size={14} />
          <span>{hasToken ? 'Token Active' : 'Admin Auth'}</span>
        </motion.button>

        <label className="demo-switch-label" title="Toggle simulation mode when gateway is offline">
          <input
            type="checkbox"
            checked={isDemoMode}
            onChange={(e) => setIsDemoMode(e.target.checked)}
            className="demo-switch-input"
          />
          <span className="demo-switch-track">
            <span className="demo-switch-thumb"></span>
          </span>
          <span className="demo-switch-text">Demo Mode</span>
        </label>
      </div>

      {/* Animated Auth Token Modal */}
      <AnimatePresence>
        {showTokenInput && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="token-modal-backdrop"
            onClick={() => setShowTokenInput(false)}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0, y: 15 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.95, opacity: 0, y: 15 }}
              transition={{ type: 'spring', duration: 0.3 }}
              className="token-modal-card"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="token-modal-header">
                <div className="modal-title-box">
                  <div className="modal-icon-badge">
                    <Lock size={16} />
                  </div>
                  <div>
                    <h3 className="modal-title">Admin Bearer Authentication</h3>
                    <p className="modal-subtitle">Configure authorization token for protected /admin endpoints</p>
                  </div>
                </div>
                <button className="btn-modal-close" onClick={() => setShowTokenInput(false)}>
                  <X size={16} />
                </button>
              </div>

              <form onSubmit={handleSave} className="token-modal-form">
                <div className="form-input-group">
                  <label className="form-label">Bearer Token</label>
                  <input
                    type="password"
                    placeholder="Enter admin token (or leave empty if disabled)"
                    value={tokenInput}
                    onChange={(e) => setTokenInput(e.target.value)}
                    className="form-text-input"
                    autoFocus
                  />
                  <span className="form-help">
                    Sent as <code>Authorization: Bearer &lt;token&gt;</code> to the gateway control plane.
                  </span>
                </div>

                <div className="token-modal-footer">
                  {hasToken && (
                    <button type="button" className="btn-light-secondary" onClick={handleClear}>
                      Clear Token
                    </button>
                  )}
                  <motion.button
                    whileTap={{ scale: 0.97 }}
                    type="submit"
                    className="btn-light-primary"
                  >
                    {savedSuccess ? (
                      <span className="flex-center">
                        <Check size={14} /> Saved
                      </span>
                    ) : (
                      'Save Token'
                    )}
                  </motion.button>
                </div>
              </form>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </header>
  );
}
