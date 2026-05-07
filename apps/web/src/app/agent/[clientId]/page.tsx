'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { useAuth } from '../../../../lib/auth';
import {
  agentApi, AgentClientSummary, AgentFlaggedItem, AgentNote, AgentClientDocument,
  AgentClientActivity, AgencyContext, AgencyMember, CoverageGap, API_BASE,
} from '../../../../lib/api';
import { trackClick, trackFeatureUse } from '../../../../lib/track';
import BackButton from '../../components/BackButton';

const severityColors: Record<string, { bg: string; fg: string }> = {
  high: { bg: '#fee2e2', fg: '#991b1b' },
  medium: { bg: '#fef3c7', fg: '#92400e' },
  low: { bg: '#dbeafe', fg: '#1e40af' },
  info: { bg: '#f3f4f6', fg: '#374151' },
};

function formatCurrency(cents: number | null | undefined): string {
  if (!cents) return '--';
  return `$${cents.toLocaleString()}`;
}

type Tab = 'overview' | 'documents' | 'notes';

export default function ClientDetailPage() {
  const { token, role } = useAuth();
  const router = useRouter();
  const params = useParams();
  const clientId = Number(params.clientId);

  const [data, setData] = useState<AgentClientSummary | null>(null);
  const [documents, setDocuments] = useState<AgentClientDocument[]>([]);
  const [notes, setNotes] = useState<AgentNote[]>([]);
  const [activity, setActivity] = useState<AgentClientActivity | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [activeTab, setActiveTab] = useState<Tab>('overview');

  // Notes
  const [noteText, setNoteText] = useState('');
  const [addingNote, setAddingNote] = useState(false);

  // Expanded policy
  const [expandedPolicy, setExpandedPolicy] = useState<number | null>(null);

  // Renewal linkage picker (which policy currently has the picker open)
  const [renewalPickerFor, setRenewalPickerFor] = useState<number | null>(null);
  const [renewalPickerSelection, setRenewalPickerSelection] = useState<number | null>(null);
  const [linkingRenewal, setLinkingRenewal] = useState(false);

  // Add Policy
  const [showAddPolicy, setShowAddPolicy] = useState(false);
  const [addPolicyData, setAddPolicyData] = useState({ scope: 'personal', policy_type: '', carrier: '', policy_number: '', coverage_amount: '', deductible: '', premium_amount: '', renewal_date: '', business_name: '' });
  const [addingPolicy, setAddingPolicy] = useState(false);
  const [addPolicyMsg, setAddPolicyMsg] = useState('');

  // Upload
  const [showUpload, setShowUpload] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadMsg, setUploadMsg] = useState('');
  const [uploadPolicyId, setUploadPolicyId] = useState<number | null>(null);
  const [uploadDocType, setUploadDocType] = useState('policy');
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Producer assignment
  const [agencyContext, setAgencyContext] = useState<AgencyContext | null>(null);
  const [members, setMembers] = useState<AgencyMember[]>([]);
  const [producerPickerOpen, setProducerPickerOpen] = useState(false);
  const [savingProducer, setSavingProducer] = useState(false);

  useEffect(() => {
    if (!token) { router.replace('/login'); return; }
    if (role && role !== 'agent' && role !== 'admin') { router.replace('/policies'); return; }

    const load = async () => {
      try {
        const [summary, docs, notesList, act, agencyMe, agencyMembers] = await Promise.all([
          agentApi.clientSummary(clientId),
          agentApi.clientDocuments(clientId),
          agentApi.clientNotes(clientId),
          agentApi.clientActivity(clientId).catch(() => ({ items: [], last_seen: null, total: 0 })),
          agentApi.agencyMe().catch(() => null),
          agentApi.agencyMembers().catch(() => []),
        ]);
        setData(summary);
        setDocuments(docs);
        setNotes(notesList);
        setActivity(act);
        setAgencyContext(agencyMe);
        setMembers(agencyMembers);
        if (summary.policies.length > 0 && !uploadPolicyId) {
          setUploadPolicyId(summary.policies[0].id);
        }
      } catch (err: any) {
        if (err.status === 403) { router.replace('/agent'); return; }
        setError(err.message || 'Failed to load');
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [token, role, clientId]);

  function relativeTime(iso: string | null): string {
    if (!iso) return '';
    const t = new Date(iso).getTime();
    if (Number.isNaN(t)) return '';
    const diffMs = Date.now() - t;
    const sec = Math.max(0, Math.floor(diffMs / 1000));
    if (sec < 60) return 'just now';
    const min = Math.floor(sec / 60);
    if (min < 60) return `${min}m ago`;
    const hr = Math.floor(min / 60);
    if (hr < 24) return `${hr}h ago`;
    const d = Math.floor(hr / 24);
    if (d < 30) return `${d}d ago`;
    const mo = Math.floor(d / 30);
    if (mo < 12) return `${mo}mo ago`;
    return `${Math.floor(mo / 12)}y ago`;
  }

  const handleAddNote = async () => {
    if (!noteText.trim()) return;
    setAddingNote(true);
    trackClick('agent_add_note', { client_id: clientId });
    try {
      const note = await agentApi.addNote(clientId, noteText.trim());
      setNotes([note, ...notes]);
      setNoteText('');
      trackFeatureUse('agent_note_added', { client_id: clientId });
    } catch (err: any) {
      alert(err.message || 'Failed to add note');
    } finally {
      setAddingNote(false);
    }
  };

  const handleDeleteNote = async (noteId: number) => {
    trackClick('agent_delete_note', { client_id: clientId, note_id: noteId });
    try {
      await agentApi.deleteNote(clientId, noteId);
      setNotes(notes.filter(n => n.id !== noteId));
    } catch (err: any) {
      alert(err.message || 'Failed to delete');
    }
  };

  const handleAssignProducer = async (memberId: number | null) => {
    setSavingProducer(true);
    trackClick('agent_assign_producer', { client_id: clientId, member_id: memberId });
    try {
      await agentApi.assignProducer(clientId, memberId);
      // Refetch summary to get updated producer info
      const refreshed = await agentApi.clientSummary(clientId);
      setData(refreshed);
      setProducerPickerOpen(false);
    } catch (err: any) {
      alert(err.message || 'Failed to assign producer');
    } finally {
      setSavingProducer(false);
    }
  };

  const handleAddPolicy = async () => {
    if (!addPolicyData.carrier || !addPolicyData.policy_type) return;
    setAddingPolicy(true);
    setAddPolicyMsg('');
    trackClick('agent_create_policy', { client_id: clientId, carrier: addPolicyData.carrier, policy_type: addPolicyData.policy_type });
    try {
      const wasFirstPolicy = data?.policies.length === 0;
      const result = await agentApi.createPolicyForClient(clientId, {
        scope: addPolicyData.scope,
        policy_type: addPolicyData.policy_type,
        carrier: addPolicyData.carrier,
        policy_number: addPolicyData.policy_number || undefined,
        coverage_amount: addPolicyData.coverage_amount ? parseInt(addPolicyData.coverage_amount) : undefined,
        deductible: addPolicyData.deductible ? parseInt(addPolicyData.deductible) : undefined,
        premium_amount: addPolicyData.premium_amount ? parseInt(addPolicyData.premium_amount) : undefined,
        renewal_date: addPolicyData.renewal_date || undefined,
        business_name: addPolicyData.business_name || undefined,
      });
      trackFeatureUse('agent_policy_created', { client_id: clientId, policy_id: result.policy_id });
      setAddPolicyMsg(wasFirstPolicy ? 'Policy added — upload a document next' : 'Policy added!');
      setAddPolicyData({ scope: 'personal', policy_type: '', carrier: '', policy_number: '', coverage_amount: '', deductible: '', premium_amount: '', renewal_date: '', business_name: '' });
      // Refresh data
      const summary = await agentApi.clientSummary(clientId);
      setData(summary);
      // Pre-select the just-created policy for the upload form
      setUploadPolicyId(result.policy_id);
      setTimeout(() => {
        setShowAddPolicy(false);
        setAddPolicyMsg('');
        // If this was the agent's first policy for this client, jump straight to
        // the documents tab with the upload form open — closes the loop.
        if (wasFirstPolicy) {
          setActiveTab('documents');
          setShowUpload(true);
        }
      }, 1500);
    } catch (err: any) {
      setAddPolicyMsg(err.message || 'Failed to add policy');
    } finally {
      setAddingPolicy(false);
    }
  };

  const handleLinkRenewal = async (newPolicyId: number, previousPolicyId: number) => {
    setLinkingRenewal(true);
    trackClick('agent_link_renewal_submit', { client_id: clientId, policy_id: newPolicyId, previous_policy_id: previousPolicyId });
    try {
      await agentApi.linkRenewal(clientId, newPolicyId, previousPolicyId);
      trackFeatureUse('agent_renewal_linked', { policy_id: newPolicyId, previous_policy_id: previousPolicyId });
      // Refresh client summary so the policy now shows replaces_policy_id
      const summary = await agentApi.clientSummary(clientId);
      setData(summary);
      setRenewalPickerFor(null);
      setRenewalPickerSelection(null);
      router.push(`/agent/${clientId}/policies/${newPolicyId}/renewal`);
    } catch (err: any) {
      alert(err?.message || 'Failed to link renewal');
    } finally {
      setLinkingRenewal(false);
    }
  };

  const handleUpload = async (file: File) => {
    if (!uploadPolicyId) return;
    setUploading(true);
    setUploadMsg('');
    trackClick('agent_upload_document', { client_id: clientId, policy_id: uploadPolicyId, doc_type: uploadDocType });
    try {
      const initRes = await agentApi.initClientUpload(clientId, {
        policy_id: uploadPolicyId,
        filename: file.name,
        content_type: file.type || 'application/pdf',
        doc_type: uploadDocType,
      });

      await fetch(initRes.upload_url, {
        method: 'PUT',
        headers: { 'Content-Type': file.type || 'application/pdf' },
        body: file,
      });

      await agentApi.finalizeClientUpload(clientId, {
        policy_id: uploadPolicyId,
        filename: file.name,
        content_type: file.type || 'application/pdf',
        object_key: initRes.object_key,
        doc_type: uploadDocType,
      });

      setUploadMsg('Uploaded!');
      trackFeatureUse('agent_document_uploaded', { client_id: clientId });
      const docs = await agentApi.clientDocuments(clientId);
      setDocuments(docs);
      setTimeout(() => { setShowUpload(false); setUploadMsg(''); }, 1500);
    } catch (err: any) {
      setUploadMsg(err.message || 'Upload failed');
    } finally {
      setUploading(false);
    }
  };

  if (!token || loading) {
    return <div style={{ padding: 40, textAlign: 'center', color: 'var(--color-text-muted)' }}>Loading...</div>;
  }

  if (error || !data) {
    return (
      <div style={{ padding: 40, textAlign: 'center' }}>
        <p style={{ color: 'var(--color-danger)' }}>{error || 'Not found'}</p>
        <button onClick={() => { trackClick('agent_back_to_dashboard'); router.push('/agent'); }} style={{ marginTop: 16, padding: '8px 20px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', background: 'var(--color-surface)', cursor: 'pointer', color: 'var(--color-text)' }}>
          Back to Dashboard
        </button>
      </div>
    );
  }

  const scoreColor = (data.protection_score ?? 0) >= 70 ? 'var(--color-success)' : (data.protection_score ?? 0) >= 40 ? 'var(--color-warning)' : 'var(--color-danger)';
  const coverageStatusConfig = {
    gaps: { label: 'Items to Review', color: 'var(--color-danger)', bg: '#fef2f2', border: '#fecaca' },
    review: { label: 'Review Recommended', color: '#92400e', bg: '#fef3c7', border: '#fde68a' },
    good: { label: 'On Track', color: 'var(--color-success)', bg: '#dcfce7', border: '#bbf7d0' },
  } as const;
  const csCfg = coverageStatusConfig[data.coverage_status] || coverageStatusConfig.good;

  const tabs: { key: Tab; label: string; count?: number }[] = [
    { key: 'overview', label: 'Overview' },
    { key: 'documents', label: 'Documents', count: documents.length },
    { key: 'notes', label: 'Notes', count: notes.length },
  ];

  return (
    <div style={{ padding: '32px 24px', maxWidth: 900, margin: '0 auto' }}>
      <BackButton href="/agent" label={data.client?.email || 'Client'} parentLabel="My Clients" />

      {/* Client Header */}
      <div className="mobile-col" style={{ display: 'flex', alignItems: 'center', gap: 20, marginBottom: 24 }}>
        <div style={{ flex: 1 }}>
          <h1 style={{ fontSize: 22, fontWeight: 700, margin: '0 0 4px', color: 'var(--color-text)' }}>
            {data.client.email}
          </h1>
          <p style={{ fontSize: 14, color: 'var(--color-text-secondary)', margin: 0 }}>
            {data.policies.length} {data.policies.length === 1 ? 'policy' : 'policies'}
            {activity?.last_seen && (
              <>
                <span style={{ margin: '0 8px', color: 'var(--color-border)' }}>&middot;</span>
                <span>Last activity {relativeTime(activity.last_seen)}</span>
              </>
            )}
          </p>
          {/* Producer assignment — visible if agency has >1 member or someone is assigned */}
          {(members.length > 1 || data.producer_member_id) && (
            <div style={{ marginTop: 8, position: 'relative', display: 'inline-block' }}>
              <button
                type="button"
                onClick={() => {
                  if (agencyContext?.role !== 'owner') return;
                  setProducerPickerOpen(!producerPickerOpen);
                  trackClick('agent_open_producer_picker', { client_id: clientId });
                }}
                disabled={agencyContext?.role !== 'owner'}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '4px 10px',
                  fontSize: 12,
                  fontWeight: 500,
                  color: data.producer_name ? 'var(--color-text)' : 'var(--color-text-secondary)',
                  backgroundColor: data.producer_name ? '#eff6ff' : 'transparent',
                  border: data.producer_name ? '1px solid #bfdbfe' : '1px dashed var(--color-border)',
                  borderRadius: 'var(--radius-sm)',
                  cursor: agencyContext?.role === 'owner' ? 'pointer' : 'default',
                }}
              >
                <span style={{ color: 'var(--color-text-secondary)' }}>Producer:</span>
                <span>{data.producer_name || 'Unassigned'}</span>
                {agencyContext?.role === 'owner' && <span style={{ fontSize: 10, opacity: 0.7 }}>{producerPickerOpen ? '▲' : '▼'}</span>}
              </button>
              {producerPickerOpen && agencyContext?.role === 'owner' && (
                <div
                  style={{
                    position: 'absolute',
                    top: '100%',
                    left: 0,
                    marginTop: 4,
                    minWidth: 240,
                    backgroundColor: 'var(--color-surface)',
                    border: '1px solid var(--color-border)',
                    borderRadius: 'var(--radius-md)',
                    boxShadow: '0 4px 12px rgba(0,0,0,0.08)',
                    zIndex: 10,
                    overflow: 'hidden',
                  }}
                >
                  <button
                    type="button"
                    onClick={() => handleAssignProducer(null)}
                    disabled={savingProducer || !data.producer_member_id}
                    style={{
                      width: '100%',
                      padding: '8px 12px',
                      fontSize: 13,
                      textAlign: 'left',
                      backgroundColor: 'transparent',
                      border: 'none',
                      color: 'var(--color-text-secondary)',
                      cursor: !data.producer_member_id ? 'default' : 'pointer',
                      opacity: !data.producer_member_id ? 0.5 : 1,
                    }}
                  >
                    Unassigned
                  </button>
                  {members.map(m => (
                    <button
                      key={m.member_id}
                      type="button"
                      onClick={() => handleAssignProducer(m.member_id)}
                      disabled={savingProducer || data.producer_member_id === m.member_id}
                      style={{
                        width: '100%',
                        padding: '8px 12px',
                        fontSize: 13,
                        textAlign: 'left',
                        backgroundColor: data.producer_member_id === m.member_id ? '#eff6ff' : 'transparent',
                        border: 'none',
                        borderTop: '1px solid var(--color-border)',
                        color: 'var(--color-text)',
                        cursor: data.producer_member_id === m.member_id ? 'default' : 'pointer',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                      }}
                    >
                      <span>{m.name || m.email}</span>
                      <span style={{ fontSize: 10, color: 'var(--color-text-secondary)', textTransform: 'capitalize' }}>{m.role}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
        <div className="mobile-wrap" style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <button
            onClick={() => { trackClick('agent_detail_upload', { client_id: clientId }); setActiveTab('documents'); setShowUpload(true); }}
            style={{
              padding: '8px 16px',
              backgroundColor: 'var(--color-surface)',
              color: 'var(--color-text)',
              border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius-md)',
              fontSize: 13,
              fontWeight: 600,
              cursor: 'pointer',
              whiteSpace: 'nowrap',
            }}
          >
            Upload for Client
          </button>
          <button
            onClick={() => { trackClick('agent_detail_add_policy', { client_id: clientId }); setShowAddPolicy(!showAddPolicy); }}
            style={{
              padding: '8px 16px',
              backgroundColor: 'var(--color-primary)',
              color: '#fff',
              border: 'none',
              borderRadius: 'var(--radius-md)',
              fontSize: 13,
              fontWeight: 600,
              cursor: 'pointer',
              whiteSpace: 'nowrap',
            }}
          >
            + Add Policy
          </button>
          <button
            onClick={() => { trackClick('agent_detail_add_note', { client_id: clientId }); setActiveTab('notes'); }}
            style={{
              padding: '8px 16px',
              backgroundColor: 'var(--color-surface)',
              color: 'var(--color-text)',
              border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius-md)',
              fontSize: 13,
              fontWeight: 600,
              cursor: 'pointer',
              whiteSpace: 'nowrap',
            }}
          >
            Add Note
          </button>
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--color-text-muted)', marginBottom: 16 }}>
        <span style={{ fontSize: 14 }}>&#128274;</span>
        <span>Bank-level encryption &middot; Your data is private and never sold</span>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 0, borderBottom: '1px solid var(--color-border)', marginBottom: 24 }}>
        {tabs.map(tab => (
          <button
            key={tab.key}
            onClick={() => { trackClick('agent_tab', { tab: tab.key, client_id: clientId }); setActiveTab(tab.key); }}
            style={{
              padding: '10px 20px',
              border: 'none',
              borderBottom: activeTab === tab.key ? '2px solid var(--color-primary)' : '2px solid transparent',
              background: 'none',
              color: activeTab === tab.key ? 'var(--color-primary)' : 'var(--color-text-muted)',
              fontWeight: activeTab === tab.key ? 600 : 400,
              fontSize: 14,
              cursor: 'pointer',
            }}
          >
            {tab.label}
            {tab.count !== undefined && tab.count > 0 && (
              <span style={{ marginLeft: 6, fontSize: 11, padding: '1px 6px', borderRadius: 8, backgroundColor: 'var(--color-border)', color: 'var(--color-text-muted)' }}>
                {tab.count}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Add Policy Form */}
      {showAddPolicy && (
        <div className="card" style={{ padding: 20, marginBottom: 16 }}>
          <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 12, color: 'var(--color-text)' }}>Add Policy for Client</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label style={{ fontSize: 12, color: 'var(--color-text-muted)', display: 'block', marginBottom: 4 }}>Carrier *</label>
              <input value={addPolicyData.carrier} onChange={e => setAddPolicyData(d => ({ ...d, carrier: e.target.value }))} placeholder="e.g. State Farm" style={{ width: '100%', padding: '8px 12px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', fontSize: 13, backgroundColor: 'var(--color-surface)', color: 'var(--color-text)', boxSizing: 'border-box' }} />
            </div>
            <div>
              <label style={{ fontSize: 12, color: 'var(--color-text-muted)', display: 'block', marginBottom: 4 }}>Policy Type *</label>
              <select value={addPolicyData.policy_type} onChange={e => setAddPolicyData(d => ({ ...d, policy_type: e.target.value }))} style={{ width: '100%', padding: '8px 12px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', fontSize: 13, backgroundColor: 'var(--color-surface)', color: 'var(--color-text)' }}>
                <option value="">Select type...</option>
                <option value="auto">Auto</option>
                <option value="homeowners">Homeowners</option>
                <option value="renters">Renters</option>
                <option value="umbrella">Umbrella</option>
                <option value="life">Life</option>
                <option value="health">Health</option>
                <option value="general_liability">General Liability</option>
                <option value="property">Property</option>
                <option value="professional_liability">Professional Liability</option>
                <option value="workers_comp">Workers Comp</option>
                <option value="other">Other</option>
              </select>
            </div>
            <div>
              <label style={{ fontSize: 12, color: 'var(--color-text-muted)', display: 'block', marginBottom: 4 }}>Scope</label>
              <select value={addPolicyData.scope} onChange={e => setAddPolicyData(d => ({ ...d, scope: e.target.value }))} style={{ width: '100%', padding: '8px 12px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', fontSize: 13, backgroundColor: 'var(--color-surface)', color: 'var(--color-text)' }}>
                <option value="personal">Personal</option>
                <option value="business">Business</option>
              </select>
            </div>
            <div>
              <label style={{ fontSize: 12, color: 'var(--color-text-muted)', display: 'block', marginBottom: 4 }}>Policy Number</label>
              <input value={addPolicyData.policy_number} onChange={e => setAddPolicyData(d => ({ ...d, policy_number: e.target.value }))} placeholder="Optional" style={{ width: '100%', padding: '8px 12px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', fontSize: 13, backgroundColor: 'var(--color-surface)', color: 'var(--color-text)', boxSizing: 'border-box' }} />
            </div>
            <div>
              <label style={{ fontSize: 12, color: 'var(--color-text-muted)', display: 'block', marginBottom: 4 }}>Coverage Amount</label>
              <input type="number" value={addPolicyData.coverage_amount} onChange={e => setAddPolicyData(d => ({ ...d, coverage_amount: e.target.value }))} placeholder="e.g. 500000" style={{ width: '100%', padding: '8px 12px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', fontSize: 13, backgroundColor: 'var(--color-surface)', color: 'var(--color-text)', boxSizing: 'border-box' }} />
            </div>
            <div>
              <label style={{ fontSize: 12, color: 'var(--color-text-muted)', display: 'block', marginBottom: 4 }}>Deductible</label>
              <input type="number" value={addPolicyData.deductible} onChange={e => setAddPolicyData(d => ({ ...d, deductible: e.target.value }))} placeholder="e.g. 1000" style={{ width: '100%', padding: '8px 12px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', fontSize: 13, backgroundColor: 'var(--color-surface)', color: 'var(--color-text)', boxSizing: 'border-box' }} />
            </div>
            <div>
              <label style={{ fontSize: 12, color: 'var(--color-text-muted)', display: 'block', marginBottom: 4 }}>Premium</label>
              <input type="number" value={addPolicyData.premium_amount} onChange={e => setAddPolicyData(d => ({ ...d, premium_amount: e.target.value }))} placeholder="e.g. 2400" style={{ width: '100%', padding: '8px 12px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', fontSize: 13, backgroundColor: 'var(--color-surface)', color: 'var(--color-text)', boxSizing: 'border-box' }} />
            </div>
            <div>
              <label style={{ fontSize: 12, color: 'var(--color-text-muted)', display: 'block', marginBottom: 4 }}>Renewal Date</label>
              <input type="date" value={addPolicyData.renewal_date} onChange={e => setAddPolicyData(d => ({ ...d, renewal_date: e.target.value }))} style={{ width: '100%', padding: '8px 12px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', fontSize: 13, backgroundColor: 'var(--color-surface)', color: 'var(--color-text)', boxSizing: 'border-box' }} />
            </div>
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 12 }}>
            <button onClick={() => setShowAddPolicy(false)} style={{ padding: '8px 16px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', background: 'var(--color-surface)', color: 'var(--color-text)', fontSize: 13, cursor: 'pointer' }}>Cancel</button>
            <button onClick={handleAddPolicy} disabled={addingPolicy || !addPolicyData.carrier || !addPolicyData.policy_type} style={{ padding: '8px 20px', backgroundColor: 'var(--color-primary)', color: '#fff', border: 'none', borderRadius: 'var(--radius-md)', fontSize: 13, fontWeight: 600, cursor: addingPolicy ? 'wait' : 'pointer', opacity: addingPolicy || !addPolicyData.carrier || !addPolicyData.policy_type ? 0.6 : 1 }}>
              {addingPolicy ? 'Adding...' : 'Add Policy'}
            </button>
          </div>
          {addPolicyMsg && <div style={{ marginTop: 8, fontSize: 13, color: addPolicyMsg === 'Policy added!' ? 'var(--color-success)' : 'var(--color-danger)' }}>{addPolicyMsg}</div>}
        </div>
      )}

      {/* ─── Overview Tab ─── */}
      {activeTab === 'overview' && (
        <>
          {/* 1. Coverage Status */}
          <div className="card" onClick={() => trackClick('agent_coverage_status', { status: data.coverage_status, client_id: clientId })} style={{
            padding: '20px 24px',
            marginBottom: 24,
            backgroundColor: csCfg.bg,
            border: `1px solid ${csCfg.border}`,
          }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-text-muted)', marginBottom: 6 }}>Coverage Status</div>
            <div style={{ fontSize: 20, fontWeight: 700, color: csCfg.color }}>
              {csCfg.label}
            </div>
            {data.coverage_status !== 'good' && (
              <p style={{ fontSize: 13, color: csCfg.color, margin: '6px 0 0', opacity: 0.85 }}>
                Based on the policies currently uploaded, there are items that need attention.
              </p>
            )}
          </div>

          {/* 1b. Recent client activity */}
          {activity && activity.items.length > 0 && (
            <>
              <h2 style={{ fontSize: 16, fontWeight: 600, margin: '0 0 4px', color: 'var(--color-text)' }}>Recent Client Activity</h2>
              <p style={{ fontSize: 12, color: 'var(--color-text-muted)', margin: '0 0 12px' }}>
                What this client has done lately &mdash; useful talking points for your next call.
              </p>
              <div className="card" style={{ padding: '12px 16px', marginBottom: 24 }}>
                {activity.items.map((item, i) => (
                  <div
                    key={i}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 10,
                      padding: '8px 0',
                      borderBottom: i < activity.items.length - 1 ? '1px solid var(--color-border)' : 'none',
                    }}
                  >
                    <span style={{
                      width: 8,
                      height: 8,
                      borderRadius: 4,
                      backgroundColor: item.type === 'action' ? 'var(--color-primary)' : '#94a3b8',
                      flexShrink: 0,
                    }} />
                    <span style={{ flex: 1, fontSize: 13, color: 'var(--color-text)' }}>
                      {item.label}
                    </span>
                    <span style={{ fontSize: 12, color: 'var(--color-text-muted)', flexShrink: 0 }}>
                      {relativeTime(item.timestamp)}
                    </span>
                  </div>
                ))}
              </div>
            </>
          )}

          {/* 2. Items to review */}
          {data.flagged_items.length > 0 && (
            <>
              <h2 style={{ fontSize: 16, fontWeight: 600, margin: '0 0 12px', color: 'var(--color-text)' }}>Items to Review</h2>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 24 }}>
                {data.flagged_items.map((item, i) => {
                  const colors = severityColors[item.severity] || severityColors.info;
                  return (
                    <div key={i} onClick={() => trackClick('agent_flagged_item', { category: item.category, entity_id: item.entity_id, severity: item.severity })} style={{
                      padding: '12px 16px',
                      borderRadius: 'var(--radius-md)',
                      backgroundColor: colors.bg,
                      border: `1px solid ${colors.fg}20`,
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{
                          fontSize: 10,
                          fontWeight: 700,
                          textTransform: 'uppercase' as const,
                          color: colors.fg,
                          padding: '1px 6px',
                          borderRadius: 6,
                          backgroundColor: `${colors.fg}18`,
                        }}>
                          {item.severity}
                        </span>
                        <span style={{ fontSize: 14, fontWeight: 600, color: colors.fg }}>{item.title}</span>
                      </div>
                      <p style={{ fontSize: 13, color: colors.fg, margin: '4px 0 0', opacity: 0.8 }}>{item.detail}</p>
                    </div>
                  );
                })}
              </div>
            </>
          )}

          {/* 3. Discussion topics */}
          {data.what_to_do && data.what_to_do.length > 0 && !data.what_to_do[0].startsWith('Nothing flagged') && !data.what_to_do[0].startsWith('No action needed') && !data.what_to_do[0].startsWith('On track') && (
            <>
              <h2 style={{ fontSize: 16, fontWeight: 600, margin: '0 0 4px', color: 'var(--color-text)' }}>Discussion Topics</h2>
              <p style={{ fontSize: 12, color: 'var(--color-text-muted)', margin: '0 0 12px' }}>
                Suggested talking points for your next conversation with this client &mdash; review and adjust before sharing.
              </p>
              <div className="card" style={{ padding: '16px 20px', marginBottom: 24 }}>
                {data.what_to_do.map((action, i) => (
                  <div
                    key={i}
                    onClick={() => trackClick('agent_what_to_do_item', { action, index: i, client_id: clientId })}
                    style={{
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: 10,
                      padding: '8px 0',
                      borderBottom: i < data.what_to_do.length - 1 ? '1px solid var(--color-border)' : 'none',
                    }}
                  >
                    <span style={{ fontSize: 14, color: 'var(--color-primary)', fontWeight: 700, flexShrink: 0 }}>{i + 1}.</span>
                    <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-text)' }}>{action}</span>
                  </div>
                ))}
              </div>
            </>
          )}

          {/* 4. Policies */}
          {data.policies.length === 0 ? (
            <>
              <h2 style={{ fontSize: 16, fontWeight: 600, margin: '0 0 12px', color: 'var(--color-text)' }}>Policies</h2>
              <div className="card" style={{ padding: 32, textAlign: 'center' }}>
                <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--color-text)', marginBottom: 6 }}>
                  No policies on file yet for this client
                </div>
                <p style={{ fontSize: 13, color: 'var(--color-text-muted)', margin: '0 auto 18px', maxWidth: 480 }}>
                  Add the first policy and you&rsquo;ll be prompted to upload the dec page right after.
                </p>
                <button
                  onClick={() => { trackClick('agent_empty_add_first_policy', { client_id: clientId }); setShowAddPolicy(true); }}
                  style={{
                    padding: '10px 24px',
                    backgroundColor: 'var(--color-primary)',
                    color: '#fff',
                    border: 'none',
                    borderRadius: 'var(--radius-md)',
                    fontSize: 14,
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  Add first policy
                </button>
              </div>
            </>
          ) : (() => {
            const personalPolicies = data.policies.filter(p => p.scope !== 'business');
            const businessPolicies = data.policies.filter(p => p.scope === 'business');

            // Group by exposure within each scope
            const groupByExposure = (policies: typeof data.policies) => {
              const groups: Record<string, typeof data.policies> = {};
              policies.forEach(p => {
                const key = p.exposure_id ? String(p.exposure_id) : '__none';
                if (!groups[key]) groups[key] = [];
                groups[key].push(p);
              });
              const exposureNames: Record<string, string> = {};
              Object.keys(groups).forEach(key => {
                if (key === '__none') return;
                const first = groups[key].find(pp => pp.exposure_name);
                exposureNames[key] = first?.exposure_name || `Asset #${key}`;
              });
              return { groups, exposureNames };
            };

            const hasGroups = data.policies.some(p => p.exposure_id);
            const ungrouped = data.policies.filter(p => !p.exposure_id);
            const groupKeys = [...new Set(data.policies.filter(p => p.exposure_id).map(p => String(p.exposure_id)))];
            const exposureNames: Record<string, string> = {};
            groupKeys.forEach(key => {
              const first = data.policies.find(p => String(p.exposure_id) === key && p.exposure_name);
              exposureNames[key] = first?.exposure_name || `Asset #${key}`;
            });

            const renderPolicy = (p: typeof data.policies[0]) => {
              const isExpanded = expandedPolicy === p.id;
              const policyDocs = documents.filter(d => d.policy_id === p.id);
              return (
                <div key={p.id} className="card" style={{ overflow: 'hidden' }}>
                  <div
                    className="mobile-grid-1"
                    onClick={() => { trackClick('agent_policy_expand', { policy_id: p.id, carrier: p.carrier, client_id: clientId }); setExpandedPolicy(isExpanded ? null : p.id); }}
                    style={{
                      padding: '14px 20px',
                      display: 'grid',
                      gridTemplateColumns: '1fr auto auto auto',
                      alignItems: 'center',
                      gap: '12px 20px',
                      cursor: 'pointer',
                    }}
                  >
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-text)' }}>{p.carrier}</span>
                        {p.status && p.status !== 'active' && (
                          <span style={{
                            padding: '1px 8px', borderRadius: 10, fontSize: 11, fontWeight: 600,
                            backgroundColor: p.status === 'expired' ? '#fef2f2' : '#f3f4f6',
                            color: p.status === 'expired' ? 'var(--color-danger)' : '#6b7280',
                          }}>
                            {p.status.charAt(0).toUpperCase() + p.status.slice(1)}
                          </span>
                        )}
                        {policyDocs.length > 0 && (
                          <span style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>
                            {policyDocs.length} doc{policyDocs.length !== 1 ? 's' : ''}
                          </span>
                        )}
                      </div>
                      <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>
                        {p.policy_type} &middot; {p.policy_number}
                      </div>
                    </div>
                    <div style={{ textAlign: 'center' }}>
                      <div style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>Coverage</div>
                      <div style={{ fontSize: 13, fontWeight: 600 }}>{formatCurrency(p.coverage_amount)}</div>
                    </div>
                    <div style={{ textAlign: 'center' }}>
                      <div style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>Deductible</div>
                      <div style={{ fontSize: 13 }}>{formatCurrency(p.deductible)}</div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>Renewal</div>
                      <div style={{ fontSize: 13 }}>{p.renewal_date || '--'}</div>
                    </div>
                  </div>
                  {isExpanded && (
                    <div style={{ padding: '0 20px 16px', borderTop: '1px solid var(--color-border)' }}>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, padding: '12px 0', fontSize: 13 }}>
                        <div><span style={{ color: 'var(--color-text-muted)' }}>Premium:</span> <strong>{formatCurrency(p.premium_amount)}</strong></div>
                        <div><span style={{ color: 'var(--color-text-muted)' }}>Scope:</span> <strong style={{ textTransform: 'capitalize' }}>{p.scope || '--'}</strong></div>
                        {p.nickname && <div><span style={{ color: 'var(--color-text-muted)' }}>Nickname:</span> <strong>{p.nickname}</strong></div>}
                      </div>

                      {/* Renewal review action */}
                      <div style={{ padding: '8px 0 12px', borderTop: '1px solid var(--color-border)' }}>
                        {p.replaces_policy_id ? (
                          (() => {
                            const prev = data.policies.find(pp => pp.id === p.replaces_policy_id);
                            return (
                              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                                <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>
                                  Linked as renewal of {prev ? `${prev.carrier} ${prev.policy_type}` : `policy #${p.replaces_policy_id}`}
                                </div>
                                <button
                                  onClick={(e) => { e.stopPropagation(); trackClick('agent_open_renewal_review', { policy_id: p.id, client_id: clientId }); router.push(`/agent/${clientId}/policies/${p.id}/renewal`); }}
                                  style={{
                                    padding: '6px 14px',
                                    backgroundColor: 'var(--color-primary)',
                                    color: '#fff',
                                    border: 'none',
                                    borderRadius: 'var(--radius-md)',
                                    fontSize: 12,
                                    fontWeight: 600,
                                    cursor: 'pointer',
                                  }}
                                >
                                  Open Renewal Review →
                                </button>
                              </div>
                            );
                          })()
                        ) : renewalPickerFor === p.id ? (
                          (() => {
                            const candidates = data.policies.filter(pp => pp.id !== p.id && (pp.policy_type === p.policy_type || (pp.scope === p.scope && pp.exposure_id === p.exposure_id)));
                            return (
                              <div onClick={e => e.stopPropagation()}>
                                <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginBottom: 6 }}>
                                  Which previous policy is this a renewal of?
                                </div>
                                {candidates.length === 0 ? (
                                  <div style={{ fontSize: 13, color: 'var(--color-text-muted)', fontStyle: 'italic' }}>
                                    No matching previous policy on this client.
                                  </div>
                                ) : (
                                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                                    <select
                                      value={renewalPickerSelection ?? ''}
                                      onChange={(e) => setRenewalPickerSelection(e.target.value ? Number(e.target.value) : null)}
                                      style={{ padding: '8px 12px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', fontSize: 13, backgroundColor: 'var(--color-surface)', color: 'var(--color-text)', minWidth: 240 }}
                                    >
                                      <option value="">Select previous policy...</option>
                                      {candidates.map(c => (
                                        <option key={c.id} value={c.id}>
                                          {c.carrier} {c.policy_type}{c.policy_number ? ` · ${c.policy_number}` : ''}{c.renewal_date ? ` · renewed ${c.renewal_date}` : ''}
                                        </option>
                                      ))}
                                    </select>
                                    <button
                                      onClick={() => renewalPickerSelection && handleLinkRenewal(p.id, renewalPickerSelection)}
                                      disabled={!renewalPickerSelection || linkingRenewal}
                                      style={{
                                        padding: '8px 16px',
                                        backgroundColor: 'var(--color-primary)',
                                        color: '#fff',
                                        border: 'none',
                                        borderRadius: 'var(--radius-md)',
                                        fontSize: 13,
                                        fontWeight: 600,
                                        cursor: linkingRenewal ? 'wait' : 'pointer',
                                        opacity: (!renewalPickerSelection || linkingRenewal) ? 0.6 : 1,
                                      }}
                                    >
                                      {linkingRenewal ? 'Linking...' : 'Link as renewal'}
                                    </button>
                                    <button
                                      onClick={() => { setRenewalPickerFor(null); setRenewalPickerSelection(null); }}
                                      style={{
                                        padding: '8px 12px',
                                        backgroundColor: 'transparent',
                                        color: 'var(--color-text-muted)',
                                        border: '1px solid var(--color-border)',
                                        borderRadius: 'var(--radius-md)',
                                        fontSize: 13,
                                        cursor: 'pointer',
                                      }}
                                    >
                                      Cancel
                                    </button>
                                  </div>
                                )}
                              </div>
                            );
                          })()
                        ) : (
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                            <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>
                              Renewal review &mdash; link this policy to the prior term to see year-over-year changes.
                            </div>
                            <button
                              onClick={(e) => { e.stopPropagation(); trackClick('agent_renewal_picker_open', { policy_id: p.id, client_id: clientId }); setRenewalPickerFor(p.id); setRenewalPickerSelection(null); }}
                              style={{
                                padding: '6px 14px',
                                backgroundColor: 'var(--color-surface)',
                                color: 'var(--color-text)',
                                border: '1px solid var(--color-border)',
                                borderRadius: 'var(--radius-md)',
                                fontSize: 12,
                                fontWeight: 600,
                                cursor: 'pointer',
                              }}
                            >
                              Mark as renewal of...
                            </button>
                          </div>
                        )}
                      </div>

                      {policyDocs.length > 0 ? (
                        <>
                          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-text)', marginBottom: 8 }}>Documents</div>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                            {policyDocs.map(doc => (
                              <div key={doc.id} style={{
                                padding: '8px 12px',
                                backgroundColor: 'var(--color-bg)',
                                borderRadius: 'var(--radius-sm)',
                                display: 'flex',
                                justifyContent: 'space-between',
                                alignItems: 'center',
                                gap: 8,
                                fontSize: 13,
                              }}>
                                <div style={{ flex: 1, minWidth: 0 }}>
                                  <div style={{ fontWeight: 600, color: 'var(--color-text)' }}>{doc.filename}</div>
                                  <div style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>
                                    {doc.doc_type} &middot; {doc.created_at ? new Date(doc.created_at).toLocaleDateString() : ''}
                                    {doc.uploaded_by && <span style={{ marginLeft: 6, color: '#6d28d9' }}>Uploaded by agent</span>}
                                  </div>
                                </div>
                                {doc.download_url && (
                                  <a
                                    href={doc.download_url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    onClick={(e) => { e.stopPropagation(); trackClick('agent_doc_download', { doc_id: doc.id, filename: doc.filename, client_id: clientId }); }}
                                    style={{
                                      fontSize: 12, fontWeight: 600, color: 'var(--color-primary)',
                                      textDecoration: 'none', padding: '4px 10px', borderRadius: 6,
                                      border: '1px solid var(--color-primary)', whiteSpace: 'nowrap',
                                    }}
                                  >
                                    View
                                  </a>
                                )}
                                <span style={{
                                  fontSize: 11, padding: '1px 6px', borderRadius: 6,
                                  backgroundColor: doc.extraction_status === 'done' ? '#dcfce7' : '#f3f4f6',
                                  color: doc.extraction_status === 'done' ? '#166534' : '#6b7280',
                                }}>
                                  {doc.extraction_status === 'done' ? 'Extracted' : doc.extraction_status === 'pending' ? 'Processing' : doc.extraction_status === 'failed' ? 'Failed' : 'Pending'}
                                </span>
                              </div>
                            ))}
                          </div>
                        </>
                      ) : (
                        <div style={{ fontSize: 13, color: 'var(--color-text-muted)', fontStyle: 'italic' }}>
                          No documents uploaded for this policy.
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            };

            const renderScopeSection = (label: string, policies: typeof data.policies, color: string, bgColor: string) => {
              if (policies.length === 0) return null;
              return (
                <div key={label}>
                  <div style={{ fontSize: 14, fontWeight: 600, color, marginBottom: 8, marginTop: 4, display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ padding: '2px 12px', borderRadius: 12, fontSize: 12, fontWeight: 600, backgroundColor: bgColor, color }}>
                      {label}
                    </span>
                    <span style={{ fontSize: 12, color: 'var(--color-text-muted)', fontWeight: 400 }}>{policies.length} {policies.length === 1 ? 'policy' : 'policies'}</span>
                  </div>
                  {policies.map(renderPolicy)}
                </div>
              );
            };

            return (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 32 }}>
                <h2 style={{ fontSize: 16, fontWeight: 600, margin: '0 0 4px', color: 'var(--color-text)' }}>Policies</h2>
                {renderScopeSection('Personal', personalPolicies, '#2563eb', '#dbeafe')}
                {renderScopeSection('Business', businessPolicies, '#6d28d9', '#ede9fe')}
              </div>
            );
          })()}

          {/* 5. Compliance / Coverage Gaps */}
          {data.gaps.length > 0 && (
            <>
              <h2 style={{ fontSize: 16, fontWeight: 600, margin: '0 0 12px', color: 'var(--color-text)' }}>Compliance</h2>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 32 }}>
                {data.gaps.map((gap: CoverageGap, i: number) => {
                  const colors = severityColors[gap.severity] || severityColors.info;
                  return (
                    <div key={gap.id || i} onClick={() => trackClick('agent_gap_item', { gap_id: gap.id, severity: gap.severity, name: gap.name, client_id: clientId })} style={{
                      padding: '14px 20px',
                      borderRadius: 'var(--radius-md)',
                      backgroundColor: colors.bg,
                      border: `1px solid ${colors.fg}20`,
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
                        <span style={{
                          fontSize: 11, fontWeight: 600, textTransform: 'uppercase' as const,
                          color: colors.fg, padding: '1px 8px', borderRadius: 8, backgroundColor: `${colors.fg}18`,
                        }}>
                          {gap.severity}
                        </span>
                        <span style={{ fontSize: 14, fontWeight: 600, color: colors.fg }}>{gap.name}</span>
                      </div>
                      <p style={{ fontSize: 13, color: colors.fg, margin: '4px 0 0', opacity: 0.85, lineHeight: 1.5 }}>{gap.description}</p>
                      <p style={{ fontSize: 12, color: colors.fg, margin: '6px 0 0', opacity: 0.7, lineHeight: 1.5 }}>{gap.recommendation}</p>
                    </div>
                  );
                })}
              </div>
            </>
          )}

          {/* Upcoming Renewals */}
          {data.upcoming_renewals.length > 0 && (
            <>
              <h2 style={{ fontSize: 16, fontWeight: 600, margin: '0 0 12px', color: 'var(--color-text)' }}>Upcoming Renewals</h2>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {data.upcoming_renewals.map(r => (
                  <div key={r.policy_id} className="card" onClick={() => trackClick('agent_renewal_item', { policy_id: r.policy_id, carrier: r.carrier, renewal_date: r.renewal_date, client_id: clientId })} style={{
                    padding: '12px 20px',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    cursor: 'pointer',
                  }}>
                    <div>
                      <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-text)' }}>{r.carrier}</span>
                      <span style={{ fontSize: 13, color: 'var(--color-text-muted)', marginLeft: 8 }}>{r.policy_type}</span>
                    </div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-primary)' }}>
                      {r.renewal_date}
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </>
      )}

      {/* ─── Documents Tab ─── */}
      {activeTab === 'documents' && (
        <>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
            <h2 style={{ fontSize: 16, fontWeight: 600, margin: 0, color: 'var(--color-text)' }}>Documents</h2>
            <button
              onClick={() => { trackClick('agent_upload_open', { client_id: clientId }); setShowUpload(!showUpload); }}
              style={{
                padding: '8px 16px',
                backgroundColor: 'var(--color-primary)',
                color: '#fff',
                border: 'none',
                borderRadius: 'var(--radius-md)',
                fontSize: 13,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Upload Document
            </button>
          </div>

          {/* Upload form */}
          {showUpload && data.policies.length > 0 && (
            <div className="card" style={{ padding: 20, marginBottom: 16 }}>
              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
                <div>
                  <label style={{ fontSize: 12, color: 'var(--color-text-muted)', display: 'block', marginBottom: 4 }}>Policy</label>
                  <select
                    value={uploadPolicyId || ''}
                    onChange={e => setUploadPolicyId(Number(e.target.value))}
                    style={{ padding: '8px 12px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', fontSize: 13, backgroundColor: 'var(--color-surface)', color: 'var(--color-text)' }}
                  >
                    {data.policies.map(p => (
                      <option key={p.id} value={p.id}>{p.carrier} - {p.policy_type}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label style={{ fontSize: 12, color: 'var(--color-text-muted)', display: 'block', marginBottom: 4 }}>Type</label>
                  <select
                    value={uploadDocType}
                    onChange={e => setUploadDocType(e.target.value)}
                    style={{ padding: '8px 12px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', fontSize: 13, backgroundColor: 'var(--color-surface)', color: 'var(--color-text)' }}
                  >
                    <option value="policy">Policy Document</option>
                    <option value="endorsement">Endorsement</option>
                    <option value="insurance_card">Insurance Card</option>
                    <option value="other">Other</option>
                  </select>
                </div>
                <div>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".pdf,.png,.jpg,.jpeg"
                    style={{ display: 'none' }}
                    onChange={e => {
                      const file = e.target.files?.[0];
                      if (file) handleUpload(file);
                    }}
                  />
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    disabled={uploading}
                    style={{
                      padding: '8px 20px',
                      backgroundColor: 'var(--color-primary)',
                      color: '#fff',
                      border: 'none',
                      borderRadius: 'var(--radius-md)',
                      fontSize: 13,
                      fontWeight: 600,
                      cursor: uploading ? 'wait' : 'pointer',
                      opacity: uploading ? 0.6 : 1,
                    }}
                  >
                    {uploading ? 'Uploading...' : 'Choose File'}
                  </button>
                </div>
              </div>
              {uploadMsg && (
                <div style={{ marginTop: 8, fontSize: 13, color: uploadMsg === 'Uploaded!' ? 'var(--color-success)' : 'var(--color-danger)' }}>
                  {uploadMsg}
                </div>
              )}
            </div>
          )}

          {showUpload && data.policies.length === 0 && (
            <div className="card" style={{ padding: 20, marginBottom: 16, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
              <div style={{ fontSize: 13, color: 'var(--color-text)' }}>
                Add a policy first &mdash; you&rsquo;ll be brought straight back here to upload its dec page.
              </div>
              <button
                onClick={() => { trackClick('agent_docs_empty_add_policy', { client_id: clientId }); setActiveTab('overview'); setShowAddPolicy(true); setShowUpload(false); }}
                style={{
                  padding: '8px 18px',
                  backgroundColor: 'var(--color-primary)',
                  color: '#fff',
                  border: 'none',
                  borderRadius: 'var(--radius-md)',
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                }}
              >
                Add first policy
              </button>
            </div>
          )}

          {/* Document list */}
          {documents.length === 0 ? (
            data.policies.length === 0 ? (
              <div className="card" style={{ padding: 32, textAlign: 'center' }}>
                <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--color-text)', marginBottom: 6 }}>
                  No documents yet
                </div>
                <p style={{ fontSize: 13, color: 'var(--color-text-muted)', margin: '0 auto 18px', maxWidth: 460 }}>
                  Add the first policy and you&rsquo;ll be brought back here to upload its dec page.
                </p>
                <button
                  onClick={() => { trackClick('agent_docs_empty_add_first_policy', { client_id: clientId }); setActiveTab('overview'); setShowAddPolicy(true); }}
                  style={{
                    padding: '10px 24px',
                    backgroundColor: 'var(--color-primary)',
                    color: '#fff',
                    border: 'none',
                    borderRadius: 'var(--radius-md)',
                    fontSize: 14,
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  Add first policy
                </button>
              </div>
            ) : (
              <div className="card" style={{ padding: 32, textAlign: 'center' }}>
                <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--color-text)', marginBottom: 6 }}>
                  No documents uploaded yet
                </div>
                <p style={{ fontSize: 13, color: 'var(--color-text-muted)', margin: '0 auto 18px', maxWidth: 460 }}>
                  Drop in a dec page, endorsement, or insurance card for this client.
                </p>
                <button
                  onClick={() => { trackClick('agent_docs_empty_upload', { client_id: clientId }); setShowUpload(true); }}
                  style={{
                    padding: '10px 24px',
                    backgroundColor: 'var(--color-primary)',
                    color: '#fff',
                    border: 'none',
                    borderRadius: 'var(--radius-md)',
                    fontSize: 14,
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  Upload first document
                </button>
              </div>
            )
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {documents.map(doc => (
                <div key={doc.id} className="card" onClick={() => trackClick('agent_document_item', { doc_id: doc.id, filename: doc.filename, doc_type: doc.doc_type, client_id: clientId })} style={{ padding: '14px 20px', cursor: 'pointer' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                      <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-text)' }}>{doc.filename}</div>
                      <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 2 }}>
                        {doc.carrier} &middot; {doc.doc_type}
                        {doc.uploaded_by && (
                          <span style={{ marginLeft: 8, padding: '1px 6px', borderRadius: 6, fontSize: 11, backgroundColor: '#ede9fe', color: '#6d28d9' }}>
                            Uploaded by agent
                          </span>
                        )}
                      </div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>
                        {doc.created_at ? new Date(doc.created_at).toLocaleDateString() : ''}
                      </div>
                      <div style={{
                        fontSize: 11,
                        padding: '1px 6px',
                        borderRadius: 6,
                        backgroundColor: doc.extraction_status === 'done' ? '#dcfce7' : doc.extraction_status === 'failed' ? '#fef2f2' : '#f3f4f6',
                        color: doc.extraction_status === 'done' ? '#166534' : doc.extraction_status === 'failed' ? '#991b1b' : '#6b7280',
                        display: 'inline-block',
                        marginTop: 4,
                      }}>
                        {doc.extraction_status === 'done' ? 'Extracted' : doc.extraction_status === 'pending' ? 'Processing' : doc.extraction_status === 'failed' ? 'Failed' : 'Not extracted'}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* ─── Notes Tab ─── */}
      {activeTab === 'notes' && (
        <>
          <h2 style={{ fontSize: 16, fontWeight: 600, margin: '0 0 16px', color: 'var(--color-text)' }}>Notes</h2>

          {/* Add note */}
          <div className="card" style={{ padding: 16, marginBottom: 16 }}>
            <textarea
              placeholder="Add a note about this client..."
              value={noteText}
              onChange={e => setNoteText(e.target.value)}
              style={{
                width: '100%',
                minHeight: 80,
                padding: 12,
                border: '1px solid var(--color-border)',
                borderRadius: 'var(--radius-md)',
                fontSize: 14,
                resize: 'vertical',
                fontFamily: 'inherit',
                backgroundColor: 'var(--color-surface)',
                color: 'var(--color-text)',
                boxSizing: 'border-box',
              }}
            />
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}>
              <button
                onClick={handleAddNote}
                disabled={addingNote || !noteText.trim()}
                style={{
                  padding: '8px 20px',
                  backgroundColor: 'var(--color-primary)',
                  color: '#fff',
                  border: 'none',
                  borderRadius: 'var(--radius-md)',
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: addingNote ? 'wait' : 'pointer',
                  opacity: addingNote || !noteText.trim() ? 0.6 : 1,
                }}
              >
                {addingNote ? 'Saving...' : 'Add Note'}
              </button>
            </div>
          </div>

          {/* Notes list */}
          {notes.length === 0 ? (
            <div className="card" style={{ padding: 24, textAlign: 'center', color: 'var(--color-text-muted)' }}>
              No notes yet
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {notes.map(note => (
                <div key={note.id} className="card" style={{ padding: '14px 20px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <div style={{ flex: 1 }}>
                      <p style={{ fontSize: 14, color: 'var(--color-text)', margin: 0, lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>
                        {note.content}
                      </p>
                      <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 6 }}>
                        {note.created_at ? new Date(note.created_at).toLocaleString() : ''}
                      </div>
                    </div>
                    <button
                      onClick={() => handleDeleteNote(note.id)}
                      style={{
                        background: 'none',
                        border: 'none',
                        color: 'var(--color-text-muted)',
                        cursor: 'pointer',
                        fontSize: 16,
                        padding: '4px 8px',
                        marginLeft: 12,
                      }}
                      title="Delete note"
                    >
                      &times;
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
