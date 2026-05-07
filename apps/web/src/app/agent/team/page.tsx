'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '../../../../lib/auth';
import { agentApi, AgencyContext, AgencyMember } from '../../../../lib/api';
import { trackClick, trackFeatureUse } from '../../../../lib/track';
import BackButton from '../../components/BackButton';

const ROLE_OPTIONS: AgencyMember['role'][] = ['owner', 'producer', 'csr', 'viewer'];
const ROLE_LABEL: Record<AgencyMember['role'], string> = {
  owner: 'Owner',
  producer: 'Producer',
  csr: 'CSR',
  viewer: 'Viewer',
};
const ROLE_DESCRIPTION: Record<AgencyMember['role'], string> = {
  owner: 'Full access — invite members, change roles, edit agency',
  producer: 'Day-to-day client work — invite, edit, share',
  csr: 'Client servicing — invite, edit, share, no team changes',
  viewer: 'Read-only access',
};

export default function TeamPage() {
  const { token, role } = useAuth();
  const router = useRouter();

  const [agency, setAgency] = useState<AgencyContext | null>(null);
  const [members, setMembers] = useState<AgencyMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Invite form
  const [showInvite, setShowInvite] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<AgencyMember['role']>('producer');
  const [inviting, setInviting] = useState(false);
  const [inviteMsg, setInviteMsg] = useState('');

  // Agency name edit
  const [editingName, setEditingName] = useState(false);
  const [agencyNameInput, setAgencyNameInput] = useState('');
  const [savingName, setSavingName] = useState(false);

  // Role / remove pending state per row
  const [rowBusy, setRowBusy] = useState<Record<number, boolean>>({});

  const isOwner = agency?.role === 'owner';

  useEffect(() => {
    if (!token) { router.replace('/login'); return; }
    if (role && role !== 'agent' && role !== 'admin') { router.replace('/policies'); return; }
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, role]);

  async function load() {
    try {
      setLoading(true);
      const [ctx, mlist] = await Promise.all([
        agentApi.agencyMe(),
        agentApi.agencyMembers(),
      ]);
      setAgency(ctx);
      setMembers(mlist);
      setAgencyNameInput(ctx?.agency_name || '');
    } catch (err: any) {
      setError(err.message || 'Failed to load team');
    } finally {
      setLoading(false);
    }
  }

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault();
    if (!inviteEmail.trim()) return;
    setInviting(true);
    setInviteMsg('');
    trackClick('team_invite_member', { role: inviteRole });
    try {
      const res = await agentApi.inviteMember(inviteEmail.trim().toLowerCase(), inviteRole);
      trackFeatureUse('team_member_invited', { status: res.status });
      setInviteMsg(res.status === 'active' ? 'Member added (already had a Covrabl account).' : 'Invitation sent.');
      setInviteEmail('');
      setInviteRole('producer');
      await load();
    } catch (err: any) {
      setInviteMsg(err.message || 'Failed to invite');
    } finally {
      setInviting(false);
    }
  }

  async function handleRoleChange(m: AgencyMember, newRole: AgencyMember['role']) {
    if (newRole === m.role) return;
    setRowBusy(prev => ({ ...prev, [m.member_id]: true }));
    try {
      await agentApi.updateMemberRole(m.member_id, newRole);
      trackFeatureUse('team_role_changed', { from: m.role, to: newRole });
      await load();
    } catch (err: any) {
      alert(err.message || 'Failed to update role');
    } finally {
      setRowBusy(prev => ({ ...prev, [m.member_id]: false }));
    }
  }

  async function handleRemove(m: AgencyMember) {
    if (!confirm(`Remove ${m.name || m.email} from the team?`)) return;
    setRowBusy(prev => ({ ...prev, [m.member_id]: true }));
    try {
      await agentApi.removeMember(m.member_id);
      trackFeatureUse('team_member_removed', { role: m.role });
      await load();
    } catch (err: any) {
      alert(err.message || 'Failed to remove');
    } finally {
      setRowBusy(prev => ({ ...prev, [m.member_id]: false }));
    }
  }

  async function handleSaveAgencyName() {
    const name = agencyNameInput.trim();
    if (!name || name === agency?.agency_name) {
      setEditingName(false);
      return;
    }
    setSavingName(true);
    try {
      const res = await agentApi.updateAgency({ name });
      setAgency(prev => prev ? { ...prev, agency_name: res.name } : prev);
      setEditingName(false);
    } catch (err: any) {
      alert(err.message || 'Failed to update agency name');
    } finally {
      setSavingName(false);
    }
  }

  async function handleCreateAgency() {
    const name = prompt('Name your agency (you can rename it later):', '') || '';
    if (!name.trim()) return;
    try {
      await agentApi.createAgency(name.trim());
      trackFeatureUse('team_agency_created');
      await load();
    } catch (err: any) {
      alert(err.message || 'Failed to create agency');
    }
  }

  if (loading) return <div style={{ padding: 32 }}>Loading…</div>;
  if (error) return <div style={{ padding: 32, color: 'var(--color-danger)' }}>{error}</div>;
  if (!agency || !agency.agency_id) {
    return (
      <div style={{ padding: 32, maxWidth: 600, margin: '0 auto' }}>
        <BackButton href="/agent" label="Team" parentLabel="My Clients" />
        <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--color-text)', margin: '8px 0 12px' }}>Set up your agency</h1>
        <p style={{ fontSize: 14, color: 'var(--color-text-secondary)', lineHeight: 1.6, marginBottom: 16 }}>
          Covrabl works as an agency platform — even solo agents are an "agency of one." Setting one up lets you:
        </p>
        <ul style={{ fontSize: 14, color: 'var(--color-text-secondary)', lineHeight: 1.7, paddingLeft: 20, marginBottom: 24 }}>
          <li>Invite producers, CSRs, and viewers as your team grows</li>
          <li>Assign producers to specific clients</li>
          <li>Brand the client-facing pages your clients see (later)</li>
        </ul>
        <button
          onClick={handleCreateAgency}
          style={{ padding: '10px 22px', backgroundColor: 'var(--color-primary)', color: '#fff', border: 'none', borderRadius: 'var(--radius-md)', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}
        >
          + Set up my agency
        </button>
      </div>
    );
  }

  const activeMembers = members.filter(m => m.status === 'active');
  const invitedMembers = members.filter(m => m.status === 'invited');

  return (
    <div style={{ padding: '32px 24px', maxWidth: 800, margin: '0 auto' }}>
      <BackButton href="/agent" label="Team" parentLabel="My Clients" />

      {/* Header — agency name (editable for owner) */}
      <div style={{ marginBottom: 24 }}>
        {editingName ? (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input
              type="text"
              value={agencyNameInput}
              onChange={e => setAgencyNameInput(e.target.value)}
              autoFocus
              style={{
                fontSize: 22, fontWeight: 700, padding: '4px 8px',
                border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)',
                color: 'var(--color-text)', flex: 1, maxWidth: 400,
              }}
            />
            <button
              onClick={handleSaveAgencyName}
              disabled={savingName}
              style={{ padding: '6px 14px', fontSize: 13, fontWeight: 600, backgroundColor: 'var(--color-primary)', color: '#fff', border: 'none', borderRadius: 'var(--radius-sm)', cursor: 'pointer' }}
            >
              {savingName ? 'Saving…' : 'Save'}
            </button>
            <button
              onClick={() => { setEditingName(false); setAgencyNameInput(agency.agency_name || ''); }}
              style={{ padding: '6px 14px', fontSize: 13, backgroundColor: 'transparent', color: 'var(--color-text-secondary)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', cursor: 'pointer' }}
            >
              Cancel
            </button>
          </div>
        ) : (
          <h1 style={{ fontSize: 24, fontWeight: 700, margin: 0, color: 'var(--color-text)', display: 'flex', alignItems: 'center', gap: 12 }}>
            <span>{agency.agency_name}</span>
            {isOwner && (
              <button
                onClick={() => setEditingName(true)}
                title="Rename agency"
                style={{ fontSize: 12, padding: '2px 8px', backgroundColor: 'transparent', color: 'var(--color-text-muted)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', cursor: 'pointer' }}
              >
                Rename
              </button>
            )}
          </h1>
        )}
        <p style={{ fontSize: 14, color: 'var(--color-text-secondary)', margin: '4px 0 0' }}>
          {activeMembers.length} {activeMembers.length === 1 ? 'member' : 'members'}
          {invitedMembers.length > 0 && ` · ${invitedMembers.length} pending`}
        </p>
      </div>

      {/* Invite (Owner only) */}
      {isOwner && (
        <div style={{ marginBottom: 24 }}>
          {!showInvite ? (
            <button
              onClick={() => { setShowInvite(true); setInviteMsg(''); trackClick('team_open_invite_form'); }}
              style={{ padding: '10px 18px', fontSize: 14, fontWeight: 600, backgroundColor: 'var(--color-primary)', color: '#fff', border: 'none', borderRadius: 'var(--radius-md)', cursor: 'pointer' }}
            >
              + Invite Member
            </button>
          ) : (
            <form onSubmit={handleInvite} style={{ padding: 16, backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)' }}>
              <h3 style={{ fontSize: 14, fontWeight: 600, margin: '0 0 12px', color: 'var(--color-text)' }}>Invite a team member</h3>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <input
                  type="email"
                  required
                  value={inviteEmail}
                  onChange={e => setInviteEmail(e.target.value)}
                  placeholder="teammate@email.com"
                  style={{ flex: 1, minWidth: 200, padding: '8px 12px', fontSize: 14, border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)' }}
                />
                <select
                  value={inviteRole}
                  onChange={e => setInviteRole(e.target.value as AgencyMember['role'])}
                  style={{ padding: '8px 12px', fontSize: 14, border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', backgroundColor: 'var(--color-background)' }}
                >
                  {ROLE_OPTIONS.map(r => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
                </select>
                <button
                  type="submit"
                  disabled={inviting || !inviteEmail}
                  style={{ padding: '8px 18px', fontSize: 14, fontWeight: 600, backgroundColor: 'var(--color-primary)', color: '#fff', border: 'none', borderRadius: 'var(--radius-sm)', cursor: 'pointer', opacity: inviting ? 0.7 : 1 }}
                >
                  {inviting ? 'Sending…' : 'Send Invite'}
                </button>
                <button
                  type="button"
                  onClick={() => { setShowInvite(false); setInviteMsg(''); }}
                  style={{ padding: '8px 14px', fontSize: 14, backgroundColor: 'transparent', color: 'var(--color-text-secondary)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', cursor: 'pointer' }}
                >
                  Cancel
                </button>
              </div>
              <p style={{ fontSize: 12, color: 'var(--color-text-muted)', margin: '8px 0 0' }}>
                {ROLE_DESCRIPTION[inviteRole]}
              </p>
              {inviteMsg && (
                <p style={{ fontSize: 13, color: inviteMsg.toLowerCase().includes('fail') || inviteMsg.toLowerCase().includes('error') || inviteMsg.toLowerCase().includes('already') ? 'var(--color-danger)' : 'var(--color-success)', margin: '8px 0 0' }}>
                  {inviteMsg}
                </p>
              )}
            </form>
          )}
        </div>
      )}

      {/* Members list */}
      <div style={{ marginBottom: 24 }}>
        <h2 style={{ fontSize: 14, fontWeight: 600, margin: '0 0 8px', color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: 0.5 }}>
          Members
        </h2>
        <div style={{ border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', overflow: 'hidden', backgroundColor: 'var(--color-surface)' }}>
          {activeMembers.map((m, i) => (
            <div
              key={m.member_id}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                padding: '14px 16px',
                borderTop: i === 0 ? 'none' : '1px solid var(--color-border)',
              }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-text)' }}>{m.name || m.email || 'Unknown'}</div>
                {m.name && m.email && m.email !== m.name && (
                  <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>{m.email}</div>
                )}
              </div>
              {isOwner && m.user_id !== null ? (
                <select
                  value={m.role}
                  onChange={e => handleRoleChange(m, e.target.value as AgencyMember['role'])}
                  disabled={!!rowBusy[m.member_id]}
                  style={{ padding: '4px 8px', fontSize: 13, border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', backgroundColor: 'var(--color-background)' }}
                >
                  {ROLE_OPTIONS.map(r => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
                </select>
              ) : (
                <span style={{ fontSize: 12, padding: '3px 10px', borderRadius: 12, backgroundColor: '#f3f4f6', color: '#374151', textTransform: 'capitalize' }}>{m.role}</span>
              )}
              {isOwner && (
                <button
                  onClick={() => handleRemove(m)}
                  disabled={!!rowBusy[m.member_id]}
                  title="Remove member"
                  style={{ padding: '4px 10px', fontSize: 12, backgroundColor: 'transparent', color: 'var(--color-danger)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', cursor: 'pointer' }}
                >
                  Remove
                </button>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Pending invites */}
      {invitedMembers.length > 0 && (
        <div>
          <h2 style={{ fontSize: 14, fontWeight: 600, margin: '0 0 8px', color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: 0.5 }}>
            Pending Invites
          </h2>
          <div style={{ border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', overflow: 'hidden', backgroundColor: 'var(--color-surface)' }}>
            {invitedMembers.map((m, i) => (
              <div
                key={m.member_id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  padding: '14px 16px',
                  borderTop: i === 0 ? 'none' : '1px solid var(--color-border)',
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-text)' }}>{m.email}</div>
                  <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>Awaiting acceptance · invited as {ROLE_LABEL[m.role]}</div>
                </div>
                {isOwner && (
                  <button
                    onClick={() => handleRemove(m)}
                    disabled={!!rowBusy[m.member_id]}
                    style={{ padding: '4px 10px', fontSize: 12, backgroundColor: 'transparent', color: 'var(--color-danger)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', cursor: 'pointer' }}
                  >
                    Cancel
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Trust footer */}
      <p style={{ fontSize: 12, color: 'var(--color-text-muted)', margin: '24px 0 0', lineHeight: 1.5 }}>
        Members of {agency.agency_name} share access to all client records, notes, and renewal reviews.
        Producer assignment on individual clients lets you keep ownership clear within the team.
      </p>
    </div>
  );
}
