'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '../../../lib/auth';
import { certificatesApi, policiesApi, Certificate, CertificateCreate, Policy, checkFeatureAccess } from '../../../lib/api';
import { useToast } from '../components/Toast';
import ConfirmDialog from '../components/ConfirmDialog';
import TabNav from '../components/TabNav';
import UpgradePrompt from '../components/UpgradePrompt';
import BackButton from '../components/BackButton';
import { CERT_STATUS_COLORS } from '../constants';

const COUNTERPARTY_TYPES = [
  { value: 'landlord', label: 'Landlord' },
  { value: 'lender', label: 'Lender' },
  { value: 'client', label: 'Client' },
  { value: 'vendor', label: 'Vendor' },
  { value: 'contractor', label: 'Contractor' },
  { value: 'tenant', label: 'Tenant' },
  { value: 'property_manager', label: 'Property Manager' },
  { value: 'other', label: 'Other' },
];

// Use CERT_STATUS_COLORS from constants

const COVERAGE_TYPE_OPTIONS = ['General Liability', 'Auto', 'Workers Comp', 'Umbrella', 'Professional Liability', 'Property'];

export default function CertificatesPage() {
  const { token, plan, logout } = useAuth();
  const router = useRouter();
  const { toast } = useToast();

  const [certificates, setCertificates] = useState<Certificate[]>([]);
  const [policies, setPolicies] = useState<Policy[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<'all' | 'issued' | 'received'>('all');
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<number | null>(null);
  const [form, setForm] = useState<CertificateCreate>({
    direction: 'issued',
    counterparty_name: '',
    counterparty_type: 'client',
  });
  const [extracting, setExtracting] = useState(false);
  const coiFileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!token) { router.replace('/login'); return; }
    load();
  }, [token]);

  async function load() {
    try {
      const [certs, pols] = await Promise.all([
        certificatesApi.list(),
        policiesApi.list(),
      ]);
      setCertificates(certs);
      setPolicies(pols);
    } catch {
      toast('Failed to load certificates', 'error');
    } finally {
      setLoading(false);
    }
  }

  const filtered = tab === 'all' ? certificates : certificates.filter(c => c.direction === tab);

  // Build a lookup from policy_id → policy for entity grouping
  const policyMap = new Map(policies.map(p => [p.id, p]));

  // Group filtered certificates by entity
  const entityGroups: { key: string; label: string; icon: string; certs: Certificate[] }[] = (() => {
    const groups: Record<string, Certificate[]> = {};
    for (const cert of filtered) {
      const policy = cert.policy_id ? policyMap.get(cert.policy_id) : null;
      let groupKey: string;
      if (!policy) {
        groupKey = '__unlinked__';
      } else if (policy.scope === 'business' && policy.business_name) {
        groupKey = `biz:${policy.business_name}`;
      } else {
        groupKey = '__personal__';
      }
      if (!groups[groupKey]) groups[groupKey] = [];
      groups[groupKey].push(cert);
    }

    const result: { key: string; label: string; icon: string; certs: Certificate[] }[] = [];
    // Personal first
    if (groups['__personal__']) {
      result.push({ key: '__personal__', label: 'Personal', icon: '👤', certs: groups['__personal__'] });
    }
    // Business entities sorted by name
    const bizKeys = Object.keys(groups).filter(k => k.startsWith('biz:')).sort();
    for (const k of bizKeys) {
      result.push({ key: k, label: k.replace('biz:', ''), icon: '🏢', certs: groups[k] });
    }
    // Unlinked last
    if (groups['__unlinked__']) {
      result.push({ key: '__unlinked__', label: 'Unlinked', icon: '📎', certs: groups['__unlinked__'] });
    }
    return result;
  })();

  const hasMultipleGroups = entityGroups.length > 1;

  function resetForm() {
    setForm({ direction: 'issued', counterparty_name: '', counterparty_type: 'client' });
    setEditingId(null);
    setShowForm(false);
  }

  function startEdit(cert: Certificate) {
    setForm({
      direction: cert.direction,
      policy_id: cert.policy_id,
      counterparty_name: cert.counterparty_name,
      counterparty_type: cert.counterparty_type,
      counterparty_email: cert.counterparty_email,
      carrier: cert.carrier,
      policy_number: cert.policy_number,
      coverage_types: cert.coverage_types,
      coverage_amount: cert.coverage_amount,
      additional_insured: cert.additional_insured,
      waiver_of_subrogation: cert.waiver_of_subrogation,
      minimum_coverage: cert.minimum_coverage,
      effective_date: cert.effective_date,
      expiration_date: cert.expiration_date,
      notes: cert.notes,
    });
    setEditingId(cert.id);
    setShowForm(true);
  }

  async function handleSave() {
    if (!form.counterparty_name.trim()) { toast('Counterparty name is required', 'error'); return; }
    try {
      if (editingId) {
        await certificatesApi.update(editingId, form);
        toast('Certificate updated');
      } else {
        await certificatesApi.create(form);
        toast('Certificate added');
      }
      resetForm();
      load();
    } catch {
      toast('Failed to save certificate', 'error');
    }
  }

  async function handleDelete(id: number) {
    try {
      await certificatesApi.remove(id);
      toast('Certificate deleted');
      setDeleteConfirm(null);
      load();
    } catch {
      toast('Failed to delete', 'error');
    }
  }

  async function handleExtractCOI() {
    const file = coiFileRef.current?.files?.[0];
    if (!file) { toast('Please select a PDF file', 'error'); return; }
    if (!file.name.toLowerCase().endsWith('.pdf')) { toast('Only PDF files are supported', 'error'); return; }
    setExtracting(true);
    try {
      const { extraction } = await certificatesApi.extractFromPdf(file);
      // Auto-match to an existing policy by carrier or policy number
      let matchedPolicyId: number | null = null;
      if (extraction.policy_number || extraction.carrier) {
        const match = policies.find(p =>
          (extraction.policy_number && p.policy_number && p.policy_number.toLowerCase() === extraction.policy_number!.toLowerCase()) ||
          (extraction.carrier && p.carrier && p.carrier.toLowerCase() === extraction.carrier!.toLowerCase())
        );
        if (match) matchedPolicyId = match.id;
      }
      setForm(f => ({
        ...f,
        counterparty_name: extraction.counterparty_name || f.counterparty_name,
        counterparty_type: extraction.counterparty_type || f.counterparty_type,
        counterparty_email: extraction.counterparty_email || f.counterparty_email,
        carrier: extraction.carrier || f.carrier,
        policy_number: extraction.policy_number || f.policy_number,
        coverage_types: extraction.coverage_types || f.coverage_types,
        coverage_amount: extraction.coverage_amount ?? f.coverage_amount,
        additional_insured: extraction.additional_insured,
        waiver_of_subrogation: extraction.waiver_of_subrogation,
        effective_date: extraction.effective_date || f.effective_date,
        expiration_date: extraction.expiration_date || f.expiration_date,
        notes: extraction.notes || f.notes,
        policy_id: matchedPolicyId ?? f.policy_id,
      }));
      toast(matchedPolicyId ? 'COI extracted and linked to matching policy' : 'COI data extracted successfully');
      if (coiFileRef.current) coiFileRef.current.value = '';
    } catch (err: any) {
      toast(err.message || 'Extraction failed', 'error');
    } finally {
      setExtracting(false);
    }
  }

  const labelStyle: React.CSSProperties = { display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--color-text-secondary)', marginBottom: 4 };
  const inputStyle: React.CSSProperties = { width: '100%', padding: '8px 10px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', fontSize: 14 };

  if (loading) {
    return (
      <div style={{ padding: 32, maxWidth: 960, margin: '0 auto' }}>
        <div style={{ height: 32, width: 200, backgroundColor: '#f3f4f6', borderRadius: 8, marginBottom: 24 }} />
        {[1, 2, 3].map(i => (
          <div key={i} style={{ height: 100, backgroundColor: '#f3f4f6', borderRadius: 12, marginBottom: 12 }} />
        ))}
      </div>
    );
  }

  const featureGate = checkFeatureAccess(plan || 'free', 'certificates');
  if (!featureGate.allowed) {
    return <UpgradePrompt feature="certificates" requiredPlan={featureGate.requiredPlan} />;
  }

  return (
    <div style={{ padding: 32, maxWidth: 960, margin: '0 auto' }}>
      <BackButton href="/" label="Certificates" parentLabel="Home" />
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24, flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700 }}>Certificates of Insurance</h1>
          <p style={{ fontSize: 13, color: 'var(--color-text-secondary)', marginTop: 4 }}>Track COIs you share and receive</p>
        </div>
        <button
          onClick={() => { resetForm(); setShowForm(true); }}
          style={{
            padding: '10px 20px', backgroundColor: 'var(--color-primary)', color: '#fff',
            border: 'none', borderRadius: 'var(--radius-md)', fontWeight: 600, fontSize: 14, cursor: 'pointer',
          }}
        >
          + Add Certificate
        </button>
      </div>

      {/* Tabs */}
      <div style={{ marginBottom: 24 }}>
        <TabNav
          variant="underline"
          activeKey={tab}
          onSelect={(key) => setTab(key as 'all' | 'issued' | 'received')}
          tabs={[
            { key: 'all', label: `All (${certificates.length})` },
            { key: 'issued', label: `Shared (${certificates.filter(c => c.direction === 'issued').length})` },
            { key: 'received', label: `Received (${certificates.filter(c => c.direction === 'received').length})` },
          ]}
        />
      </div>

      {/* Empty state */}
      {filtered.length === 0 && !showForm && (
        <div style={{ textAlign: 'center', padding: '60px 20px', color: 'var(--color-text-secondary)' }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>📜</div>
          <p style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>No certificates yet</p>
          <p style={{ fontSize: 13 }}>
            {tab === 'issued' ? 'Track COIs you share with landlords, lenders, or clients.' :
             tab === 'received' ? 'Track COIs you receive from vendors, contractors, or tenants.' :
             'Add certificates to track proof of insurance you share or receive.'}
          </p>
        </div>
      )}

      {/* Certificate cards grouped by entity */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 32 }}>
        {entityGroups.map(group => (
          <div key={group.key}>
            {/* Entity header — only show if multiple groups exist */}
            {hasMultipleGroups && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
                <span style={{ fontSize: 16 }}>{group.icon}</span>
                <h3 style={{ fontSize: 14, fontWeight: 700, color: 'var(--color-text)', margin: 0 }}>
                  {group.label}
                </h3>
                <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>
                  {group.certs.length} certificate{group.certs.length !== 1 ? 's' : ''}
                </span>
                {group.key !== '__unlinked__' && group.key !== '__personal__' && (
                  <span
                    onClick={() => router.push(`/policies/business/${encodeURIComponent(group.label)}`)}
                    style={{ fontSize: 12, color: 'var(--color-primary)', cursor: 'pointer', marginLeft: 4 }}
                  >
                    View entity &rarr;
                  </span>
                )}
              </div>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {group.certs.map(cert => {
                const sc = CERT_STATUS_COLORS[cert.status] || CERT_STATUS_COLORS.pending;
                const ctLabel = COUNTERPARTY_TYPES.find(ct => ct.value === cert.counterparty_type)?.label || cert.counterparty_type;
                const linkedPolicy = cert.policy_id ? policyMap.get(cert.policy_id) : null;
                return (
                  <div
                    key={cert.id}
                    style={{
                      border: '1px solid var(--color-border)', borderRadius: 'var(--radius-lg)',
                      padding: 20, backgroundColor: '#fff',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
                      <div style={{ flex: 1 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4, flexWrap: 'wrap' }}>
                          <span style={{ fontSize: 16, fontWeight: 700 }}>{cert.counterparty_name}</span>
                          <span style={{
                            display: 'inline-block', padding: '2px 8px', borderRadius: 12, fontSize: 11, fontWeight: 600,
                            backgroundColor: cert.direction === 'issued' ? '#dbeafe' : '#fce7f3',
                            color: cert.direction === 'issued' ? '#1e40af' : '#9d174d',
                          }}>
                            {cert.direction === 'issued' ? 'Shared' : 'Received'}
                          </span>
                          <span style={{
                            display: 'inline-block', padding: '2px 8px', borderRadius: 12, fontSize: 11, fontWeight: 600,
                            backgroundColor: sc.bg, color: sc.fg,
                          }}>
                            {cert.status}
                          </span>
                        </div>
                        <div style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>{ctLabel}</div>
                      </div>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button onClick={() => startEdit(cert)} style={{ padding: '4px 10px', fontSize: 12, border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', backgroundColor: '#fff', cursor: 'pointer' }}>Edit</button>
                        <button onClick={() => setDeleteConfirm(cert.id)} style={{ padding: '4px 10px', fontSize: 12, border: '1px solid var(--color-danger-border)', borderRadius: 'var(--radius-sm)', backgroundColor: '#fff', color: 'var(--color-danger)', cursor: 'pointer' }}>Delete</button>
                      </div>
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 8, fontSize: 13 }}>
                      {cert.coverage_types && (
                        <div><span style={{ color: 'var(--color-text-secondary)' }}>Coverage: </span>{cert.coverage_types}</div>
                      )}
                      {cert.coverage_amount != null && (
                        <div><span style={{ color: 'var(--color-text-secondary)' }}>Amount: </span>${(cert.coverage_amount / 100).toLocaleString()}</div>
                      )}
                      {cert.expiration_date && (
                        <div><span style={{ color: 'var(--color-text-secondary)' }}>Expires: </span>{cert.expiration_date}</div>
                      )}
                      {cert.direction === 'received' && cert.carrier && (
                        <div><span style={{ color: 'var(--color-text-secondary)' }}>Carrier: </span>{cert.carrier}</div>
                      )}
                      {cert.additional_insured && (
                        <div style={{ color: '#166534', fontWeight: 600 }}>Additional Insured</div>
                      )}
                      {cert.waiver_of_subrogation && (
                        <div style={{ color: '#166534', fontWeight: 600 }}>Waiver of Subrogation</div>
                      )}
                    </div>

                    {/* Linked policy + View Policy button */}
                    {linkedPolicy ? (
                      <div style={{ marginTop: 12 }}>
                        <div style={{
                          padding: '8px 12px', borderRadius: 'var(--radius-sm) var(--radius-sm) 0 0',
                          backgroundColor: '#f9fafb', border: '1px solid #e5e7eb', borderBottom: 'none',
                          display: 'flex', alignItems: 'center', gap: 8, fontSize: 13,
                        }}>
                          <span style={{ color: 'var(--color-text-secondary)' }}>Linked policy:</span>
                          <span style={{ fontWeight: 600, color: 'var(--color-text)' }}>
                            {linkedPolicy.nickname || linkedPolicy.carrier}
                          </span>
                          <span style={{ color: 'var(--color-text-muted)' }}>
                            {linkedPolicy.policy_type}
                          </span>
                        </div>
                        <button
                          onClick={(e) => { e.stopPropagation(); router.push(`/policies/${linkedPolicy.id}`); }}
                          style={{
                            width: '100%', padding: '10px 16px',
                            backgroundColor: 'var(--color-primary)', color: '#fff',
                            border: 'none', borderRadius: '0 0 var(--radius-sm) var(--radius-sm)',
                            fontSize: 14, fontWeight: 600, cursor: 'pointer',
                            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                          }}
                        >
                          View Policy &rarr;
                        </button>
                      </div>
                    ) : (
                      <div style={{
                        marginTop: 12, padding: 12, borderRadius: 'var(--radius-sm)',
                        backgroundColor: '#fef3c7', border: '1px solid #fcd34d',
                      }}>
                        <div style={{ fontSize: 13, fontWeight: 600, color: '#92400e', marginBottom: 8 }}>
                          Not linked to a policy
                        </div>
                        <select
                          onClick={(e) => e.stopPropagation()}
                          onChange={async (e) => {
                            const policyId = Number(e.target.value);
                            if (!policyId) return;
                            try {
                              await certificatesApi.update(cert.id, { policy_id: policyId });
                              toast('Certificate linked to policy');
                              load();
                            } catch { toast('Failed to link', 'error'); }
                          }}
                          value=""
                          style={{
                            width: '100%', padding: '8px 12px', fontSize: 13,
                            border: '1px solid #d97706', borderRadius: 'var(--radius-sm)',
                            backgroundColor: '#fff', cursor: 'pointer',
                          }}
                        >
                          <option value="">Select a policy to link...</option>
                          {policies.map(p => <option key={p.id} value={p.id}>{p.nickname || p.carrier} - {p.policy_type}</option>)}
                        </select>
                      </div>
                    )}

                    {/* Compliance check for received certificates */}
                    {cert.direction === 'received' && cert.minimum_coverage != null && cert.coverage_amount != null && (
                      <div style={{
                        marginTop: 10, padding: '6px 10px', borderRadius: 'var(--radius-sm)', fontSize: 12, fontWeight: 600,
                        backgroundColor: cert.coverage_amount >= cert.minimum_coverage ? '#dcfce7' : '#fee2e2',
                        color: cert.coverage_amount >= cert.minimum_coverage ? '#166534' : '#991b1b',
                      }}>
                        {cert.coverage_amount >= cert.minimum_coverage
                          ? `Meets requirement ($${(cert.minimum_coverage / 100).toLocaleString()} minimum)`
                          : `Below requirement: $${(cert.coverage_amount / 100).toLocaleString()} / $${(cert.minimum_coverage / 100).toLocaleString()} required`
                        }
                      </div>
                    )}

                    {cert.notes && (
                      <div style={{ marginTop: 8, fontSize: 12, color: 'var(--color-text-secondary)', fontStyle: 'italic' }}>{cert.notes}</div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {/* Add/Edit Form Modal */}
      {showForm && (
        <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.5)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
          <div style={{ backgroundColor: '#fff', borderRadius: 'var(--radius-lg)', padding: 28, maxWidth: 560, width: '100%', maxHeight: '90vh', overflowY: 'auto' }}>
            <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 20 }}>
              {editingId ? 'Edit Certificate' : 'Add Certificate'}
            </h2>

            {/* Upload & Extract COI */}
            {!editingId && (
              <div style={{
                marginBottom: 20, padding: 16, backgroundColor: '#f0f9ff',
                border: '1px dashed #93c5fd', borderRadius: 'var(--radius-md)',
              }}>
                <label style={{ ...labelStyle, marginBottom: 8 }}>Upload COI PDF to auto-fill fields</label>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  <input ref={coiFileRef} type="file" accept=".pdf" style={{ fontSize: 13, flex: 1, minWidth: 0 }} />
                  <button
                    type="button"
                    onClick={handleExtractCOI}
                    disabled={extracting}
                    style={{
                      padding: '8px 16px', backgroundColor: '#2563eb', color: '#fff',
                      border: 'none', borderRadius: 'var(--radius-sm)',
                      fontWeight: 600, fontSize: 13, cursor: extracting ? 'wait' : 'pointer',
                      opacity: extracting ? 0.7 : 1, whiteSpace: 'nowrap',
                    }}
                  >
                    {extracting ? 'Extracting...' : 'Upload & Extract'}
                  </button>
                </div>
                {extracting && (
                  <p style={{ fontSize: 12, color: '#2563eb', marginTop: 8, fontStyle: 'italic', margin: '8px 0 0' }}>
                    Reading PDF and extracting certificate data... This may take a few seconds.
                  </p>
                )}
              </div>
            )}

            {/* Direction toggle */}
            <div style={{ marginBottom: 16 }}>
              <label style={labelStyle}>Direction</label>
              <div style={{ display: 'flex', gap: 0, borderRadius: 'var(--radius-sm)', overflow: 'hidden', border: '1px solid var(--color-border)' }}>
                {(['issued', 'received'] as const).map(d => (
                  <button
                    key={d}
                    onClick={() => setForm(f => ({ ...f, direction: d }))}
                    style={{
                      flex: 1, padding: '8px 16px', border: 'none', fontSize: 13, fontWeight: 600, cursor: 'pointer',
                      backgroundColor: form.direction === d ? 'var(--color-primary)' : '#fff',
                      color: form.direction === d ? '#fff' : 'var(--color-text)',
                    }}
                  >
                    {d === 'issued' ? 'Shared (outgoing)' : 'Received (incoming)'}
                  </button>
                ))}
              </div>
            </div>

            {/* Counterparty */}
            <div className="form-grid-2" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
              <div>
                <label style={labelStyle}>Counterparty Name *</label>
                <input style={inputStyle} value={form.counterparty_name} onChange={e => setForm(f => ({ ...f, counterparty_name: e.target.value }))} placeholder="e.g. ABC Property Management" />
              </div>
              <div>
                <label style={labelStyle}>Counterparty Type</label>
                <select style={inputStyle} value={form.counterparty_type} onChange={e => setForm(f => ({ ...f, counterparty_type: e.target.value }))}>
                  {COUNTERPARTY_TYPES.map(ct => <option key={ct.value} value={ct.value}>{ct.label}</option>)}
                </select>
              </div>
            </div>

            <div style={{ marginBottom: 12 }}>
              <label style={labelStyle}>Counterparty Email</label>
              <input style={inputStyle} type="email" value={form.counterparty_email || ''} onChange={e => setForm(f => ({ ...f, counterparty_email: e.target.value || null }))} placeholder="Optional - for reminders" />
            </div>

            {/* Linked policy — prominent with warning when unlinked */}
            <div style={{
              marginBottom: 12, padding: 12, borderRadius: 'var(--radius-sm)',
              backgroundColor: form.policy_id ? '#f0fdf4' : '#fef3c7',
              border: `1px solid ${form.policy_id ? '#bbf7d0' : '#fcd34d'}`,
            }}>
              <label style={{ ...labelStyle, color: form.policy_id ? '#166534' : '#92400e' }}>
                {form.policy_id ? 'Linked to Policy' : 'Link to a Policy (recommended)'}
              </label>
              <select
                style={{ ...inputStyle, borderColor: form.policy_id ? '#86efac' : '#d97706' }}
                value={form.policy_id ?? ''}
                onChange={e => setForm(f => ({ ...f, policy_id: e.target.value ? Number(e.target.value) : null }))}
              >
                <option value="">Select a policy...</option>
                {policies.map(p => <option key={p.id} value={p.id}>{p.nickname || p.carrier} - {p.policy_type}</option>)}
              </select>
              {!form.policy_id && (
                <div style={{ fontSize: 11, color: '#92400e', marginTop: 4 }}>
                  Linking ensures the COI badge appears on the policy and certificate shows in policy details.
                </div>
              )}
            </div>

            {/* Carrier + policy number (for received) */}
            {form.direction === 'received' && (
              <div className="form-grid-2" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
                <div>
                  <label style={labelStyle}>Their Carrier</label>
                  <input style={inputStyle} value={form.carrier || ''} onChange={e => setForm(f => ({ ...f, carrier: e.target.value || null }))} placeholder="e.g. State Farm" />
                </div>
                <div>
                  <label style={labelStyle}>Their Policy #</label>
                  <input style={inputStyle} value={form.policy_number || ''} onChange={e => setForm(f => ({ ...f, policy_number: e.target.value || null }))} placeholder="Optional" />
                </div>
              </div>
            )}

            {/* Coverage types */}
            <div style={{ marginBottom: 12 }}>
              <label style={labelStyle}>Coverage Types</label>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 6 }}>
                {COVERAGE_TYPE_OPTIONS.map(ct => {
                  const current = (form.coverage_types || '').split(',').map(s => s.trim()).filter(Boolean);
                  const active = current.includes(ct);
                  return (
                    <button
                      key={ct}
                      type="button"
                      onClick={() => {
                        const updated = active ? current.filter(c => c !== ct) : [...current, ct];
                        setForm(f => ({ ...f, coverage_types: updated.join(', ') || null }));
                      }}
                      style={{
                        padding: '4px 10px', borderRadius: 12, fontSize: 12, fontWeight: 600, cursor: 'pointer',
                        border: active ? '1px solid var(--color-primary)' : '1px solid var(--color-border)',
                        backgroundColor: active ? 'var(--color-primary)' : '#fff',
                        color: active ? '#fff' : 'var(--color-text)',
                      }}
                    >
                      {ct}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Coverage amount + dates */}
            <div className="mobile-grid-1" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 12 }}>
              <div>
                <label style={labelStyle}>Coverage Amount ($)</label>
                <input style={inputStyle} type="number" value={form.coverage_amount != null ? form.coverage_amount / 100 : ''} onChange={e => setForm(f => ({ ...f, coverage_amount: e.target.value ? Math.round(Number(e.target.value) * 100) : null }))} placeholder="1,000,000" />
              </div>
              <div>
                <label style={labelStyle}>Effective Date</label>
                <input style={inputStyle} type="date" value={form.effective_date || ''} onChange={e => setForm(f => ({ ...f, effective_date: e.target.value || null }))} />
              </div>
              <div>
                <label style={labelStyle}>Expiration Date</label>
                <input style={inputStyle} type="date" value={form.expiration_date || ''} onChange={e => setForm(f => ({ ...f, expiration_date: e.target.value || null }))} />
              </div>
            </div>

            {/* Minimum coverage for received */}
            {form.direction === 'received' && (
              <div style={{ marginBottom: 12 }}>
                <label style={labelStyle}>Minimum Required Coverage ($)</label>
                <input style={inputStyle} type="number" value={form.minimum_coverage != null ? form.minimum_coverage / 100 : ''} onChange={e => setForm(f => ({ ...f, minimum_coverage: e.target.value ? Math.round(Number(e.target.value) * 100) : null }))} placeholder="What coverage do you require from them?" />
              </div>
            )}

            {/* Compliance checkboxes */}
            <div style={{ display: 'flex', gap: 20, marginBottom: 16 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer' }}>
                <input type="checkbox" checked={form.additional_insured || false} onChange={e => setForm(f => ({ ...f, additional_insured: e.target.checked }))} />
                Additional Insured
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer' }}>
                <input type="checkbox" checked={form.waiver_of_subrogation || false} onChange={e => setForm(f => ({ ...f, waiver_of_subrogation: e.target.checked }))} />
                Waiver of Subrogation
              </label>
            </div>

            {/* Notes */}
            <div style={{ marginBottom: 20 }}>
              <label style={labelStyle}>Notes</label>
              <textarea style={{ ...inputStyle, minHeight: 60 }} value={form.notes || ''} onChange={e => setForm(f => ({ ...f, notes: e.target.value || null }))} placeholder="Optional notes..." />
            </div>

            {/* Buttons */}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
              <button onClick={resetForm} style={{ padding: '8px 20px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', backgroundColor: '#fff', cursor: 'pointer', fontSize: 14 }}>Cancel</button>
              <button onClick={handleSave} style={{ padding: '8px 20px', backgroundColor: 'var(--color-primary)', color: '#fff', border: 'none', borderRadius: 'var(--radius-sm)', fontWeight: 600, cursor: 'pointer', fontSize: 14 }}>
                {editingId ? 'Save Changes' : 'Add Certificate'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete confirmation */}
      {deleteConfirm != null && (
        <ConfirmDialog
          open={true}
          title="Delete Certificate"
          message="Are you sure you want to delete this certificate? This cannot be undone."
          confirmLabel="Delete"
          danger
          onConfirm={() => handleDelete(deleteConfirm)}
          onCancel={() => setDeleteConfirm(null)}
        />
      )}
    </div>
  );
}
