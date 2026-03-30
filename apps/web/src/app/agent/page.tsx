'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '../../../lib/auth';
import { agentApi, AgentOverview, AgentClient } from '../../../lib/api';
import { trackClick, trackFeatureUse } from '../../../lib/track';
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

  // Invite state
  const [showInvite, setShowInvite] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviting, setInviting] = useState(false);
  const [inviteMsg, setInviteMsg] = useState('');

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

  const handleInvite = async () => {
    if (!inviteEmail.trim()) return;
    setInviting(true);
    setInviteMsg('');
    trackClick('agent_invite_submit', { email: inviteEmail.trim() });
    try {
      const result = await agentApi.inviteClient(inviteEmail.trim());
      trackFeatureUse('agent_invite_sent', { status: result.status });
      setInviteMsg(result.status === 'active' ? 'Client added!' : 'Invite sent!');
      setInviteEmail('');
      // Refresh client list
      const [ov, cl] = await Promise.all([agentApi.overview(), agentApi.clients()]);
      setOverview(ov);
      setClients(cl);
      setTimeout(() => { setShowInvite(false); setInviteMsg(''); }, 1500);
    } catch (err: any) {
      setInviteMsg(err.message || 'Failed to invite');
    } finally {
      setInviting(false);
    }
  };

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
    { label: 'Flagged Items', value: overview?.flagged_count ?? 0, color: (overview?.flagged_count ?? 0) > 0 ? 'var(--color-danger)' : undefined },
  ];

  const activeClients = clients.filter(c => c.status === 'active');
  const invitedClients = clients.filter(c => c.status === 'invited');

  return (
    <div style={{ padding: '32px 24px', maxWidth: 1000, margin: '0 auto' }}>
      <BackButton href="/" label="My Clients" parentLabel="Home" />
      <div className="mobile-col" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <h1 style={{ fontSize: 24, fontWeight: 700, margin: 0, color: 'var(--color-text)' }}>
          My Clients
        </h1>
        <button
          onClick={() => { trackClick('agent_invite_open'); setShowInvite(!showInvite); }}
          style={{
            padding: '8px 20px',
            backgroundColor: 'var(--color-primary)',
            color: '#fff',
            border: 'none',
            borderRadius: 'var(--radius-md)',
            fontSize: 14,
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          + Invite Client
        </button>
      </div>
      <p style={{ fontSize: 14, color: 'var(--color-text-secondary)', margin: '0 0 24px' }}>
        Manage your clients and their insurance coverage.
      </p>

      {/* Invite form */}
      {showInvite && (
        <div className="card" style={{ padding: 20, marginBottom: 24 }}>
          <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 12, color: 'var(--color-text)' }}>Invite a Client</div>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              type="email"
              placeholder="client@email.com"
              value={inviteEmail}
              onChange={e => setInviteEmail(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleInvite(); }}
              style={{
                flex: 1,
                padding: '10px 14px',
                border: '1px solid var(--color-border)',
                borderRadius: 'var(--radius-md)',
                fontSize: 14,
                outline: 'none',
                backgroundColor: 'var(--color-surface)',
                color: 'var(--color-text)',
              }}
            />
            <button
              onClick={handleInvite}
              disabled={inviting || !inviteEmail.trim()}
              style={{
                padding: '10px 24px',
                backgroundColor: 'var(--color-primary)',
                color: '#fff',
                border: 'none',
                borderRadius: 'var(--radius-md)',
                fontSize: 14,
                fontWeight: 600,
                cursor: inviting ? 'wait' : 'pointer',
                opacity: inviting || !inviteEmail.trim() ? 0.6 : 1,
              }}
            >
              {inviting ? 'Sending...' : 'Send Invite'}
            </button>
          </div>
          {inviteMsg && (
            <div style={{ marginTop: 8, fontSize: 13, color: inviteMsg.includes('Failed') || inviteMsg.includes('Already') ? 'var(--color-danger)' : 'var(--color-success)' }}>
              {inviteMsg}
            </div>
          )}
        </div>
      )}

      {/* Overview Cards */}
      <div className="mobile-grid-2" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 16, marginBottom: 40 }}>
        {statCards.map(card => (
          <div key={card.label} className="card" style={{ padding: 20, textAlign: 'center' }}>
            <div style={{ fontSize: 28, fontWeight: 700, color: card.color || 'var(--color-primary)', marginBottom: 4 }}>
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

      {activeClients.length === 0 && invitedClients.length === 0 ? (
        <div className="card" style={{ padding: 40, textAlign: 'center', color: 'var(--color-text-muted)' }}>
          No clients yet. Click &ldquo;Invite Client&rdquo; to get started.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {activeClients.map(client => (
            <div
              key={client.id}
              className="card mobile-grid-1"
              onClick={() => { trackClick('agent_client_row', { client_id: client.id }); router.push(`/agent/${client.id}`); }}
              style={{
                padding: '16px 20px',
                cursor: 'pointer',
                display: 'grid',
                gridTemplateColumns: '1fr auto auto auto auto',
                alignItems: 'center',
                gap: '12px 20px',
                transition: 'box-shadow 0.15s',
              }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.boxShadow = '0 2px 8px rgba(0,0,0,0.08)'; }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.boxShadow = ''; }}
            >
              <div>
                <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-text)' }}>
                  {client.full_name || client.email}
                </div>
                {client.full_name && (
                  <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>{client.email}</div>
                )}
              </div>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginBottom: 2 }}>Policies</div>
                <div style={{ fontSize: 14, fontWeight: 600 }}>{client.policy_count}</div>
              </div>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginBottom: 2 }}>Score</div>
                <ScoreBadge score={client.protection_score} />
              </div>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginBottom: 2 }}>Flagged</div>
                <div style={{ fontSize: 14, fontWeight: 600, color: client.flagged_count > 0 ? 'var(--color-danger)' : 'var(--color-text-muted)' }}>
                  {client.flagged_count || '--'}
                </div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginBottom: 2 }}>Next Renewal</div>
                <div style={{ fontSize: 13, color: 'var(--color-text-secondary)' }}>
                  {client.next_renewal || '--'}
                </div>
              </div>
            </div>
          ))}

          {/* Invited / pending clients */}
          {invitedClients.length > 0 && (
            <>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-text-muted)', marginTop: 16, marginBottom: 4 }}>
                Pending Invites
              </div>
              {invitedClients.map((client, i) => (
                <div
                  key={`invited-${i}`}
                  className="card"
                  style={{
                    padding: '14px 20px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    opacity: 0.7,
                  }}
                >
                  <div style={{ fontSize: 14, color: 'var(--color-text-secondary)' }}>{client.email}</div>
                  <span style={{
                    padding: '2px 10px',
                    borderRadius: 12,
                    fontSize: 12,
                    fontWeight: 600,
                    backgroundColor: '#fef3c7',
                    color: '#92400e',
                  }}>
                    Invited
                  </span>
                </div>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}
