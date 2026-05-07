'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '../../../lib/auth';
import { agentApi, AgentOverview, AgentClient } from '../../../lib/api';
import { trackClick, trackFeatureUse } from '../../../lib/track';
import BackButton from '../components/BackButton';

const statusConfig = {
  gaps: { label: 'Items to Review', icon: '\u2757', color: 'var(--color-danger)', bg: '#fef2f2' },
  review: { label: 'Review Recommended', icon: '\u26A0\uFE0F', color: '#92400e', bg: '#fef3c7' },
  good: { label: 'On Track', icon: '\u2705', color: 'var(--color-success)', bg: '#dcfce7' },
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
  const [inviteMode, setInviteMode] = useState<'single' | 'bulk'>('single');
  const [inviteEmail, setInviteEmail] = useState('');
  const [bulkEmails, setBulkEmails] = useState('');
  const [bulkResults, setBulkResults] = useState<{ email: string; ok: boolean; message: string }[] | null>(null);
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

  const handleBulkInvite = async () => {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const raw = bulkEmails.split(/[\s,;]+/).map(e => e.trim()).filter(Boolean);
    const seen = new Set<string>();
    const unique = raw.filter(e => {
      const lower = e.toLowerCase();
      if (seen.has(lower)) return false;
      seen.add(lower);
      return true;
    });
    if (unique.length === 0) {
      setInviteMsg('Paste at least one email address.');
      return;
    }
    setInviting(true);
    setInviteMsg('');
    setBulkResults(null);
    trackClick('agent_bulk_invite_submit', { count: unique.length });

    const results: { email: string; ok: boolean; message: string }[] = [];
    for (const email of unique) {
      if (!emailRegex.test(email)) {
        results.push({ email, ok: false, message: 'Invalid email format' });
        continue;
      }
      try {
        const r = await agentApi.inviteClient(email);
        results.push({
          email,
          ok: true,
          message: r.status === 'active' ? 'Added' : 'Invite sent',
        });
      } catch (err: any) {
        results.push({ email, ok: false, message: err.message || 'Failed' });
      }
    }
    setBulkResults(results);
    const okCount = results.filter(r => r.ok).length;
    trackFeatureUse('agent_bulk_invite_done', { total: results.length, ok: okCount });

    // Refresh client list
    try {
      const [ov, cl] = await Promise.all([agentApi.overview(), agentApi.clients()]);
      setOverview(ov);
      setClients(cl);
    } catch {
      // ignore refresh failures; results are still shown
    }
    setBulkEmails('');
    setInviting(false);
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

  const itemsNeedingReview = clients.filter(c => c.status === 'active' && c.coverage_status !== 'good').length;
  const statCards = [
    { label: 'Active Clients', value: overview?.total_clients ?? 0 },
    { label: 'Policies Uploaded', value: overview?.total_policies ?? 0 },
    { label: 'Upcoming Renewals', value: overview?.upcoming_renewals ?? 0 },
    { label: 'Items Needing Review', value: itemsNeedingReview, color: itemsNeedingReview > 0 ? 'var(--color-danger)' : undefined },
    { label: 'Avg Coverage Readiness', value: overview?.avg_protection_score ?? '--' },
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
        See which clients have items to review right now.
      </p>
      <div style={{
        padding: '10px 14px',
        marginBottom: 16,
        backgroundColor: '#f0f9ff',
        border: '1px solid #bae6fd',
        borderRadius: 'var(--radius-md)',
        fontSize: 12,
        lineHeight: 1.5,
        color: '#0c4a6e',
      }}>
        <strong>AI-generated insights.</strong> Coverage readiness, status, and suggested next actions are generated from uploaded documents and should be reviewed with the client&rsquo;s agent and confirmed against the actual policy.
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--color-text-muted)', marginBottom: 24 }}>
        <span style={{ fontSize: 14 }}>&#128274;</span>
        <span>Bank-level encryption &middot; Your data is private and never sold</span>
      </div>

      {/* Invite form */}
      {showInvite && (
        <div className="card" style={{ padding: 20, marginBottom: 24 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12, gap: 12, flexWrap: 'wrap' }}>
            <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--color-text)' }}>
              {inviteMode === 'single' ? 'Invite a Client' : 'Bulk Invite Clients'}
            </div>
            <div style={{ display: 'flex', gap: 0, border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', overflow: 'hidden' }}>
              <button
                onClick={() => { setInviteMode('single'); setBulkResults(null); setInviteMsg(''); trackClick('agent_invite_mode_single'); }}
                style={{
                  padding: '6px 14px',
                  fontSize: 12,
                  fontWeight: 600,
                  border: 'none',
                  cursor: 'pointer',
                  backgroundColor: inviteMode === 'single' ? 'var(--color-primary)' : 'transparent',
                  color: inviteMode === 'single' ? '#fff' : 'var(--color-text-secondary)',
                }}
              >
                Single
              </button>
              <button
                onClick={() => { setInviteMode('bulk'); setInviteMsg(''); trackClick('agent_invite_mode_bulk'); }}
                style={{
                  padding: '6px 14px',
                  fontSize: 12,
                  fontWeight: 600,
                  border: 'none',
                  cursor: 'pointer',
                  backgroundColor: inviteMode === 'bulk' ? 'var(--color-primary)' : 'transparent',
                  color: inviteMode === 'bulk' ? '#fff' : 'var(--color-text-secondary)',
                }}
              >
                Bulk
              </button>
            </div>
          </div>

          {inviteMode === 'single' ? (
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
          ) : (
            <div>
              <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginBottom: 6 }}>
                Paste one email per line or separated by commas. Duplicates and invalid addresses are skipped.
              </div>
              <textarea
                placeholder={'client1@email.com\nclient2@email.com\nclient3@email.com'}
                value={bulkEmails}
                onChange={e => setBulkEmails(e.target.value)}
                rows={6}
                style={{
                  width: '100%',
                  padding: '10px 14px',
                  border: '1px solid var(--color-border)',
                  borderRadius: 'var(--radius-md)',
                  fontSize: 14,
                  outline: 'none',
                  backgroundColor: 'var(--color-surface)',
                  color: 'var(--color-text)',
                  resize: 'vertical',
                  fontFamily: 'inherit',
                }}
              />
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}>
                <button
                  onClick={handleBulkInvite}
                  disabled={inviting || !bulkEmails.trim()}
                  style={{
                    padding: '10px 24px',
                    backgroundColor: 'var(--color-primary)',
                    color: '#fff',
                    border: 'none',
                    borderRadius: 'var(--radius-md)',
                    fontSize: 14,
                    fontWeight: 600,
                    cursor: inviting ? 'wait' : 'pointer',
                    opacity: inviting || !bulkEmails.trim() ? 0.6 : 1,
                  }}
                >
                  {inviting ? 'Sending...' : 'Send Invites'}
                </button>
              </div>
            </div>
          )}

          {inviteMsg && (
            <div style={{ marginTop: 8, fontSize: 13, color: inviteMsg.includes('Failed') || inviteMsg.includes('Already') || inviteMsg.includes('Paste') ? 'var(--color-danger)' : 'var(--color-success)' }}>
              {inviteMsg}
            </div>
          )}

          {bulkResults && bulkResults.length > 0 && (
            <div style={{ marginTop: 12, borderTop: '1px solid var(--color-border)', paddingTop: 12 }}>
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8, color: 'var(--color-text)' }}>
                Results: {bulkResults.filter(r => r.ok).length} of {bulkResults.length} succeeded
              </div>
              <div style={{ maxHeight: 180, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 4 }}>
                {bulkResults.map((r, i) => (
                  <div key={i} style={{
                    fontSize: 12,
                    padding: '4px 8px',
                    backgroundColor: r.ok ? '#f0fdf4' : '#fef2f2',
                    borderRadius: 4,
                    display: 'flex',
                    justifyContent: 'space-between',
                    gap: 8,
                  }}>
                    <span style={{ color: 'var(--color-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.email}</span>
                    <span style={{ color: r.ok ? 'var(--color-success)' : 'var(--color-danger)', fontWeight: 600, flexShrink: 0 }}>
                      {r.message}
                    </span>
                  </div>
                ))}
              </div>
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
              Clients to Review
            </h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {needsAttention.map(client => (
                <div
                  key={`attn-${client.id}`}
                  className="card mobile-col"
                  onClick={() => { trackClick('agent_needs_attention_row', { client_id: client.id, coverage_status: client.coverage_status }); router.push(`/agent/${client.id}`); }}
                  style={{
                    padding: '12px 20px',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    flexWrap: 'wrap',
                    transition: 'box-shadow 0.15s',
                  }}
                  onMouseEnter={e => { (e.currentTarget as HTMLElement).style.boxShadow = '0 2px 8px rgba(0,0,0,0.08)'; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLElement).style.boxShadow = ''; }}
                >
                  <CoverageStatusBadge status={client.coverage_status} />
                  <div style={{ flex: 1, minWidth: 120 }}>
                    <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-text)' }}>
                      {client.full_name || client.email}
                    </span>
                  </div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-text-secondary)' }}>
                    {client.next_action}
                  </div>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {/* Renewal Review Pipeline */}
      {(() => {
        const today = new Date();
        const upcoming = activeClients
          .filter(c => c.next_renewal)
          .map(c => {
            const renewal = new Date(c.next_renewal as string);
            const days = Math.ceil((renewal.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
            return { client: c, renewal, days };
          })
          .filter(r => r.days >= -7)
          .sort((a, b) => a.days - b.days)
          .slice(0, 5);
        if (upcoming.length === 0) return null;
        const formatDays = (d: number) => {
          if (d < 0) return `${Math.abs(d)}d overdue`;
          if (d === 0) return 'Today';
          if (d === 1) return 'Tomorrow';
          return `in ${d}d`;
        };
        return (
          <div style={{ marginBottom: 32 }}>
            <h2 style={{ fontSize: 16, fontWeight: 600, margin: '0 0 4px', color: 'var(--color-text)' }}>
              Renewal Review Pipeline
            </h2>
            <p style={{ fontSize: 12, color: 'var(--color-text-muted)', margin: '0 0 12px' }}>
              Next 5 clients with upcoming renewal dates &mdash; review with each client before renewal.
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {upcoming.map(({ client, renewal, days }) => {
                const urgent = days <= 14;
                return (
                  <div
                    key={`renewal-${client.id}`}
                    className="card mobile-col"
                    onClick={() => { trackClick('agent_renewal_pipeline_row', { client_id: client.id, days }); router.push(`/agent/${client.id}`); }}
                    style={{
                      padding: '12px 16px',
                      cursor: 'pointer',
                      display: 'grid',
                      gridTemplateColumns: '90px 1fr auto auto',
                      alignItems: 'center',
                      gap: 12,
                      transition: 'box-shadow 0.15s',
                      borderLeft: urgent ? '3px solid var(--color-danger)' : '3px solid var(--color-border)',
                    }}
                    onMouseEnter={e => { (e.currentTarget as HTMLElement).style.boxShadow = '0 2px 8px rgba(0,0,0,0.08)'; }}
                    onMouseLeave={e => { (e.currentTarget as HTMLElement).style.boxShadow = ''; }}
                  >
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 700, color: urgent ? 'var(--color-danger)' : 'var(--color-text)' }}>
                        {formatDays(days)}
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>
                        {renewal.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                      </div>
                    </div>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {client.full_name || client.email}
                      </div>
                      <div style={{ fontSize: 12, color: 'var(--color-text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {client.next_action}
                      </div>
                    </div>
                    <CoverageStatusBadge status={client.coverage_status} />
                    <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>
                      {client.policy_count} {client.policy_count === 1 ? 'policy' : 'policies'}
                    </div>
                  </div>
                );
              })}
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
                <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginBottom: 2 }}>Suggested Next Step</div>
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
