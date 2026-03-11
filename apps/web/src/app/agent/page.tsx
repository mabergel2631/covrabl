'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '../../../lib/auth';
import { agentApi, AgentOverview, AgentClient } from '../../../lib/api';
import { trackClick } from '../../../lib/track';
import BackButton from '../components/BackButton';

function ScoreBadge({ score }: { score: number | null }) {
  if (score === null || score === undefined) return <span style={{ color: 'var(--color-text-muted)', fontSize: 13 }}>--</span>;
  const color = score >= 70 ? 'var(--color-success)' : score >= 40 ? 'var(--color-warning)' : 'var(--color-danger)';
  return (
    <span style={{
      display: 'inline-block',
      padding: '2px 10px',
      borderRadius: 12,
      fontSize: 13,
      fontWeight: 600,
      backgroundColor: `${color}18`,
      color,
    }}>
      {score}
    </span>
  );
}

export default function AdvisorDashboard() {
  const { token, role } = useAuth();
  const router = useRouter();
  const [overview, setOverview] = useState<AgentOverview | null>(null);
  const [clients, setClients] = useState<AgentClient[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!token) { router.replace('/login'); return; }
    if (role && role !== 'agent') { router.replace('/policies'); return; }

    const load = async () => {
      try {
        const [ov, cl] = await Promise.all([agentApi.overview(), agentApi.clients()]);
        setOverview(ov);
        setClients(cl);
      } catch (err: any) {
        if (err.status === 403) {
          router.replace('/policies');
          return;
        }
        setError(err.message || 'Failed to load');
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [token, role]);

  if (!token || loading) {
    return (
      <div style={{ padding: 40, textAlign: 'center', color: 'var(--color-text-muted)' }}>
        Loading...
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ padding: 40, textAlign: 'center' }}>
        <p style={{ color: 'var(--color-danger)' }}>{error}</p>
      </div>
    );
  }

  const statCards = [
    { label: 'Total Clients', value: overview?.total_clients ?? 0 },
    { label: 'Total Policies', value: overview?.total_policies ?? 0 },
    { label: 'Avg Protection Score', value: overview?.avg_protection_score ?? '--' },
    { label: 'Upcoming Renewals', value: overview?.upcoming_renewals ?? 0 },
  ];

  return (
    <div style={{ padding: '32px 24px', maxWidth: 1000, margin: '0 auto' }}>
      <BackButton href="/" label="My Clients" parentLabel="Home" />
      <h1 style={{ fontSize: 24, fontWeight: 700, margin: '0 0 8px', color: 'var(--color-text)' }}>
        My Clients
      </h1>
      <p style={{ fontSize: 14, color: 'var(--color-text-secondary)', margin: '0 0 32px' }}>
        Your clients who have shared access with you.
      </p>

      {/* Overview Cards */}
      <div className="mobile-grid-2" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 16, marginBottom: 40 }}>
        {statCards.map(card => (
          <div key={card.label} className="card" style={{ padding: 20, textAlign: 'center' }}>
            <div style={{ fontSize: 28, fontWeight: 700, color: 'var(--color-primary)', marginBottom: 4 }}>
              {card.value}
            </div>
            <div style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>{card.label}</div>
          </div>
        ))}
      </div>

      {/* Client List */}
      <h2 style={{ fontSize: 18, fontWeight: 600, margin: '0 0 16px', color: 'var(--color-text)' }}>
        Clients
      </h2>

      {clients.length === 0 ? (
        <div className="card" style={{ padding: 40, textAlign: 'center', color: 'var(--color-text-muted)' }}>
          No clients yet. Clients can share access with you by adding your email as a broker.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {clients.map(client => (
            <div
              key={client.id}
              className="card mobile-grid-1"
              onClick={() => { trackClick('client_row', { client_id: client.id }); router.push(`/agent/${client.id}`); }}
              style={{
                padding: '16px 20px',
                cursor: 'pointer',
                display: 'grid',
                gridTemplateColumns: '1fr auto auto auto',
                alignItems: 'center',
                gap: '12px 20px',
                transition: 'box-shadow 0.15s',
              }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.boxShadow = '0 2px 8px rgba(0,0,0,0.08)'; }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.boxShadow = ''; }}
            >
              <div>
                <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-text)' }}>{client.email}</div>
              </div>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginBottom: 2 }}>Policies</div>
                <div style={{ fontSize: 14, fontWeight: 600 }}>{client.policy_count}</div>
              </div>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginBottom: 2 }}>Score</div>
                <ScoreBadge score={client.protection_score} />
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginBottom: 2 }}>Next Renewal</div>
                <div style={{ fontSize: 13, color: 'var(--color-text-secondary)' }}>
                  {client.next_renewal || '--'}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
