import React from 'react';
import { AlertTriangle, RotateCcw } from 'lucide-react';

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error('Flux Dashboard Error Boundary caught error:', error, errorInfo);
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null });
    if (this.props.onReset) {
      this.props.onReset();
    }
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="soft-empty-state" style={{ padding: '3rem 1.5rem', background: '#fff', border: '1px solid #fecaca' }}>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.85rem', maxWidth: '480px', margin: '0 auto', textAlign: 'center' }}>
            <div style={{ width: '42px', height: '42px', borderRadius: '50%', background: '#fee2e2', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#dc2626' }}>
              <AlertTriangle size={20} />
            </div>
            <h3 style={{ fontSize: '1.05rem', fontWeight: 700, color: '#0f172a' }}>
              {this.props.title || 'Component Error'}
            </h3>
            <p style={{ fontSize: '0.82rem', color: '#64748b', lineHeight: 1.5 }}>
              {this.state.error?.message || 'An unexpected rendering error occurred in this view.'}
            </p>
            <button
              type="button"
              className="btn-soft-secondary font-mono"
              onClick={this.handleReset}
              style={{ marginTop: '0.5rem' }}
            >
              <RotateCcw size={13} />
              <span>Retry Component</span>
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
