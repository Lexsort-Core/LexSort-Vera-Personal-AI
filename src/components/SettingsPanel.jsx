import { useState, useEffect } from 'react';
import { open } from '@tauri-apps/plugin-shell';

export default function SettingsPanel({ onClose }) {
  const [profile, setProfile] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetch('http://127.0.0.1:58732/profile')
      .then(r => r.json())
      .then(setProfile)
      .catch(() => setError('Engine offline'));
  }, []);

  return (
    <div style={{ width: 420, height: '100vh', backgroundColor: '#0d1117', padding: 20, color: '#e6edf3', borderLeft: '1px solid #21262d' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 20 }}>
        <h2 style={{ fontSize: 15, margin: 0 }}>Settings</h2>
        <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#7d8590', cursor: 'pointer' }}>✕</button>
      </div>
      
      <h3 style={{ fontSize: 10, textTransform: 'uppercase', color: '#7d8590' }}>Hardware Profile</h3>
      <pre style={{ backgroundColor: '#161b22', padding: 10, borderRadius: 8, fontSize: 11, overflowX: 'auto' }}>
        {profile ? JSON.stringify(profile, null, 2) : 'Loading...'}
      </pre>
      
      {error && <p style={{ color: '#da3637' }}>{error}</p>}
    </div>
  );
}
