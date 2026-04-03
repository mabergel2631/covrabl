'use client';

import { useState, useEffect } from 'react';
import { agentApi, policiesApi, Policy } from '../../../lib/api';
import { trackClick, trackFeatureUse } from '../../../lib/track';

type Invite = {
  id: number;
  agent_id: number;
  agent_email: string;
  agent_name: string | null;
  created_at: string | null;
};

export default function AgentInviteBanner() {
  const [invites, setInvites] = useState<Invite[]>([]);
  const [responding, setResponding] = useState<number | null>(null);
  const [expandedInvite, setExpandedInvite] = useState<number | null>(null);
  const [policies, setPolicies] = useState<Policy[]>([]);
  const [selectedPolicies, setSelectedPolicies] = useState<Set<number>>(new Set());
  const [loadingPolicies, setLoadingPolicies] = useState(false);

  useEffect(() => {
    agentApi.myInvites().then(setInvites).catch(() => {});
  }, []);

  if (invites.length === 0) return null;

  const handleReview = async (inviteId: number) => {
    trackClick('agent_invite_review', { invite_id: inviteId });
    setExpandedInvite(expandedInvite === inviteId ? null : inviteId);
    if (policies.length === 0) {
      setLoadingPolicies(true);
      try {
        const p = await policiesApi.list();
        setPolicies(p);
        setSelectedPolicies(new Set(p.map(pol => pol.id)));
      } catch { /* ignore */ }
      finally { setLoadingPolicies(false); }
    }
  };

  const togglePolicy = (policyId: number) => {
    trackClick('agent_invite_toggle_policy', { policy_id: policyId });
    setSelectedPolicies(prev => {
      const next = new Set(prev);
      if (next.has(policyId)) next.delete(policyId);
      else next.add(policyId);
      return next;
    });
  };

  const handleAccept = async (inviteId: number) => {
    setResponding(inviteId);
    trackClick('agent_invite_accept', { invite_id: inviteId, shared_count: selectedPolicies.size, total_count: policies.length });
    try {
      await agentApi.respondToInvite(inviteId, 'accept', Array.from(selectedPolicies));
      trackFeatureUse('agent_invite_accepted', { invite_id: inviteId, shared_count: selectedPolicies.size });
      setInvites(prev => prev.filter(i => i.id !== inviteId));
      setExpandedInvite(null);
    } catch (err: any) {
      alert(err.message || 'Failed to accept');
    } finally {
      setResponding(null);
    }
  };

  const handleDecline = async (inviteId: number) => {
    setResponding(inviteId);
    trackClick('agent_invite_decline', { invite_id: inviteId });
    try {
      await agentApi.respondToInvite(inviteId, 'decline');
      trackFeatureUse('agent_invite_declined', { invite_id: inviteId });
      setInvites(prev => prev.filter(i => i.id !== inviteId));
      setExpandedInvite(null);
    } catch (err: any) {
      alert(err.message || 'Failed to decline');
    } finally {
      setResponding(null);
    }
  };

  return (
    <div style={{ marginBottom: 24 }}>
      {invites.map(invite => (
        <div
          key={invite.id}
          className="card"
          style={{
            marginBottom: 8,
            backgroundColor: '#eff6ff',
            border: '1px solid #bfdbfe',
            overflow: 'hidden',
          }}
        >
          {/* Header */}
          <div style={{ padding: '16px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
            <div>
              <div style={{ fontSize: 15, fontWeight: 600, color: '#1e40af', marginBottom: 4 }}>
                Agent access request
              </div>
              <div style={{ fontSize: 13, color: '#1e40af' }}>
                <strong>{invite.agent_name || invite.agent_email}</strong> is requesting to view your insurance policies.
                {invite.agent_name && (
                  <span style={{ color: '#3b82f6', marginLeft: 4 }}>({invite.agent_email})</span>
                )}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                onClick={() => handleReview(invite.id)}
                style={{
                  padding: '8px 20px',
                  backgroundColor: '#2563eb',
                  color: '#fff',
                  border: 'none',
                  borderRadius: 6,
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                {expandedInvite === invite.id ? 'Hide Details' : 'Review Request'}
              </button>
              <button
                onClick={() => handleDecline(invite.id)}
                disabled={responding === invite.id}
                style={{
                  padding: '8px 20px',
                  backgroundColor: 'transparent',
                  color: '#dc2626',
                  border: '1px solid #dc2626',
                  borderRadius: 6,
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: responding === invite.id ? 'wait' : 'pointer',
                  opacity: responding === invite.id ? 0.6 : 1,
                }}
              >
                Decline
              </button>
            </div>
          </div>

          {/* Expanded: policy selection + security info */}
          {expandedInvite === invite.id && (
            <div style={{ padding: '0 20px 20px', borderTop: '1px solid #bfdbfe' }}>

              {/* Security strip */}
              <div style={{
                display: 'flex', alignItems: 'center', gap: 8,
                padding: '12px 16px', margin: '16px 0',
                backgroundColor: '#f0fdf4', borderRadius: 8, border: '1px solid #bbf7d0',
                fontSize: 12, color: '#166534',
              }}>
                <span style={{ fontSize: 16 }}>&#128274;</span>
                <span>
                  <strong>Your data is protected.</strong> Bank-level encryption. Your information is private and never sold or shared without your permission.
                </span>
              </div>

              {/* Consent explanation */}
              <div style={{ fontSize: 13, color: '#1e40af', marginBottom: 16, lineHeight: 1.6 }}>
                By accepting this request, <strong>{invite.agent_name || invite.agent_email}</strong> will be able to view the policies you select below.
                You can change which policies are shared at any time from your <strong>Agent Access</strong> settings.
              </div>

              {/* Policy selection */}
              <div style={{ fontSize: 14, fontWeight: 600, color: '#1e40af', marginBottom: 8 }}>
                Select policies to share
              </div>

              {loadingPolicies ? (
                <div style={{ padding: 16, color: '#3b82f6', fontSize: 13 }}>Loading your policies...</div>
              ) : policies.length === 0 ? (
                <div style={{ padding: 16, color: '#64748b', fontSize: 13 }}>
                  No policies uploaded yet. Your agent will be able to upload policies on your behalf after you accept.
                </div>
              ) : (
                <>
                  <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
                    <button
                      onClick={() => { trackClick('agent_invite_select_all'); setSelectedPolicies(new Set(policies.map(p => p.id))); }}
                      style={{ fontSize: 12, color: '#2563eb', background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline', padding: 0 }}
                    >
                      Select All
                    </button>
                    <button
                      onClick={() => { trackClick('agent_invite_select_none'); setSelectedPolicies(new Set()); }}
                      style={{ fontSize: 12, color: '#2563eb', background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline', padding: 0 }}
                    >
                      Select None
                    </button>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 200, overflowY: 'auto' }}>
                    {policies.map(p => (
                      <label
                        key={p.id}
                        onClick={() => togglePolicy(p.id)}
                        style={{
                          display: 'flex', alignItems: 'center', gap: 10,
                          padding: '8px 12px', borderRadius: 6, cursor: 'pointer',
                          backgroundColor: selectedPolicies.has(p.id) ? '#dbeafe' : '#f8fafc',
                          border: `1px solid ${selectedPolicies.has(p.id) ? '#93c5fd' : '#e2e8f0'}`,
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={selectedPolicies.has(p.id)}
                          onChange={() => {}}
                          style={{ accentColor: '#2563eb' }}
                        />
                        <div style={{ flex: 1 }}>
                          <div style={{ fontSize: 13, fontWeight: 600, color: '#1e293b' }}>{p.carrier}</div>
                          <div style={{ fontSize: 11, color: '#64748b' }}>{p.policy_type} {p.policy_number && `· ${p.policy_number}`}</div>
                        </div>
                      </label>
                    ))}
                  </div>
                </>
              )}

              {/* Accept button */}
              <div style={{ marginTop: 16, display: 'flex', alignItems: 'center', gap: 12 }}>
                <button
                  onClick={() => handleAccept(invite.id)}
                  disabled={responding === invite.id}
                  style={{
                    padding: '10px 28px',
                    backgroundColor: '#2563eb',
                    color: '#fff',
                    border: 'none',
                    borderRadius: 6,
                    fontSize: 14,
                    fontWeight: 600,
                    cursor: responding === invite.id ? 'wait' : 'pointer',
                    opacity: responding === invite.id ? 0.6 : 1,
                  }}
                >
                  {responding === invite.id ? 'Accepting...' : `Accept & Share ${selectedPolicies.size} ${selectedPolicies.size === 1 ? 'Policy' : 'Policies'}`}
                </button>
                <span style={{ fontSize: 12, color: '#64748b' }}>
                  You can update shared policies anytime
                </span>
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
