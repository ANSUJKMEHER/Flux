import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Key, Lock, X, Check, Activity, Zap, Sliders } from 'lucide-react';
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
    { id: 'config', label: 'Gateway Config', icon: Sliders },
  ];

  return (
    <header className="modern-navbar">
      {/* Brand & Connection Tag */}
      <div className="navbar-brand-section">
        <div className="brand-pill">
          <div className="brand-logo-mark">
            <Zap size={15} className="brand-zap-icon" />
          </div>
          <span className="brand-name">FLUX<span className="brand-dot">.GO</span></span>
          <span className="brand-version-chip">v1.2</span>
        </div>

        {/* Live Status Pill */}
        <div className="telemetry-status-pill font-mono">
          {isDemoMode ? (
            <span className="status-indicator-demo">
              <span className="pulse-dot dot-purple"></span>
              SIMULATION MODE
            </span>
          ) : connectionError ? (
            <span className="status-indicator-offline">
              <span className="pulse-dot dot-rose"></span>
              GATEWAY OFFLINE
            </span>
          ) : (
            <span className="status-indicator-live">
              <span className="pulse-dot dot-emerald"></span>
              LIVE TELEMETRY
            </span>
          )}
        </div>
      </div>

      {/* Center: Segmented Navigation Pills */}
      <nav className="navbar-nav-tabs">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = activeTab === item.id;
          return (
            <button
              key={item.id}
              type="button"
              className={`nav-tab-item ${isActive ? 'nav-tab-item-active' : ''}`}
              onClick={() => setActiveTab(item.id)}
            >
              <Icon size={14} className="nav-tab-icon" />
              <span>{item.label}</span>
            </button>
          );
        })}
      </nav>

      {/* Right Controls: Token Auth & Demo Switch */}
      <div className="navbar-actions-section">
        {/* Modern Toggle Switch for Demo Mode */}
        <label className="toggle-switch-wrapper" title="Toggle simulation mode when gateway backend is offline">
          <input
            type="checkbox"
            checked={isDemoMode}
            onChange={(e) => setIsDemoMode(e.target.checked)}
            className="toggle-checkbox"
          />
          <div className="toggle-slider"></div>
          <span className="toggle-label font-mono">Simulation</span>
        </label>

        {/* Admin Token Button */}
        <motion.button
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
          type="button"
          className={`btn-action-pill ${hasToken ? 'btn-action-pill-active' : ''}`}
          onClick={() => setShowTokenInput(!showTokenInput)}
        >
          <Key size={13} />
          <span>{hasToken ? 'Token Active' : 'Admin Auth'}</span>
        </motion.button>
      </div>

      {/* Admin Token Modal */}
      <AnimatePresence>
        {showTokenInput && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="modal-backdrop-clean"
            onClick={() => setShowTokenInput(false)}
          >
            <motion.div
              initial={{ scale: 0.96, opacity: 0, y: 12 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.96, opacity: 0, y: 12 }}
              transition={{ duration: 0.2 }}
              className="modal-card-clean"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="modal-header-clean">
                <div className="modal-title-left">
                  <div className="modal-icon-square">
                    <Lock size={15} />
                  </div>
                  <div>
                    <h3 className="modal-heading">Admin API Authentication</h3>
                    <p className="modal-subheading font-mono text-xs text-muted">
                      Protected endpoints require Bearer authorization header
                    </p>
                  </div>
                </div>
                <button className="btn-modal-close-round" onClick={() => setShowTokenInput(false)}>
                  <X size={15} />
                </button>
              </div>

              <form onSubmit={handleSave} className="modal-form-clean">
                <div className="form-group-clean">
                  <label className="input-label-clean">Bearer Token</label>
                  <input
                    type="password"
                    placeholder="Enter admin token (or leave empty if disabled)"
                    value={tokenInput}
                    onChange={(e) => setTokenInput(e.target.value)}
                    className="input-field-clean font-mono"
                    autoFocus
                  />
                  <p className="input-hint-clean font-mono">
                    Automatically sent to <code>/admin/*</code> and <code>/admin/config</code>.
                  </p>
                </div>

                <div className="modal-footer-clean">
                  {hasToken && (
                    <button type="button" className="btn-clean-secondary font-mono" onClick={handleClear}>
                      Remove Token
                    </button>
                  )}
                  <button type="submit" className="btn-clean-primary">
                    {savedSuccess ? (
                      <span className="flex-center">
                        <Check size={13} /> Saved
                      </span>
                    ) : (
                      'Save Token'
                    )}
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
