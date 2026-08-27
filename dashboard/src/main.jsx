import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import './styles.css';

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { err: null };
  }

  static getDerivedStateFromError(err) {
    return { err };
  }

  render() {
    if (this.state.err) {
      return (
        <div style={{ maxWidth: 860, margin: '60px auto', padding: '0 20px', fontFamily: 'Consolas, monospace' }}>
          <div style={{ background: 'rgba(239,68,68,.12)', border: '1px solid rgba(239,68,68,.45)', borderRadius: 14, padding: 24, color: '#fecaca' }}>
            <h2 style={{ marginTop: 0 }}>Terjadi error di dashboard</h2>
            <pre style={{ whiteSpace: 'pre-wrap', fontSize: 12, lineHeight: 1.6, overflowX: 'auto' }}>
              {String(this.state.err.stack || this.state.err)}
            </pre>
            <button
              onClick={() => this.setState({ err: null })}
              style={{ padding: '8px 16px', borderRadius: 8, border: 'none', cursor: 'pointer', fontWeight: 700 }}
            >
              Coba Lagi
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);
