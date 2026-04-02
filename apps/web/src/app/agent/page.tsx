'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '../../../lib/auth';
import { agentApi, AgentOverview, AgentClient } from '../../../lib/api';
import { trackClick, trackFeatureUse } from '../../../lib/track';
import BackButton from '../components/BackButton';

const statusConfig = {
  gaps: { label: 'Gaps Detected', icon: '\u2757', color: 'var(--color-danger)', bg: '#fef2f2' },
  review: { label: 'Review Recommended', icon: '\u26A0\uFE0F', color: '#92400e', bg: '#fef3c7' },
  good: { label: 'Good', icon: '\u2705', color: 'var(--color-success)', bg: '#dcfce7' },
} as const;

function CoverageStatusBadge({ status }: { status: 'good' | 'review' | 'gaps' }) {
  const cfg = statusConfig[status] || statusConfig.good;
  return (
    <span style={{
      display: 'inline-flex',
      alignItems: 'center',
      gap: 4,
      padding: '3px 10px',
      borderRadius: 12,
      fontSize: 12,
      fontWeight: 600,
      backgroundColor: cfg.bg,
      color: cfg.color,
      whiteSpace: 'nowrap',
    }}>
      {cfg.label}
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

  // Search & sort
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState<'urgency' | 'az' | 'za' | 'newest' | 'policies'>('urgency');

  useEffect(() => {
    if (!token) { router.replace('/login'); return; }
    if (role && role !== 'agent' && role !== 'admin') { router.replace('/policies'); return; }

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

  const statusOrder = { gaps: 0, review: 1, good: 2 };
  const query = searchQuery.toLowerCase();
  const activeClients = clients
    .filter(c => c.status === 'active')
    .filter(c => {
      if (!query) return true;
      return (c.full_name || '').toLowerCase().includes(query) || c.email.toLowerCase().includes(query);
    })
    .sort((a, b) => {
      if (sortBy === 'az') return (a.full_name || a.email).localeCompare(b.full_name || b.email);
      if (sortBy === 'za') return (b.full_name || b.email).localeCompare(a.full_name || a.email);
      if (sortBy === 'policies') return (b.policy_count ?? 0) - (a.policy_count ?? 0);
      if (sortBy === 'newest') return (b.id ?? 0) - (a.id ?? 0);
      // urgency (default)
      return (statusOrder[a.coverage_status] ?? 2) - (statusOrder[b.coverage_status] ?? 2);
    });
  const invitedClients = clients.filter(c => c.status === 'invited' || c.status === 'pending');

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
      <p style={{ fontSize: 14, color: 'var(--color-text-secondary)', margin: '0 0 16px' }}>
        See which clients need attention right now.
      </p>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--color-text-muted)', marginBottom: 24 }}>
        <span style={{ fontSize: 14 }}>&#128274;</span>
        <span>Bank-level encryption &middot; Your data is private and never sold</span>
      </div>

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

      {/* Needs Attention — top 5 clients with issues */}
      {(() => {
        const needsAttention = activeClients.filter(c => c.coverage_status !== 'good').slice(0, 5);
        if (needsAttention.length === 0) return null;
        return (
          <div style={{ marginBottom: 32 }}>
            <h2 style={{ fontSize: 16, fontWeight: 600, margin: '0 0 12px', color: 'var(--color-text)' }}>
              Needs Attention
            </h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {needsAttention.map(client => (
                <div
                  key={`attn-${client.id}`}
                  className="card"
                  onClick={() => { trackClick('agent_needs_attention_row', { client_id: client.id, coverage_status: client.coverage_status }); router.push(`/agent/${client.id}`); }}
                  style={{
                    padding: '12px 20px',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 16,
                    transition: 'box-shadow 0.15s',
                  }}
                  onMouseEnter={e => { (e.currentTarget as HTMLElement).style.boxShadow = '0 2px 8px rgba(0,0,0,0.08)'; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLElement).style.boxShadow = ''; }}
                >
                  <CoverageStatusBadge status={client.coverage_status} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-text)' }}>
                      {client.full_name || client.email}
                    </span>
                  </div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-text)', textAlign: 'right', flexShrink: 0 }}>
                    {client.next_action}
                  </div>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

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
      <div className="mobile-col" style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
        <h2 style={{ fontSize: 18, fontWeight: 600, margin: 0, color: 'var(--color-text)' }}>
          Clients
        </h2>
        <div style={{ display: 'flex', gap: 8, flex: 1, minWidth: 180 }}>
          <input
            type="text"
            placeholder="Search by name or email..."
            value={searchQuery}
            onChange={e => { setSearchQuery(e.target.value); trackClick('agent_search', { query: e.target.value }); }}
            style={{
              flex: 1,
              padding: '8px 12px',
              border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius-md)',
              fontSize: 13,
              outline: 'none',
              backgroundColor: 'var(--color-surface)',
              color: 'var(--color-text)',
            }}
          />
        </div>
        <select
          value={sortBy}
          onChange={e => { setSortBy(e.target.value as any); trackClick('agent_sort', { sort: e.target.value }); }}
          style={{
            padding: '8px 12px',
            border: '1px solid var(--color-border)',
            borderRadius: 'var(--radius-md)',
            fontSize: 13,
            backgroundColor: 'var(--color-surface)',
            color: 'var(--color-text)',
            cursor: 'pointer',
          }}
        >
          <option value="urgency">Sort: Urgency</option>
          <option value="az">Sort: A → Z</option>
          <option value="za">Sort: Z → A</option>
          <option value="newest">Sort: Newest</option>
          <option value="policies">Sort: Most Policies</option>
        </select>
      </div>

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
              onClick={() => { trackClick('agent_client_row', { client_id: client.id, coverage_status: client.coverage_status }); router.push(`/agent/${client.id}`); }}
              style={{
                padding: '16px 20px',
                cursor: 'pointer',
                display: 'grid',
                gridTemplateColumns: '1.2fr auto 1.5fr auto auto',
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
                <CoverageStatusBadge status={client.coverage_status} />
              </div>
              <div>
                <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginBottom: 2 }}>Next Action</div>
                <div style={{
                  fontSize: 13,
                  fontWeight: 600,
                  color: client.coverage_status === 'good' ? 'var(--color-text-muted)' : 'var(--color-text)',
                }}>
                  {client.next_action}
                </div>
              </div>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginBottom: 2 }}>Policies</div>
                <div style={{ fontSize: 14, fontWeight: 600 }}>{client.policy_count}</div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginBottom: 2 }}>Updated</div>
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
                    backgroundColor: client.status === 'pending' ? '#dbeafe' : '#fef3c7',
                    color: client.status === 'pending' ? '#1e40af' : '#92400e',
                  }}>
                    {client.status === 'pending' ? 'Awaiting Approval' : 'Invited'}
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
