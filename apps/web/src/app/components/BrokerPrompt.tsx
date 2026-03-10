'use client';

import { useState, useEffect } from 'react';
import { authApi } from '../../../lib/api';
import { track } from '../../../lib/track';
import { useAuth } from '../../../lib/auth';

const STORAGE_KEY = 'pv_seen_broker_prompt';

export default function BrokerPrompt() {
  const { role, refreshPlan } = useAuth();
  const [show, setShow] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (role !== 'individual') return;
    if (typeof localStorage !== 'undefined' && localStorage.getItem(STORAGE_KEY)) return;
    setShow(true);
    track('broker_prompt_shown', 'broker_flow');
  }, [role]);

  if (!show) return null;

  function dismiss() {
    localStorage.setItem(STORAGE_KEY, '1');
    setShow(false);
  }

  async function handleAccept() {
    setLoading(true);
    try {
      await authApi.setRole('broker');
      track('broker_prompt_accepted', 'broker_flow');
      localStorage.setItem(STORAGE_KEY, '1');
      // Refresh auth context to pick up new role
      await refreshPlan();
      window.location.reload();
    } catch {
      dismiss();
    }
  }

  function handleDismiss() {
    track('broker_prompt_dismissed', 'broker_flow');
    dismiss();
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 9999,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      backgroundColor: 'rgba(0,0,0,0.4)',
    }}>
      <div style={{
        backgroundColor: '#fff', borderRadius: 16, padding: '32px 28px',
        maxWidth: 420, width: '90%', boxShadow: '0 20px 60px rgba(0,0,0,0.15)',
      }}>
        <div style={{ fontSize: 28, textAlign: 'center', marginBottom: 12 }}>&#128188;</div>
        <h2 style={{ fontSize: 18, fontWeight: 700, textAlign: 'center', margin: '0 0 8px' }}>
          Are you an insurance broker?
        </h2>
        <p style={{ fontSize: 14, color: '#6b7280', textAlign: 'center', margin: '0 0 24px', lineHeight: 1.5 }}>
          Brokers get a &ldquo;My Clients&rdquo; dashboard to monitor clients who share access with you.
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <button
            onClick={handleAccept}
            disabled={loading}
            style={{
              padding: '12px 16px', fontSize: 14, fontWeight: 600,
              backgroundColor: 'var(--color-primary)', color: '#fff',
              border: 'none', borderRadius: 'var(--radius-md)', cursor: 'pointer',
              opacity: loading ? 0.7 : 1,
            }}
          >
            {loading ? 'Setting up...' : 'Yes, I manage client policies'}
          </button>
          <button
            onClick={handleDismiss}
            style={{
              padding: '12px 16px', fontSize: 14, fontWeight: 500,
              backgroundColor: 'transparent', color: 'var(--color-text-secondary)',
              border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', cursor: 'pointer',
            }}
          >
            No, I manage my own policies
          </button>
        </div>
      </div>
    </div>
  );
}
