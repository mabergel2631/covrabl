'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { useAuth } from '../../../../lib/auth';
import {
  agentApi, AgentClientSummary, AgentFlaggedItem, AgentNote, AgentClientDocument,
  AgentClientActivity, AgencyContext, AgencyMember, CoverageGap, API_BASE,
  documentsApi,
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

  // Scope filter for the policies list (Personal / Business / All)
  const [policyScopeTab, setPolicyScopeTab] = useState<'all' | 'personal' | 'business'>('all');

  // Per-policy edit + delete state
  const [editingPolicyId, setEditingPolicyId] = useState<number | null>(null);
  const [editPolicyData, setEditPolicyData] = useState<{
    scope: string;
    policy_type: string;
    carrier: string;
    policy_number: string;
    coverage_amount: string;
    deductible: string;
    premium_amount: string;
    renewal_date: string;
  }>({
    scope: 'personal', policy_type: '', carrier: '', policy_number: '',
    coverage_amount: '', deductible: '', premium_amount: '', renewal_date: '',
  });
  const [savingEdit, setSavingEdit] = useState(false);
  const [deletingPolicyId, setDeletingPolicyId] = useState<number | null>(null);

  // Add Policy wizard step (0=scope, 1=type, 2=details)
  const [addPolicyStep, setAddPolicyStep] = useState<0 | 1 | 2>(0);
  // Optional file selected in Step 3 → triggers upload + extraction after policy create
  const [wizardFile, setWizardFile] = useState<File | null>(null);
  const [wizardUploadProgress, setWizardUploadProgress] = useState<string>('');

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
    // policy_type is always required (came from Step 2). Carrier is required ONLY
    // when no file is attached — if a file is attached, the carrier comes from
    // extraction and we use "Pending extraction" as a placeholder until then.
    if (!addPolicyData.policy_type) return;
    if (!wizardFile && !addPolicyData.carrier) return;
    setAddingPolicy(true);
    setAddPolicyMsg('');
    setWizardUploadProgress('');
    trackClick('agent_create_policy', { client_id: clientId, carrier: addPolicyData.carrier, policy_type: addPolicyData.policy_type, with_file: !!wizardFile });
    try {
      const wasFirstPolicy = data?.policies.length === 0;
      const result = await agentApi.createPolicyForClient(clientId, {
        scope: addPolicyData.scope,
        policy_type: addPolicyData.policy_type,
        carrier: addPolicyData.carrier || (wizardFile ? 'Pending extraction...' : ''),
        policy_number: addPolicyData.policy_number || undefined,
        coverage_amount: addPolicyData.coverage_amount ? parseInt(addPolicyData.coverage_amount) : undefined,
        deductible: addPolicyData.deductible ? parseInt(addPolicyData.deductible) : undefined,
        premium_amount: addPolicyData.premium_amount ? parseInt(addPolicyData.premium_amount) : undefined,
        renewal_date: addPolicyData.renewal_date || undefined,
        business_name: addPolicyData.business_name || undefined,
      });
      trackFeatureUse('agent_policy_created', { client_id: clientId, policy_id: result.policy_id });

      // If a file was attached in Step 3, upload + extract so coverage / deductible
      // / premium / renewal date auto-populate from the dec page. Errors here
      // don't roll back the policy create — agent still has the policy and
      // can edit manually or retry the upload from Documents.
      if (wizardFile) {
        try {
          setWizardUploadProgress('Uploading…');
          const initRes = await agentApi.initClientUpload(clientId, {
            policy_id: result.policy_id,
            filename: wizardFile.name,
            content_type: wizardFile.type || 'application/pdf',
            doc_type: 'policy',
          });
          await fetch(initRes.upload_url, {
            method: 'PUT',
            headers: { 'Content-Type': wizardFile.type || 'application/pdf' },
            body: wizardFile,
          });
          const finalized = await agentApi.finalizeClientUpload(clientId, {
            policy_id: result.policy_id,
            filename: wizardFile.name,
            content_type: wizardFile.type || 'application/pdf',
            object_key: initRes.object_key,
            doc_type: 'policy',
          });
          setWizardUploadProgress('Extracting policy details…');
          await documentsApi.extract(finalized.document_id);
          setWizardUploadProgress('');
          setAddPolicyMsg('Policy added and details extracted from the document.');
        } catch (extractErr: any) {
          setWizardUploadProgress('');
          setAddPolicyMsg(`Policy added, but document upload/extraction failed: ${extractErr?.message || 'unknown error'}. You can retry from Documents.`);
        }
      } else {
        setAddPolicyMsg(wasFirstPolicy ? 'Policy added — upload a document next' : 'Policy added!');
      }

      setAddPolicyData({ scope: 'personal', policy_type: '', carrier: '', policy_number: '', coverage_amount: '', deductible: '', premium_amount: '', renewal_date: '', business_name: '' });
      setWizardFile(null);
      // Refresh data
      const [summary, docs] = await Promise.all([
        agentApi.clientSummary(clientId),
        agentApi.clientDocuments(clientId),
      ]);
      setData(summary);
      setDocuments(docs);
      // Pre-select the just-created policy for the upload form
      setUploadPolicyId(result.policy_id);
      setTimeout(() => {
        setShowAddPolicy(false);
        setAddPolicyMsg('');
        // If this was the agent's first policy AND no file was attached,
        // jump to documents tab with upload form open — closes the loop.
        if (wasFirstPolicy && !wizardFile) {
          setActiveTab('documents');
          setShowUpload(true);
        }
      }, 2500);
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

  const startEditPolicy = (p: { id: number; scope?: string | null; policy_type?: string | null; carrier?: string | null; policy_number?: string | null; coverage_amount?: number | null; deductible?: number | null; premium_amount?: number | null; renewal_date?: string | null }) => {
    setEditingPolicyId(p.id);
    setEditPolicyData({
      scope: p.scope || 'personal',
      policy_type: p.policy_type || '',
      carrier: p.carrier || '',
      policy_number: p.policy_number || '',
      coverage_amount: p.coverage_amount?.toString() || '',
      deductible: p.deductible?.toString() || '',
      premium_amount: p.premium_amount?.toString() || '',
      renewal_date: p.renewal_date || '',
    });
  };

  const handleSaveEdit = async (policyId: number) => {
    setSavingEdit(true);
    trackClick('agent_edit_policy_save', { policy_id: policyId, client_id: clientId });
    try {
      await agentApi.updatePolicyForClient(clientId, policyId, {
        scope: editPolicyData.scope as 'personal' | 'business',
        policy_type: editPolicyData.policy_type,
        carrier: editPolicyData.carrier,
        policy_number: editPolicyData.policy_number || '',
        coverage_amount: editPolicyData.coverage_amount ? parseInt(editPolicyData.coverage_amount) : null,
        deductible: editPolicyData.deductible ? parseInt(editPolicyData.deductible) : null,
        premium_amount: editPolicyData.premium_amount ? parseInt(editPolicyData.premium_amount) : null,
        renewal_date: editPolicyData.renewal_date || null,
      });
      const summary = await agentApi.clientSummary(clientId);
      setData(summary);
      setEditingPolicyId(null);
    } catch (err: any) {
      alert(err?.message || 'Failed to update policy');
    } finally {
      setSavingEdit(false);
    }
  };

  const handleDeletePolicy = async (policyId: number) => {
    if (!confirm('Delete this policy? Documents, deltas, contacts, and any renewal review tied to it will be removed.')) return;
    setDeletingPolicyId(policyId);
    trackClick('agent_delete_policy', { policy_id: policyId, client_id: clientId });
    try {
      await agentApi.deletePolicyForClient(clientId, policyId);
      const summary = await agentApi.clientSummary(clientId);
      setData(summary);
    } catch (err: any) {
      alert(err?.message || 'Failed to delete policy');
    } finally {
      setDeletingPolicyId(null);
    }
  };

  const [seedingPriorFor, setSeedingPriorFor] = useState<number | null>(null);
  const handleSeedPriorYear = async (policyId: number) => {
    if (!confirm('Generate a sample prior-year version of this policy? This is for testing/demo — it creates a realistic prior policy with adjusted fields and links them.')) return;
    setSeedingPriorFor(policyId);
    trackClick('agent_seed_prior_year', { policy_id: policyId, client_id: clientId });
    try {
      await agentApi.seedPriorYear(clientId, policyId);
      router.push(`/agent/${clientId}/policies/${policyId}/renewal`);
    } catch (err: any) {
      alert(err?.message || 'Failed to seed prior year');
    } finally {
      setSeedingPriorFor(null);
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

      const finalized = await agentApi.finalizeClientUpload(clientId, {
        policy_id: uploadPolicyId,
        filename: file.name,
        content_type: file.type || 'application/pdf',
        object_key: initRes.object_key,
        doc_type: uploadDocType,
      });

      setUploadMsg('Uploaded — extracting…');
      trackFeatureUse('agent_document_uploaded', { client_id: clientId });

      // Kick off extraction so policy fields auto-populate (agent can edit
      // afterward via the per-policy Edit button). Non-fatal on failure —
      // agent still sees the document attached and can run extract manually.
      try {
        await documentsApi.extract(finalized.document_id);
        setUploadMsg('Uploaded and extracted.');
      } catch (extractErr: any) {
        // Don't block the upload UX — surface the extraction status as failed
        // so the agent can retry from the document list.
        setUploadMsg(`Uploaded, but extraction did not complete: ${extractErr?.message || 'unknown error'}`);
      }

      // Refresh both documents and policy summary (extracted fields may have
      // updated coverage_amount / deductible / premium / renewal_date).
      const [docs, summary] = await Promise.all([
        agentApi.clientDocuments(clientId),
        agentApi.clientSummary(clientId),
      ]);
      setDocuments(docs);
      setData(summary);
      setTimeout(() => { setShowUpload(false); setUploadMsg(''); }, 2000);
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
          {/* Producer assignment — visible if agency has >1 active member or someone is assigned */}
          {(members.filter(m => m.status === 'active').length > 1 || data.producer_member_id) && (
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
                  {members.filter(m => m.status === 'active').map(m => (
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
            title="Attach an additional document (renewal letter, claim form, etc.) to a policy that already exists. To add a brand-new policy from a PDF, use + Add Policy instead — its last step has the dec-page upload built in."
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
            Upload to Existing Policy
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

      {/* Tabs — sticky so they stay visible while scrolling long client pages */}
      <div style={{
        display: 'flex',
        gap: 0,
        borderBottom: '1px solid var(--color-border)',
        marginBottom: 24,
        position: 'sticky',
        top: 0,
        backgroundColor: 'var(--color-bg)',
        zIndex: 5,
        paddingTop: 4,
      }}>
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

      {/* Add Policy Wizard — stepped: Scope → Type → Details */}
      {showAddPolicy && (() => {
        const personalTypes = [
          { value: 'auto', label: 'Auto' },
          { value: 'homeowners', label: 'Homeowners' },
          { value: 'renters', label: 'Renters' },
          { value: 'umbrella', label: 'Umbrella' },
          { value: 'life', label: 'Life' },
          { value: 'health', label: 'Health' },
          { value: 'disability', label: 'Disability' },
          { value: 'pet', label: 'Pet' },
          { value: 'other', label: 'Other' },
        ];
        const businessTypes = [
          { value: 'general_liability', label: 'General Liability' },
          { value: 'commercial_auto', label: 'Commercial Auto' },
          { value: 'workers_comp', label: 'Workers Comp' },
          { value: 'professional_liability', label: 'Professional Liability' },
          { value: 'property', label: 'Commercial Property' },
          { value: 'cyber', label: 'Cyber' },
          { value: 'employment_practices', label: 'Employment Practices' },
          { value: 'umbrella', label: 'Umbrella' },
          { value: 'other', label: 'Other' },
        ];
        const types = addPolicyData.scope === 'business' ? businessTypes : personalTypes;
        const closeWizard = () => { setShowAddPolicy(false); setAddPolicyStep(0); setAddPolicyMsg(''); };
        return (
          <div className="card" style={{ padding: 20, marginBottom: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--color-text)' }}>
                Add Policy for Client
                <span style={{ fontSize: 12, fontWeight: 400, color: 'var(--color-text-muted)', marginLeft: 8 }}>
                  Step {addPolicyStep + 1} of 3
                </span>
              </div>
              <button onClick={closeWizard} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 18, color: 'var(--color-text-muted)' }}>×</button>
            </div>

            {/* Step 0: Scope picker */}
            {addPolicyStep === 0 && (
              <div>
                <p style={{ fontSize: 13, color: 'var(--color-text-secondary)', margin: '0 0 16px' }}>
                  Is this a personal policy or a business policy?
                </p>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  {[
                    { value: 'personal', label: 'Personal', desc: 'Auto, home, life, umbrella, health, etc.' },
                    { value: 'business', label: 'Business', desc: 'General liability, workers comp, cyber, commercial auto, etc.' },
                  ].map(opt => (
                    <button
                      key={opt.value}
                      onClick={() => { setAddPolicyData(d => ({ ...d, scope: opt.value, policy_type: '' })); setAddPolicyStep(1); }}
                      style={{
                        padding: '20px 18px',
                        textAlign: 'left',
                        backgroundColor: addPolicyData.scope === opt.value ? '#eff6ff' : 'var(--color-surface)',
                        border: addPolicyData.scope === opt.value ? '2px solid var(--color-primary)' : '1px solid var(--color-border)',
                        borderRadius: 'var(--radius-md)',
                        cursor: 'pointer',
                      }}
                    >
                      <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--color-text)', marginBottom: 4 }}>{opt.label}</div>
                      <div style={{ fontSize: 12, color: 'var(--color-text-muted)', lineHeight: 1.4 }}>{opt.desc}</div>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Step 1: Type picker */}
            {addPolicyStep === 1 && (
              <div>
                <p style={{ fontSize: 13, color: 'var(--color-text-secondary)', margin: '0 0 16px' }}>
                  What type of {addPolicyData.scope === 'business' ? 'business' : 'personal'} policy?
                </p>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 8 }}>
                  {types.map(t => (
                    <button
                      key={t.value}
                      onClick={() => { setAddPolicyData(d => ({ ...d, policy_type: t.value })); setAddPolicyStep(2); }}
                      style={{
                        padding: '14px 12px',
                        textAlign: 'center',
                        backgroundColor: addPolicyData.policy_type === t.value ? '#eff6ff' : 'var(--color-surface)',
                        border: addPolicyData.policy_type === t.value ? '2px solid var(--color-primary)' : '1px solid var(--color-border)',
                        borderRadius: 'var(--radius-md)',
                        fontSize: 13,
                        fontWeight: 600,
                        color: 'var(--color-text)',
                        cursor: 'pointer',
                      }}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>
                <div style={{ display: 'flex', justifyContent: 'flex-start', marginTop: 16 }}>
                  <button onClick={() => setAddPolicyStep(0)} style={{ padding: '6px 14px', fontSize: 13, background: 'transparent', color: 'var(--color-text-muted)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', cursor: 'pointer' }}>← Back</button>
                </div>
              </div>
            )}

            {/* Step 2: Details */}
            {addPolicyStep === 2 && (
              <div>
                <p style={{ fontSize: 13, color: 'var(--color-text-secondary)', margin: '0 0 16px' }}>
                  {wizardFile
                    ? <>Ready to upload <strong>{wizardFile.name}</strong>. AI extraction will fill in carrier, coverage, deductible, premium, and renewal date — no manual entry needed.</>
                    : <>Attach the dec page below to auto-extract everything, or fill in the fields manually. You can always edit afterward via the policy&apos;s Edit button.</>}
                </p>

                {/* Upload-and-extract option */}
                <div style={{
                  padding: '14px 16px',
                  marginBottom: 16,
                  backgroundColor: wizardFile ? '#dcfce7' : '#fef9c3',
                  border: wizardFile ? '1px solid #16a34a' : '1px dashed #d97706',
                  borderRadius: 'var(--radius-md)',
                }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: wizardFile ? '#15803d' : '#92400e', marginBottom: 8 }}>
                    {wizardFile ? '✓ PDF ready — extraction will run automatically' : 'Attach a dec page to auto-extract everything (recommended)'}
                  </div>
                  <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
                    <input
                      type="file"
                      accept="application/pdf,image/*"
                      onChange={e => setWizardFile(e.target.files?.[0] || null)}
                      style={{ fontSize: 13 }}
                    />
                    {wizardFile && (
                      <button
                        type="button"
                        onClick={() => setWizardFile(null)}
                        style={{ padding: '4px 10px', fontSize: 12, backgroundColor: 'transparent', color: '#92400e', border: '1px solid #d97706', borderRadius: 'var(--radius-sm)', cursor: 'pointer' }}
                      >
                        Remove file
                      </button>
                    )}
                  </div>
                </div>

                {/* Manual entry — hidden when a file is attached, since extraction will populate everything */}
                {!wizardFile && (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <div>
                    <label style={{ fontSize: 12, color: 'var(--color-text-muted)', display: 'block', marginBottom: 4 }}>Carrier *</label>
                    <input value={addPolicyData.carrier} onChange={e => setAddPolicyData(d => ({ ...d, carrier: e.target.value }))} placeholder="e.g. State Farm" style={{ width: '100%', padding: '8px 12px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', fontSize: 13, backgroundColor: 'var(--color-surface)', color: 'var(--color-text)', boxSizing: 'border-box' }} />
                  </div>
                  <div>
                    <label style={{ fontSize: 12, color: 'var(--color-text-muted)', display: 'block', marginBottom: 4 }}>Policy Number</label>
                    <input value={addPolicyData.policy_number} onChange={e => setAddPolicyData(d => ({ ...d, policy_number: e.target.value }))} placeholder="Optional" style={{ width: '100%', padding: '8px 12px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', fontSize: 13, backgroundColor: 'var(--color-surface)', color: 'var(--color-text)', boxSizing: 'border-box' }} />
                  </div>
                  {addPolicyData.scope === 'business' && (
                    <div style={{ gridColumn: '1 / -1' }}>
                      <label style={{ fontSize: 12, color: 'var(--color-text-muted)', display: 'block', marginBottom: 4 }}>Business Name</label>
                      <input value={addPolicyData.business_name} onChange={e => setAddPolicyData(d => ({ ...d, business_name: e.target.value }))} placeholder="e.g. Acme Holdings LLC" style={{ width: '100%', padding: '8px 12px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', fontSize: 13, backgroundColor: 'var(--color-surface)', color: 'var(--color-text)', boxSizing: 'border-box' }} />
                    </div>
                  )}
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
                )}
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginTop: 16 }}>
                  <button onClick={() => setAddPolicyStep(1)} style={{ padding: '8px 14px', fontSize: 13, background: 'transparent', color: 'var(--color-text-muted)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', cursor: 'pointer' }}>← Back</button>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button onClick={closeWizard} style={{ padding: '8px 16px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', background: 'var(--color-surface)', color: 'var(--color-text)', fontSize: 13, cursor: 'pointer' }}>Cancel</button>
                    <button
                      onClick={async () => { await handleAddPolicy(); if (!addPolicyMsg) setAddPolicyStep(0); }}
                      disabled={addingPolicy || !addPolicyData.policy_type || (!wizardFile && !addPolicyData.carrier)}
                      style={{ padding: '8px 20px', backgroundColor: 'var(--color-primary)', color: '#fff', border: 'none', borderRadius: 'var(--radius-md)', fontSize: 13, fontWeight: 600, cursor: addingPolicy ? 'wait' : 'pointer', opacity: addingPolicy || !addPolicyData.policy_type || (!wizardFile && !addPolicyData.carrier) ? 0.6 : 1 }}
                    >
                      {addingPolicy
                        ? (wizardUploadProgress || 'Adding...')
                        : (wizardFile ? 'Upload + Extract' : 'Add Policy')}
                    </button>
                  </div>
                </div>
                {addPolicyMsg && <div style={{ marginTop: 8, fontSize: 13, color: addPolicyMsg.toLowerCase().includes('fail') || addPolicyMsg.toLowerCase().includes('error') ? 'var(--color-danger)' : 'var(--color-success)' }}>{addPolicyMsg}</div>}
              </div>
            )}
          </div>
        );
      })()}

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
                      {editingPolicyId === p.id ? (
                        <div style={{ padding: '12px 0' }}>
                          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-text)', marginBottom: 10 }}>Edit policy</div>
                          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                            <div>
                              <label style={{ fontSize: 11, color: 'var(--color-text-muted)', display: 'block', marginBottom: 3 }}>Carrier</label>
                              <input value={editPolicyData.carrier} onChange={e => setEditPolicyData(d => ({ ...d, carrier: e.target.value }))} onClick={e => e.stopPropagation()} style={{ width: '100%', padding: '6px 10px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', fontSize: 13, backgroundColor: 'var(--color-surface)', color: 'var(--color-text)', boxSizing: 'border-box' }} />
                            </div>
                            <div>
                              <label style={{ fontSize: 11, color: 'var(--color-text-muted)', display: 'block', marginBottom: 3 }}>Policy Type</label>
                              <select value={editPolicyData.policy_type} onChange={e => setEditPolicyData(d => ({ ...d, policy_type: e.target.value }))} onClick={e => e.stopPropagation()} style={{ width: '100%', padding: '6px 10px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', fontSize: 13, backgroundColor: 'var(--color-surface)', color: 'var(--color-text)' }}>
                                {(editPolicyData.scope === 'business'
                                  ? [['general_liability','General Liability'],['commercial_auto','Commercial Auto'],['workers_comp','Workers Comp'],['professional_liability','Professional Liability'],['property','Commercial Property'],['cyber','Cyber'],['employment_practices','Employment Practices'],['umbrella','Umbrella'],['other','Other']]
                                  : [['auto','Auto'],['homeowners','Homeowners'],['renters','Renters'],['umbrella','Umbrella'],['life','Life'],['health','Health'],['disability','Disability'],['pet','Pet'],['other','Other']]
                                ).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                              </select>
                            </div>
                            <div>
                              <label style={{ fontSize: 11, color: 'var(--color-text-muted)', display: 'block', marginBottom: 3 }}>Scope</label>
                              <select value={editPolicyData.scope} onChange={e => setEditPolicyData(d => ({ ...d, scope: e.target.value }))} onClick={e => e.stopPropagation()} style={{ width: '100%', padding: '6px 10px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', fontSize: 13, backgroundColor: 'var(--color-surface)', color: 'var(--color-text)' }}>
                                <option value="personal">Personal</option>
                                <option value="business">Business</option>
                              </select>
                            </div>
                            <div>
                              <label style={{ fontSize: 11, color: 'var(--color-text-muted)', display: 'block', marginBottom: 3 }}>Policy Number</label>
                              <input value={editPolicyData.policy_number} onChange={e => setEditPolicyData(d => ({ ...d, policy_number: e.target.value }))} onClick={e => e.stopPropagation()} style={{ width: '100%', padding: '6px 10px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', fontSize: 13, backgroundColor: 'var(--color-surface)', color: 'var(--color-text)', boxSizing: 'border-box' }} />
                            </div>
                            <div>
                              <label style={{ fontSize: 11, color: 'var(--color-text-muted)', display: 'block', marginBottom: 3 }}>Coverage</label>
                              <input type="number" value={editPolicyData.coverage_amount} onChange={e => setEditPolicyData(d => ({ ...d, coverage_amount: e.target.value }))} onClick={e => e.stopPropagation()} style={{ width: '100%', padding: '6px 10px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', fontSize: 13, backgroundColor: 'var(--color-surface)', color: 'var(--color-text)', boxSizing: 'border-box' }} />
                            </div>
                            <div>
                              <label style={{ fontSize: 11, color: 'var(--color-text-muted)', display: 'block', marginBottom: 3 }}>Deductible</label>
                              <input type="number" value={editPolicyData.deductible} onChange={e => setEditPolicyData(d => ({ ...d, deductible: e.target.value }))} onClick={e => e.stopPropagation()} style={{ width: '100%', padding: '6px 10px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', fontSize: 13, backgroundColor: 'var(--color-surface)', color: 'var(--color-text)', boxSizing: 'border-box' }} />
                            </div>
                            <div>
                              <label style={{ fontSize: 11, color: 'var(--color-text-muted)', display: 'block', marginBottom: 3 }}>Premium</label>
                              <input type="number" value={editPolicyData.premium_amount} onChange={e => setEditPolicyData(d => ({ ...d, premium_amount: e.target.value }))} onClick={e => e.stopPropagation()} style={{ width: '100%', padding: '6px 10px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', fontSize: 13, backgroundColor: 'var(--color-surface)', color: 'var(--color-text)', boxSizing: 'border-box' }} />
                            </div>
                            <div>
                              <label style={{ fontSize: 11, color: 'var(--color-text-muted)', display: 'block', marginBottom: 3 }}>Renewal Date</label>
                              <input type="date" value={editPolicyData.renewal_date} onChange={e => setEditPolicyData(d => ({ ...d, renewal_date: e.target.value }))} onClick={e => e.stopPropagation()} style={{ width: '100%', padding: '6px 10px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', fontSize: 13, backgroundColor: 'var(--color-surface)', color: 'var(--color-text)', boxSizing: 'border-box' }} />
                            </div>
                          </div>
                          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 12 }}>
                            <button onClick={(e) => { e.stopPropagation(); setEditingPolicyId(null); }} style={{ padding: '6px 14px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', background: 'var(--color-surface)', color: 'var(--color-text)', fontSize: 12, cursor: 'pointer' }}>Cancel</button>
                            <button onClick={(e) => { e.stopPropagation(); handleSaveEdit(p.id); }} disabled={savingEdit} style={{ padding: '6px 16px', backgroundColor: 'var(--color-primary)', color: '#fff', border: 'none', borderRadius: 'var(--radius-md)', fontSize: 12, fontWeight: 600, cursor: savingEdit ? 'wait' : 'pointer', opacity: savingEdit ? 0.6 : 1 }}>{savingEdit ? 'Saving...' : 'Save changes'}</button>
                          </div>
                        </div>
                      ) : (
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, padding: '12px 0', fontSize: 13 }}>
                          <div><span style={{ color: 'var(--color-text-muted)' }}>Premium:</span> <strong>{formatCurrency(p.premium_amount)}</strong></div>
                          <div><span style={{ color: 'var(--color-text-muted)' }}>Scope:</span> <strong style={{ textTransform: 'capitalize' }}>{p.scope || '--'}</strong></div>
                          {p.nickname && <div><span style={{ color: 'var(--color-text-muted)' }}>Nickname:</span> <strong>{p.nickname}</strong></div>}
                        </div>
                      )}

                      {/* Edit + Delete actions (admin/agent only — backend re-checks role) */}
                      {(role === 'admin' || role === 'agent') && editingPolicyId !== p.id && (
                        <div style={{ display: 'flex', gap: 8, padding: '8px 0', borderTop: '1px solid var(--color-border)', flexWrap: 'wrap' }}>
                          <button
                            onClick={(e) => { e.stopPropagation(); startEditPolicy(p); }}
                            style={{ padding: '4px 12px', fontSize: 12, backgroundColor: 'var(--color-surface)', color: 'var(--color-text)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', cursor: 'pointer' }}
                          >
                            Edit policy
                          </button>
                          <button
                            onClick={(e) => { e.stopPropagation(); handleDeletePolicy(p.id); }}
                            disabled={deletingPolicyId === p.id}
                            style={{ padding: '4px 12px', fontSize: 12, backgroundColor: 'transparent', color: 'var(--color-danger)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', cursor: deletingPolicyId === p.id ? 'wait' : 'pointer', opacity: deletingPolicyId === p.id ? 0.6 : 1 }}
                          >
                            {deletingPolicyId === p.id ? 'Deleting...' : 'Delete policy'}
                          </button>
                        </div>
                      )}

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
                            // Strict same-policy-type matching, case-insensitive — prevents Auto vs Homeowners cross-comparisons
                            const targetType = (p.policy_type || '').toLowerCase().trim();
                            const candidates = data.policies.filter(pp => pp.id !== p.id && (pp.policy_type || '').toLowerCase().trim() === targetType);
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
                            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
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
                              {(role === 'admin' || role === 'agent') && (
                                <button
                                  onClick={(e) => { e.stopPropagation(); handleSeedPriorYear(p.id); }}
                                  disabled={seedingPriorFor === p.id}
                                  title="Owner/admin only — creates a sample prior-year policy for demo/testing"
                                  style={{
                                    padding: '6px 14px',
                                    backgroundColor: '#fef3c7',
                                    color: '#92400e',
                                    border: '1px dashed #d97706',
                                    borderRadius: 'var(--radius-md)',
                                    fontSize: 12,
                                    fontWeight: 600,
                                    cursor: seedingPriorFor === p.id ? 'wait' : 'pointer',
                                    opacity: seedingPriorFor === p.id ? 0.6 : 1,
                                  }}
                                >
                                  {seedingPriorFor === p.id ? 'Seeding...' : '+ Add Prior Year (sample)'}
                                </button>
                              )}
                            </div>
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

            const showPersonal = policyScopeTab === 'all' || policyScopeTab === 'personal';
            const showBusiness = policyScopeTab === 'all' || policyScopeTab === 'business';
            return (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 32 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                  <h2 style={{ fontSize: 16, fontWeight: 600, margin: 0, color: 'var(--color-text)' }}>Policies</h2>
                  {/* Scope tabs: All / Personal / Business — visible only when both kinds exist */}
                  {personalPolicies.length > 0 && businessPolicies.length > 0 && (
                    <div style={{ display: 'flex', gap: 4, padding: 2, backgroundColor: 'var(--color-bg)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)' }}>
                      {([
                        { key: 'all', label: 'All', count: data.policies.length },
                        { key: 'personal', label: 'Personal', count: personalPolicies.length },
                        { key: 'business', label: 'Business', count: businessPolicies.length },
                      ] as const).map(t => (
                        <button
                          key={t.key}
                          onClick={() => { setPolicyScopeTab(t.key); trackClick('agent_policy_scope_tab', { tab: t.key, client_id: clientId }); }}
                          style={{
                            padding: '4px 12px',
                            fontSize: 12,
                            fontWeight: policyScopeTab === t.key ? 600 : 500,
                            backgroundColor: policyScopeTab === t.key ? 'var(--color-surface)' : 'transparent',
                            color: policyScopeTab === t.key ? 'var(--color-text)' : 'var(--color-text-muted)',
                            border: 'none',
                            borderRadius: 'var(--radius-sm)',
                            cursor: 'pointer',
                          }}
                        >
                          {t.label} <span style={{ opacity: 0.7 }}>({t.count})</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                {showPersonal && renderScopeSection('Personal', personalPolicies, '#2563eb', '#dbeafe')}
                {showBusiness && renderScopeSection('Business', businessPolicies, '#6d28d9', '#ede9fe')}
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
              <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 4, color: 'var(--color-text)' }}>
                Attach a document to an existing policy
              </div>
              <p style={{ fontSize: 12, color: 'var(--color-text-muted)', margin: '0 0 12px', lineHeight: 1.5 }}>
                Pick which policy this document belongs to. For attaching a brand-new policy, close this and click <strong>+ Add Policy</strong> at the top instead — Step 3 has a dec-page upload that auto-extracts coverage details.
              </p>
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
                <p style={{ fontSize: 13, color: 'var(--color-text-muted)', margin: '0 auto 12px', maxWidth: 480, lineHeight: 1.5 }}>
                  This tab attaches additional documents (renewal letters, endorsements, claim forms) to policies that already exist.
                </p>
                <div style={{
                  margin: '0 auto 18px',
                  maxWidth: 480,
                  padding: '10px 14px',
                  backgroundColor: '#fef9c3',
                  border: '1px solid #fde68a',
                  borderRadius: 'var(--radius-md)',
                  fontSize: 12,
                  lineHeight: 1.5,
                  color: '#854d0e',
                  textAlign: 'left',
                }}>
                  <strong>Adding a brand-new policy from a PDF?</strong> Use the <strong>+ Add Policy</strong> button at the top — its last step (Step 3) has a dec-page upload built in and will auto-extract coverage, deductible, premium, and renewal date from the document.
                </div>
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
                  Attach document to existing policy
                </button>
              </div>
            )
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {documents.map(doc => (
                <div key={doc.id} className="card" style={{ padding: '14px 20px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                    <div style={{ flex: 1, minWidth: 200 }}>
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
                  {/* Action buttons */}
                  <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
                    <button
                      onClick={async (e) => {
                        e.stopPropagation();
                        try {
                          trackClick('agent_doc_open', { doc_id: doc.id, client_id: clientId });
                          const { download_url } = await documentsApi.download(doc.id);
                          window.open(download_url, '_blank', 'noopener');
                        } catch (err: any) {
                          alert(err?.message || 'Could not open document');
                        }
                      }}
                      style={{ padding: '4px 12px', fontSize: 12, fontWeight: 600, backgroundColor: 'var(--color-primary)', color: '#fff', border: 'none', borderRadius: 'var(--radius-sm)', cursor: 'pointer' }}
                    >
                      Open
                    </button>
                    {doc.extraction_status !== 'done' && (
                      <button
                        onClick={async (e) => {
                          e.stopPropagation();
                          try {
                            trackClick('agent_doc_extract', { doc_id: doc.id, client_id: clientId });
                            await documentsApi.extract(doc.id);
                            const [docs, summary] = await Promise.all([
                              agentApi.clientDocuments(clientId),
                              agentApi.clientSummary(clientId),
                            ]);
                            setDocuments(docs);
                            setData(summary);
                          } catch (err: any) {
                            alert(err?.message || 'Extraction failed');
                          }
                        }}
                        style={{ padding: '4px 12px', fontSize: 12, fontWeight: 600, backgroundColor: 'var(--color-surface)', color: 'var(--color-text)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', cursor: 'pointer' }}
                      >
                        {doc.extraction_status === 'failed' ? 'Retry extraction' : 'Run extraction'}
                      </button>
                    )}
                    <button
                      onClick={async (e) => {
                        e.stopPropagation();
                        if (!confirm(`Delete "${doc.filename}"? The file will be removed from storage and the policy's document list.`)) return;
                        try {
                          trackClick('agent_doc_delete', { doc_id: doc.id, client_id: clientId });
                          await documentsApi.delete(doc.id);
                          const docs = await agentApi.clientDocuments(clientId);
                          setDocuments(docs);
                        } catch (err: any) {
                          alert(err?.message || 'Could not delete document');
                        }
                      }}
                      style={{ padding: '4px 12px', fontSize: 12, fontWeight: 600, backgroundColor: 'transparent', color: 'var(--color-danger)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', cursor: 'pointer' }}
                    >
                      Delete
                    </button>
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
