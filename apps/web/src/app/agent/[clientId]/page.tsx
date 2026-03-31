'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { useAuth } from '../../../../lib/auth';
import {
  agentApi, AgentClientSummary, AgentFlaggedItem, AgentNote, AgentClientDocument,
  CoverageGap, API_BASE,
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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [activeTab, setActiveTab] = useState<Tab>('overview');

  // Notes
  const [noteText, setNoteText] = useState('');
  const [addingNote, setAddingNote] = useState(false);

  // Upload
  const [showUpload, setShowUpload] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadMsg, setUploadMsg] = useState('');
  const [uploadPolicyId, setUploadPolicyId] = useState<number | null>(null);
  const [uploadDocType, setUploadDocType] = useState('policy');
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!token) { router.replace('/login'); return; }
    if (role && role !== 'agent') { router.replace('/policies'); return; }

    const load = async () => {
      try {
        const [summary, docs, notesList] = await Promise.all([
          agentApi.clientSummary(clientId),
          agentApi.clientDocuments(clientId),
          agentApi.clientNotes(clientId),
        ]);
        setData(summary);
        setDocuments(docs);
        setNotes(notesList);
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
    gaps: { label: 'Gaps Detected', color: 'var(--color-danger)', bg: '#fef2f2', border: '#fecaca' },
    review: { label: 'Review Recommended', color: '#92400e', bg: '#fef3c7', border: '#fde68a' },
    good: { label: 'Good', color: 'var(--color-success)', bg: '#dcfce7', border: '#bbf7d0' },
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
          </p>
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

          {/* 2. What Needs Attention */}
          {data.flagged_items.length > 0 && (
            <>
              <h2 style={{ fontSize: 16, fontWeight: 600, margin: '0 0 12px', color: 'var(--color-text)' }}>What Needs Attention</h2>
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

          {/* 3. What To Do */}
          {data.what_to_do && data.what_to_do.length > 0 && data.what_to_do[0] !== 'No action needed' && (
            <>
              <h2 style={{ fontSize: 16, fontWeight: 600, margin: '0 0 12px', color: 'var(--color-text)' }}>What To Do</h2>
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
          <h2 style={{ fontSize: 16, fontWeight: 600, margin: '0 0 12px', color: 'var(--color-text)' }}>Policies</h2>
          {data.policies.length === 0 ? (
            <div className="card" style={{ padding: 24, color: 'var(--color-text-muted)', textAlign: 'center' }}>No policies</div>
          ) : (() => {
            const groups: Record<string, typeof data.policies> = {};
            data.policies.forEach(p => {
              const key = p.exposure_id ? String(p.exposure_id) : '__none';
              if (!groups[key]) groups[key] = [];
              groups[key].push(p);
            });
            const exposureNames: Record<string, string> = {};
            Object.keys(groups).forEach(key => {
              if (key === '__none') return;
              const first = groups[key].find(p => p.exposure_name);
              exposureNames[key] = first?.exposure_name || `Asset #${key}`;
            });
            const groupKeys = Object.keys(groups).filter(k => k !== '__none');
            const ungrouped = groups['__none'] || [];
            const hasGroups = groupKeys.length > 0;

            const renderPolicy = (p: typeof data.policies[0]) => (
              <div key={p.id} className="card mobile-grid-1" style={{
                padding: '14px 20px',
                display: 'grid',
                gridTemplateColumns: '1fr auto auto auto',
                alignItems: 'center',
                gap: '12px 20px',
              }}>
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
            );

            return (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 32 }}>
                {hasGroups && groupKeys.map(key => (
                  <div key={key}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-primary)', marginBottom: 6, marginTop: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ padding: '2px 10px', borderRadius: 12, fontSize: 12, fontWeight: 600, backgroundColor: '#ede9fe', color: '#6d28d9' }}>
                        {exposureNames[key]}
                      </span>
                      <span style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>{groups[key].length} {groups[key].length === 1 ? 'policy' : 'policies'}</span>
                    </div>
                    {groups[key].map(renderPolicy)}
                  </div>
                ))}
                {ungrouped.length > 0 && (
                  <div>
                    {hasGroups && (
                      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-text-muted)', marginBottom: 6, marginTop: 8 }}>
                        Ungrouped
                      </div>
                    )}
                    {ungrouped.map(renderPolicy)}
                  </div>
                )}
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
            <div className="card" style={{ padding: 20, marginBottom: 16, color: 'var(--color-text-muted)', fontSize: 13 }}>
              This client has no policies yet. Add a policy first before uploading documents.
            </div>
          )}

          {/* Document list */}
          {documents.length === 0 ? (
            <div className="card" style={{ padding: 24, textAlign: 'center', color: 'var(--color-text-muted)' }}>
              No documents yet
            </div>
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
