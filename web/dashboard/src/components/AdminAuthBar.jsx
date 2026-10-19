import React, { useState } from 'react';
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

  return (
    <header className="navbar-container">
      <div className="navbar-left">
        <div className="brand-logo">
          <span className="brand-icon">⚡</span>
          <span className="brand-text">FLUX<span className="brand-highlight">.GO</span></span>
        </div>
        <span className="brand-version">v1.2 Control Plane</span>

        {/* Live / Demo Status Indicator */}
        <div className="connection-badge-wrapper">
          {isDemoMode ? (
            <span className="badge-demo" title="Displaying simulated metrics for offline evaluation">
              <span className="demo-dot"></span> SIMULATION MODE
            </span>
          ) : connectionError ? (
            <span className="badge-disconnected" title="Gateway unreachable on localhost:9091">
              <span className="disc-dot"></span> GATEWAY OFFLINE
            </span>
          ) : (
            <span className="badge-live" title="Active polling against /admin API">
              <span className="live-dot"></span> LIVE TELEMETRY
            </span>
          )}
        </div>
      </div>

      {/* Navigation Tabs */}
      <nav className="navbar-nav">
        <button
          className={`nav-tab ${activeTab === 'topology' ? 'nav-tab-active' : ''}`}
          onClick={() => setActiveTab('topology')}
        >
          Topology & Chaos
        </button>
        <button
          className={`nav-tab ${activeTab === 'traffic' ? 'nav-tab-active' : ''}`}
          onClick={() => setActiveTab('traffic')}
        >
          Traffic Simulator
        </button>
        <button
          className={`nav-tab ${activeTab === 'config' ? 'nav-tab-active' : ''}`}
          onClick={() => setActiveTab('config')}
        >
          Gateway Config
        </button>
      </nav>

      {/* Right Controls: Token Auth & Demo Switcher */}
      <div className="navbar-right">
        <button
          className={`btn-auth-toggle ${hasToken ? 'token-active' : ''}`}
          onClick={() => setShowTokenInput(!showTokenInput)}
          title="Configure Admin Bearer Token for protected /admin endpoints"
        >
          <span className="key-icon">🔑</span>
          {hasToken ? 'Admin Token Active' : 'Admin Auth'}
        </button>

        <label className="demo-toggle-label" title="Toggle simulation mode when gateway is not running">
          <input
            type="checkbox"
            checked={isDemoMode}
            onChange={(e) => setIsDemoMode(e.target.checked)}
          />
          <span className="toggle-text">Demo Mode</span>
        </label>
      </div>

      {/* Auth Token Drawer / Dropdown */}
      {showTokenInput && (
        <div className="token-modal-overlay" onClick={() => setShowTokenInput(false)}>
          <div className="token-modal" onClick={(e) => e.stopPropagation()}>
            <div className="token-modal-header">
              <h3>Admin Bearer Authentication</h3>
              <button className="btn-close" onClick={() => setShowTokenInput(false)}>✕</button>
            </div>
            <p className="token-modal-desc">
              When <code>admin.token</code> is configured in <code>configs/gateway.yaml</code>, requests to <code>/admin/*</code> require an <code>Authorization: Bearer &lt;token&gt;</code> header.
            </p>
            <form onSubmit={handleSave}>
              <div className="token-input-group">
                <input
                  type="password"
                  placeholder="Enter admin token (or leave empty if disabled)"
                  value={tokenInput}
                  onChange={(e) => setTokenInput(e.target.value)}
                  className="token-input"
                  autoFocus
                />
              </div>
              <div className="token-modal-actions">
                {hasToken && (
                  <button type="button" className="btn-secondary" onClick={handleClear}>
                    Remove Token
                  </button>
                )}
                <button type="submit" className="btn-primary">
                  {savedSuccess ? 'Saved!' : 'Save Token'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </header>
  );
}
