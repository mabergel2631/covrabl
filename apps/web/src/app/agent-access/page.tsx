'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '../../../lib/auth';
import { agentApi } from '../../../lib/api';
import { trackClick, trackFeatureUse } from '../../../lib/track';
import BackButton from '../components/BackButton';

type Agent = {
  id: number;
  agent_id: number;
  agent_email: string;
  agent_name: string | null;
  created_at: string | null;
};

type PolicyVisibility = {
  policy_id: number;
  carrier: string;
  policy_type: string;
  policy_number: string;
  status: string;
  visible: boolean;
};

export default function AgentAccessPage() {
  const { token } = useAuth();
  const router = useRouter();
  const [agents, setAgents] = useState<Agent[]>([]);
  const [selectedAgent, setSelectedAgent] = useState<Agent | null>(null);
  const [policies, setPolicies] = useState<PolicyVisibility[]>([]);
  const [loading, setLoading] = useState(true);
  const [toggling, setToggling] = useState<number | null>(null);

  useEffect(() => {
    if (!token) { router.replace('/login'); return; }
    agentApi.myAgents().then(a => {
      setAgents(a);
      if (a.length > 0) {
        setSelectedAgent(a[0]);
        loadVisibility(a[0].agent_id);
      }
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [token]);

  const loadVisibility = async (agentId: number) => {
    trackClick('agent_access_load_visibility', { agent_id: agentId });
    try {
      const vis = await agentApi.myPolicyVisibility(agentId);
      setPolicies(vis);
    } catch { /* ignore */ }
  };

  const handleToggle = async (policyId: number, visible: boolean) => {
    if (!selectedAgent) return;
    setToggling(policyId);
    trackClick('agent_access_toggle_policy', { agent_id: selectedAgent.agent_id, policy_id: policyId, visible });
    try {
      await agentApi.togglePolicyVisibility(selectedAgent.agent_id, policyId, visible);
      trackFeatureUse('agent_policy_visibility_toggled', { policy_id: policyId, visible });
      setPolicies(prev => prev.map(p => p.policy_id === policyId ? { ...p, visible } : p));
    } catch (err: any) {
      alert(err.message || 'Failed to update');
    } finally {
      setToggling(null);
    }
  };

  if (!token || loading) {
    return <div style={{ padding: 40, textAlign: 'center', color: 'var(--color-text-muted)' }}>Loading...</div>;
  }

  return (
    <div style={{ padding: '32px 24px', maxWidth: 800, margin: '0 auto' }}>
      <BackButton href="/policies" label="Agent Access" parentLabel="Coverage Overview" />

      <h1 style={{ fontSize: 22, fontWeight: 700, margin: '0 0 8px', color: 'var(--color-text)' }}>
        Agent Access
      </h1>
      <p style={{ fontSize: 14, color: 'var(--color-text-secondary)', margin: '0 0 24px' }}>
        Control which policies your insurance agents can see.
      </p>

      {agents.length === 0 ? (
        <div className="card" style={{ padding: 40, textAlign: 'center', color: 'var(--color-text-muted)' }}>
          No agents linked to your account. When an agent sends you an invite, it will appear on your dashboard.
        </div>
      ) : (
        <>
          {/* Agent selector (if multiple) */}
          {agents.length > 1 && (
            <div style={{ marginBottom: 16 }}>
              <label style={{ fontSize: 12, color: 'var(--color-text-muted)', display: 'block', marginBottom: 4 }}>Select Agent</label>
              <select
                value={selectedAgent?.agent_id || ''}
                onChange={e => {
                  const a = agents.find(ag => ag.agent_id === Number(e.target.value));
                  if (a) { setSelectedAgent(a); loadVisibility(a.agent_id); }
                  trackClick('agent_access_switch_agent', { agent_id: e.target.value });
                }}
                style={{
                  padding: '8px 12px',
                  border: '1px solid var(--color-border)',
                  borderRadius: 'var(--radius-md)',
                  fontSize: 14,
                  backgroundColor: 'var(--color-surface)',
                  color: 'var(--color-text)',
                }}
              >
                {agents.map(a => (
                  <option key={a.agent_id} value={a.agent_id}>
                    {a.agent_name || a.agent_email}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Current agent info */}
          {selectedAgent && (
            <div className="card" style={{ padding: '16px 20px', marginBottom: 24, backgroundColor: '#f0fdf4', border: '1px solid #bbf7d0' }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-text)' }}>
                {selectedAgent.agent_name || selectedAgent.agent_email}
              </div>
              {selectedAgent.agent_name && (
                <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>{selectedAgent.agent_email}</div>
              )}
              <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 4 }}>
                Connected since {selectedAgent.created_at ? new Date(selectedAgent.created_at).toLocaleDateString() : 'unknown'}
              </div>
            </div>
          )}

          {/* Policy visibility toggles */}
          <h2 style={{ fontSize: 16, fontWeight: 600, margin: '0 0 12px', color: 'var(--color-text)' }}>
            Policy Visibility
          </h2>
          <p style={{ fontSize: 13, color: 'var(--color-text-muted)', margin: '0 0 16px' }}>
            Toggle which policies this agent can view. Hidden policies will not appear in their dashboard.
          </p>

          {policies.length === 0 ? (
            <div className="card" style={{ padding: 24, textAlign: 'center', color: 'var(--color-text-muted)' }}>
              No policies to manage.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {policies.map(p => (
                <div
                  key={p.policy_id}
                  className="card"
                  onClick={() => trackClick('agent_access_policy_row', { policy_id: p.policy_id, visible: p.visible })}
                  style={{
                    padding: '14px 20px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    opacity: p.visible ? 1 : 0.6,
                  }}
                >
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-text)' }}>
                      {p.carrier}
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>
                      {p.policy_type} {p.policy_number && `· ${p.policy_number}`}
                    </div>
                  </div>
                  <button
                    onClick={(e) => { e.stopPropagation(); handleToggle(p.policy_id, !p.visible); }}
                    disabled={toggling === p.policy_id}
                    style={{
                      padding: '6px 16px',
                      borderRadius: 20,
                      fontSize: 12,
                      fontWeight: 600,
                      border: 'none',
                      cursor: toggling === p.policy_id ? 'wait' : 'pointer',
                      backgroundColor: p.visible ? '#dcfce7' : '#f3f4f6',
                      color: p.visible ? '#166534' : '#6b7280',
                    }}
                  >
                    {p.visible ? 'Visible' : 'Hidden'}
                  </button>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
