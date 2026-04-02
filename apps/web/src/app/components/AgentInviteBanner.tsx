'use client';

import { useState, useEffect } from 'react';
import { agentApi } from '../../../lib/api';
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

  useEffect(() => {
    agentApi.myInvites().then(setInvites).catch(() => {});
  }, []);

  if (invites.length === 0) return null;

  const handleRespond = async (inviteId: number, action: 'accept' | 'decline') => {
    setResponding(inviteId);
    trackClick('agent_invite_respond', { invite_id: inviteId, action });
    try {
      await agentApi.respondToInvite(inviteId, action);
      trackFeatureUse('agent_invite_responded', { invite_id: inviteId, action });
      setInvites(prev => prev.filter(i => i.id !== inviteId));
    } catch (err: any) {
      alert(err.message || 'Failed to respond');
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
            padding: '16px 20px',
            marginBottom: 8,
            backgroundColor: '#eff6ff',
            border: '1px solid #bfdbfe',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
            <div>
              <div style={{ fontSize: 14, fontWeight: 600, color: '#1e40af', marginBottom: 4 }}>
                Agent access request
              </div>
              <div style={{ fontSize: 13, color: '#1e40af' }}>
                <strong>{invite.agent_name || invite.agent_email}</strong> wants to view your insurance policies.
                {invite.agent_name && (
                  <span style={{ color: '#3b82f6', marginLeft: 4 }}>({invite.agent_email})</span>
                )}
              </div>
              <div style={{ fontSize: 12, color: '#60a5fa', marginTop: 4 }}>
                You can control which policies they see after accepting.
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                onClick={() => handleRespond(invite.id, 'accept')}
                disabled={responding === invite.id}
                style={{
                  padding: '8px 20px',
                  backgroundColor: '#2563eb',
                  color: '#fff',
                  border: 'none',
                  borderRadius: 6,
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: responding === invite.id ? 'wait' : 'pointer',
                  opacity: responding === invite.id ? 0.6 : 1,
                }}
              >
                Accept
              </button>
              <button
                onClick={() => handleRespond(invite.id, 'decline')}
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
        </div>
      ))}
    </div>
  );
}
