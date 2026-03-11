'use client';

import { useAuth } from '../../../lib/auth';

export default function SessionWarning() {
  const { sessionWarning, dismissWarning, logout } = useAuth();

  if (!sessionWarning) return null;

  return (
    <div style={{
      position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.5)', zIndex: 10000,
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
    }}>
      <div style={{
        backgroundColor: '#fff', borderRadius: 12, padding: '28px 32px', maxWidth: 420,
        width: '100%', textAlign: 'center', boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
      }}>
        <div style={{ fontSize: 36, marginBottom: 12 }}>&#9201;</div>
        <h2 style={{ fontSize: 18, fontWeight: 700, margin: '0 0 8px', color: '#1f2937' }}>
          Session expiring soon
        </h2>
        <p style={{ fontSize: 14, color: '#6b7280', margin: '0 0 24px', lineHeight: 1.5 }}>
          For your security, you will be logged out in less than 1 minute due to inactivity.
        </p>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
          <button
            onClick={logout}
            style={{
              padding: '10px 20px', fontSize: 14, fontWeight: 600,
              border: '1px solid #d1d5db', borderRadius: 8, backgroundColor: '#fff',
              color: '#374151', cursor: 'pointer',
            }}
          >
            Log out now
          </button>
          <button
            onClick={dismissWarning}
            style={{
              padding: '10px 20px', fontSize: 14, fontWeight: 600,
              border: 'none', borderRadius: 8, backgroundColor: '#2563eb',
              color: '#fff', cursor: 'pointer',
            }}
          >
            Stay logged in
          </button>
        </div>
      </div>
    </div>
  );
}
