'use client';

import { useState, useEffect } from 'react';
import { adminApi, AdminAgentClient } from '../../../lib/api';

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, { bg: string; fg: string }> = {
    active: { bg: '#dcfce7', fg: '#166534' },
    invited: { bg: '#fef3c7', fg: '#92400e' },
    removed: { bg: '#f3f4f6', fg: '#6b7280' },
  };
  const c = colors[status] || colors.removed;
  return (
    <span style={{
      fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 10,
      backgroundColor: c.bg, color: c.fg, textTransform: 'uppercase',
    }}>
      {status}
    </span>
  );
}

export default function AdminAgentClientsTab() {
  const [items, setItems] = useState<AdminAgentClient[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = async (p: number) => {
    setLoading(true);
    try {
      const res = await adminApi.agentClients(p);
      setItems(res.items);
      setTotal(res.total);
      setPage(p);
    } catch (err: any) {
      setError(err.message || 'Failed to load');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(1); }, []);

  if (error) return <div style={{ color: 'var(--color-danger)', padding: 20 }}>{error}</div>;

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h2 style={{ fontSize: 18, fontWeight: 600, margin: 0, color: 'var(--color-text)' }}>
          Agent-Client Relationships ({total})
        </h2>
      </div>

      {loading ? (
        <div style={{ padding: 40, textAlign: 'center', color: 'var(--color-text-muted)' }}>Loading...</div>
      ) : items.length === 0 ? (
        <div style={{ padding: 40, textAlign: 'center', color: 'var(--color-text-muted)' }}>No agent-client relationships yet</div>
      ) : (
        <>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
              <thead>
                <tr style={{ borderBottom: '2px solid var(--color-border)' }}>
                  <th style={{ textAlign: 'left', padding: '8px 12px', color: 'var(--color-text-muted)', fontWeight: 600, fontSize: 12 }}>Agent</th>
                  <th style={{ textAlign: 'left', padding: '8px 12px', color: 'var(--color-text-muted)', fontWeight: 600, fontSize: 12 }}>Client</th>
                  <th style={{ textAlign: 'center', padding: '8px 12px', color: 'var(--color-text-muted)', fontWeight: 600, fontSize: 12 }}>Status</th>
                  <th style={{ textAlign: 'right', padding: '8px 12px', color: 'var(--color-text-muted)', fontWeight: 600, fontSize: 12 }}>Created</th>
                </tr>
              </thead>
              <tbody>
                {items.map(item => (
                  <tr key={item.id} style={{ borderBottom: '1px solid var(--color-border)' }}>
                    <td style={{ padding: '10px 12px', color: 'var(--color-text)' }}>{item.agent_email}</td>
                    <td style={{ padding: '10px 12px', color: 'var(--color-text)' }}>{item.client_email}</td>
                    <td style={{ padding: '10px 12px', textAlign: 'center' }}><StatusBadge status={item.status} /></td>
                    <td style={{ padding: '10px 12px', textAlign: 'right', color: 'var(--color-text-muted)', fontSize: 13 }}>
                      {item.created_at ? new Date(item.created_at).toLocaleDateString() : '--'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {total > 50 && (
            <div style={{ display: 'flex', justifyContent: 'center', gap: 8, marginTop: 16 }}>
              <button
                onClick={() => load(page - 1)}
                disabled={page <= 1}
                style={{ padding: '6px 16px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', background: 'var(--color-surface)', cursor: page <= 1 ? 'default' : 'pointer', opacity: page <= 1 ? 0.5 : 1, color: 'var(--color-text)' }}
              >
                Prev
              </button>
              <span style={{ padding: '6px 12px', fontSize: 13, color: 'var(--color-text-muted)' }}>Page {page}</span>
              <button
                onClick={() => load(page + 1)}
                disabled={page * 50 >= total}
                style={{ padding: '6px 16px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', background: 'var(--color-surface)', cursor: page * 50 >= total ? 'default' : 'pointer', opacity: page * 50 >= total ? 0.5 : 1, color: 'var(--color-text)' }}
              >
                Next
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
