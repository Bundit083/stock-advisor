import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';

class ErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = { error: null }; }
  componentDidCatch(error) { this.setState({ error }); }
  render() {
    if (this.state.error) return (
      <div style={{padding:20,background:'#111',color:'#ff4455',fontFamily:'monospace',fontSize:12,minHeight:'100vh'}}>
        <div style={{fontSize:16,marginBottom:10}}>❌ Runtime Error</div>
        <pre style={{whiteSpace:'pre-wrap',wordBreak:'break-all'}}>{this.state.error.toString()}</pre>
        <pre style={{whiteSpace:'pre-wrap',wordBreak:'break-all',color:'#888',marginTop:10}}>{this.state.error.stack}</pre>
      </div>
    );
    return this.props.children;
  }
}

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(<ErrorBoundary><App /></ErrorBoundary>);
