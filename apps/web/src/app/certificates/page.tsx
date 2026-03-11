'use client';

import { useState, useEffect, useRef, useMemo, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '../../../lib/auth';
import { certificatesApi, policiesApi, leaseComplianceApi, Certificate, CertificateCreate, Policy, LeaseRequirement, checkFeatureAccess } from '../../../lib/api';
import { useToast } from '../components/Toast';
import ConfirmDialog from '../components/ConfirmDialog';
import UpgradePrompt from '../components/UpgradePrompt';
import BackButton from '../components/BackButton';
import { trackClick, trackPageView, trackFeatureUse } from '../../../lib/track';
import { CERT_STATUS_COLORS, COMPLIANCE_STATUS_COLORS } from '../constants';

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

const COVERAGE_TYPE_OPTIONS = ['General Liability', 'Auto', 'Workers Comp', 'Umbrella', 'Professional Liability', 'Property'];

type ComplianceRow = {
  id: string;
  sourceType: 'certificate' | 'lease_check';
  sourceId: number;
  entity: string;
  evidenceLabel: string;
  status: string;
  statusLabel: string;
  expiration: string | null;
  raw: Certificate | LeaseRequirement;
};

const STATUS_PRIORITY: Record<string, number> = {
  non_compliant: 0, expired: 1, expiring: 2, partial: 3, pending: 4, compliant: 5,
};

function buildComplianceRows(
  certificates: Certificate[],
  leaseReqs: LeaseRequirement[],
  policyMap: Map<number, Policy>,
): ComplianceRow[] {
  const rows: ComplianceRow[] = [];

  for (const cert of certificates) {
    const policy = cert.policy_id ? policyMap.get(cert.policy_id) : null;
    let entity = cert.counterparty_name;
    if (policy?.business_name) entity = policy.business_name;
    else if (policy?.scope === 'personal') entity = 'Personal';

    let status = 'pending';
    if (cert.status === 'active') {
      if (cert.direction === 'received' && cert.minimum_coverage != null && cert.coverage_amount != null) {
        status = cert.coverage_amount >= cert.minimum_coverage ? 'compliant' : 'non_compliant';
      } else {
        status = 'compliant';
      }
    } else if (cert.status === 'expiring') {
      status = 'expiring';
    } else if (cert.status === 'expired') {
      status = 'expired';
    }

    const sc = COMPLIANCE_STATUS_COLORS[status] || COMPLIANCE_STATUS_COLORS.pending;
    rows.push({
      id: `cert-${cert.id}`,
      sourceType: 'certificate',
      sourceId: cert.id,
      entity,
      evidenceLabel: `COI${cert.coverage_types ? ' \u2014 ' + cert.coverage_types : ''}`,
      status,
      statusLabel: sc.label,
      expiration: cert.expiration_date || null,
      raw: cert,
    });
  }

  for (const req of leaseReqs) {
    const policy = req.policy_id ? policyMap.get(req.policy_id) : null;
    let entity = req.counterparty_name || req.label;
    if (policy?.business_name) entity = policy.business_name;

    let status = 'pending';
    if (req.latest_check) {
      const lc = req.latest_check;
      if (lc.fail_count === 0 && lc.unclear_count === 0 && lc.pass_count > 0) status = 'compliant';
      else if (lc.fail_count > 0 && lc.pass_count > 0) status = 'partial';
      else if (lc.fail_count > 0) status = 'non_compliant';
      else status = 'pending';
    }

    const sc = COMPLIANCE_STATUS_COLORS[status] || COMPLIANCE_STATUS_COLORS.pending;
    rows.push({
      id: `lease-${req.id}`,
      sourceType: 'lease_check',
      sourceId: req.id,
      entity,
      evidenceLabel: `Lease Check \u2014 ${req.label}`,
      status,
      statusLabel: sc.label,
      expiration: null,
      raw: req,
    });
  }

  rows.sort((a, b) => {
    const pa = STATUS_PRIORITY[a.status] ?? 5;
    const pb = STATUS_PRIORITY[b.status] ?? 5;
    if (pa !== pb) return pa - pb;
    if (a.expiration && b.expiration) return a.expiration.localeCompare(b.expiration);
    if (a.expiration) return -1;
    if (b.expiration) return 1;
    return a.entity.localeCompare(b.entity);
  });

  return rows;
}

export default function CertificatesPage() {
  return <Suspense><CertificatesContent /></Suspense>;
}

function CertificatesContent() {
  const { token, plan, logout } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const addForPolicyId = searchParams.get('addFor') ? Number(searchParams.get('addFor')) : null;
  const { toast } = useToast();

  const [certificates, setCertificates] = useState<Certificate[]>([]);
  const [policies, setPolicies] = useState<Policy[]>([]);
  const [leaseReqs, setLeaseReqs] = useState<LeaseRequirement[]>([]);
  const [loading, setLoading] = useState(true);

  // Filters
  const [typeFilter, setTypeFilter] = useState<'all' | 'certificates' | 'lease_checks'>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | 'compliant' | 'issues'>('all');

  // Certificate form state
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<number | null>(null);
  const [form, setForm] = useState<CertificateCreate>({
    direction: 'issued',
    counterparty_name: '',
    counterparty_type: 'client',
  });
  const [extracting, setExtracting] = useState(false);
  const [linkingCertId, setLinkingCertId] = useState<number | null>(null);
  const [viewingCert, setViewingCert] = useState<Certificate | null>(null);
  const coiFileRef = useRef<HTMLInputElement>(null);

  // Add Verification choice modal
  const [showAddChoice, setShowAddChoice] = useState(false);

  // Lease detail modal
  const [viewingLease, setViewingLease] = useState<LeaseRequirement | null>(null);

  useEffect(() => {
    if (!token) { router.replace('/login'); return; }
    trackPageView('compliance_verification');
    load();
  }, [token]);

  async function load() {
    try {
      const [certs, pols, reqs] = await Promise.all([
        certificatesApi.list(),
        policiesApi.list(),
        leaseComplianceApi.list().catch(() => [] as LeaseRequirement[]),
      ]);
      setCertificates(certs);
      setPolicies(pols);
      setLeaseReqs(reqs);
      if (addForPolicyId && pols.some(p => p.id === addForPolicyId)) {
        setForm(f => ({ ...f, policy_id: addForPolicyId }));
        setShowForm(true);
      }
    } catch {
      toast('Failed to load data', 'error');
    } finally {
      setLoading(false);
    }
  }

  const policyMap = useMemo(() => new Map(policies.map(p => [p.id, p])), [policies]);

  const complianceRows = useMemo(
    () => buildComplianceRows(certificates, leaseReqs, policyMap),
    [certificates, leaseReqs, policyMap],
  );

  const filteredRows = useMemo(() => {
    let rows = complianceRows;
    if (typeFilter === 'certificates') rows = rows.filter(r => r.sourceType === 'certificate');
    if (typeFilter === 'lease_checks') rows = rows.filter(r => r.sourceType === 'lease_check');
    if (statusFilter === 'compliant') rows = rows.filter(r => r.status === 'compliant');
    if (statusFilter === 'issues') rows = rows.filter(r => r.status !== 'compliant');
    return rows;
  }, [complianceRows, typeFilter, statusFilter]);

  // Summary counts
  const totalCount = complianceRows.length;
  const compliantCount = complianceRows.filter(r => r.status === 'compliant').length;
  const issuesCount = complianceRows.filter(r => ['non_compliant', 'partial', 'expired', 'expiring'].includes(r.status)).length;

  // Policy dropdown groups for certificate form
  const policyOptGroups = useMemo(() => {
    const personal = policies.filter(p => p.scope === 'personal');
    const bizMap = new Map<string, Policy[]>();
    for (const p of policies.filter(p => p.scope === 'business')) {
      const group = p.business_name || 'Other Business';
      if (!bizMap.has(group)) bizMap.set(group, []);
      bizMap.get(group)!.push(p);
    }
    const groups: { label: string; items: Policy[] }[] = [];
    if (personal.length) groups.push({ label: 'Personal', items: personal });
    for (const [name, items] of Array.from(bizMap.entries()).sort((a, b) => a[0].localeCompare(b[0]))) {
      groups.push({ label: name, items });
    }
    return groups;
  }, [policies]);

  function resetForm() {
    setForm({ direction: 'issued', counterparty_name: '', counterparty_type: 'client' });
    setEditingId(null);
    setShowForm(false);
  }

  function startEdit(cert: Certificate) {
    trackClick('cert_edit', { id: cert.id });
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
        trackClick('cert_save_edit', { id: editingId });
        await certificatesApi.update(editingId, form);
        toast('Certificate updated');
      } else {
        trackClick('cert_save_new');
        await certificatesApi.create(form);
        toast('Certificate added');
        // Auto-prompt: check against lease requirements for received certs
        if (form.direction === 'received' && leaseReqs.length > 0) {
          const matchingReqs = form.policy_id
            ? leaseReqs.filter(r => r.policy_id === form.policy_id)
            : leaseReqs;
          if (matchingReqs.length > 0 && matchingReqs[0].policy_id) {
            trackFeatureUse('coi_lease_check_prompt');
            setTimeout(() => {
              toast('Check this COI against lease requirements on the policy page', 'info');
            }, 500);
          }
        }
      }
      resetForm();
      load();
    } catch {
      toast('Failed to save certificate', 'error');
    }
  }

  async function handleDelete(id: number) {
    trackClick('cert_delete', { id });
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
    trackClick('cert_extract_coi');
    setExtracting(true);
    try {
      const { extraction } = await certificatesApi.extractFromPdf(file);
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

  function handleRowClick(row: ComplianceRow) {
    trackClick('compliance_row_view', { type: row.sourceType, id: row.sourceId });
    if (row.sourceType === 'certificate') {
      setViewingCert(row.raw as Certificate);
    } else {
      setViewingLease(row.raw as LeaseRequirement);
    }
  }

  const labelStyle: React.CSSProperties = { display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--color-text-secondary)', marginBottom: 4 };
  const inputStyle: React.CSSProperties = { width: '100%', padding: '8px 10px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', fontSize: 14 };
  const pillBase: React.CSSProperties = { padding: '6px 14px', borderRadius: 20, fontSize: 13, fontWeight: 600, cursor: 'pointer', border: 'none', transition: 'all 0.15s' };

  if (loading) {
    return (
      <div style={{ padding: 32, maxWidth: 960, margin: '0 auto' }}>
        <div style={{ height: 32, width: 200, backgroundColor: '#f3f4f6', borderRadius: 8, marginBottom: 24 }} />
        {[1, 2, 3].map(i => (
          <div key={i} style={{ height: 72, backgroundColor: '#f3f4f6', borderRadius: 12, marginBottom: 12 }} />
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
      <BackButton href="/" label="Compliance" parentLabel="Home" />

      {/* Page Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24, flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>Compliance Verification</h1>
          <p style={{ fontSize: 13, color: 'var(--color-text-secondary)', margin: '4px 0 0' }}>
            Verify insurance requirements against certificates and policies
          </p>
        </div>
        <button
          onClick={() => { trackClick('add_verification_open'); setShowAddChoice(true); }}
          style={{
            padding: '10px 20px', backgroundColor: 'var(--color-primary)', color: '#fff',
            border: 'none', borderRadius: 'var(--radius-md)', fontWeight: 600, fontSize: 14, cursor: 'pointer',
          }}
        >
          + Add Verification
        </button>
      </div>

      {/* Summary Bar */}
      {totalCount > 0 && (
        <div style={{
          marginBottom: 20, padding: '12px 20px', backgroundColor: '#fff',
          border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)',
          display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
        }}>
          <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-text)' }}>
            {totalCount} verification{totalCount !== 1 ? 's' : ''}
          </span>
          {compliantCount > 0 && (
            <span style={{ padding: '2px 10px', borderRadius: 10, fontSize: 12, fontWeight: 600, backgroundColor: '#dcfce7', color: '#166534' }}>
              {compliantCount} compliant
            </span>
          )}
          {issuesCount > 0 && (
            <span style={{ padding: '2px 10px', borderRadius: 10, fontSize: 12, fontWeight: 600, backgroundColor: '#fee2e2', color: '#991b1b' }}>
              {issuesCount} need{issuesCount === 1 ? 's' : ''} attention
            </span>
          )}
        </div>
      )}

      {/* Filter Bar */}
      <div className="search-toolbar" style={{ display: 'flex', gap: 8, marginBottom: 24, flexWrap: 'wrap', alignItems: 'center' }}>
        {/* Type filter pills */}
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          {([
            { key: 'all', label: 'All' },
            { key: 'certificates', label: 'Certificates' },
            { key: 'lease_checks', label: 'Lease Checks' },
          ] as const).map(f => (
            <button
              key={f.key}
              onClick={() => { trackClick('compliance_filter_type', { value: f.key }); setTypeFilter(f.key); }}
              style={{
                ...pillBase,
                backgroundColor: typeFilter === f.key ? 'var(--color-primary)' : '#f3f4f6',
                color: typeFilter === f.key ? '#fff' : 'var(--color-text)',
              }}
            >
              {f.label}
            </button>
          ))}
        </div>

        <div style={{ width: 1, height: 24, backgroundColor: 'var(--color-border)', margin: '0 4px' }} />

        {/* Status filter pills */}
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          {([
            { key: 'all', label: 'All Statuses' },
            { key: 'compliant', label: 'Compliant' },
            { key: 'issues', label: 'Issues' },
          ] as const).map(f => (
            <button
              key={f.key}
              onClick={() => { trackClick('compliance_filter_status', { value: f.key }); setStatusFilter(f.key); }}
              style={{
                ...pillBase,
                backgroundColor: statusFilter === f.key ? (f.key === 'issues' ? '#991b1b' : f.key === 'compliant' ? '#166534' : 'var(--color-primary)') : '#f3f4f6',
                color: statusFilter === f.key ? '#fff' : 'var(--color-text)',
              }}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {/* Empty State */}
      {filteredRows.length === 0 && (
        <div style={{ textAlign: 'center', padding: '60px 20px', color: 'var(--color-text-secondary)' }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>&#128203;</div>
          {totalCount === 0 ? (
            <>
              <p style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>No compliance verifications yet</p>
              <p style={{ fontSize: 13, maxWidth: '90%', margin: '0 auto 20px' }}>
                Upload a certificate of insurance or define lease requirements to start verifying compliance.
              </p>
              <button
                onClick={() => { trackClick('empty_add_verification'); setShowAddChoice(true); }}
                style={{
                  padding: '10px 24px', backgroundColor: 'var(--color-primary)', color: '#fff',
                  border: 'none', borderRadius: 'var(--radius-md)', fontWeight: 600, fontSize: 14, cursor: 'pointer',
                }}
              >
                + Add Verification
              </button>
            </>
          ) : (
            <>
              <p style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>No matches</p>
              <p style={{ fontSize: 13 }}>Try adjusting your filters.</p>
            </>
          )}
        </div>
      )}

      {/* Unified Compliance Table */}
      {filteredRows.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
          {/* Table header — desktop */}
          <div
            className="mobile-grid-1"
            style={{
              display: 'grid', gridTemplateColumns: '2fr 2fr 1fr 1fr',
              gap: 12, padding: '10px 16px', fontSize: 12, fontWeight: 600,
              color: 'var(--color-text-secondary)', borderBottom: '1px solid var(--color-border)',
            }}
          >
            <span>Entity / Tenant</span>
            <span>Evidence</span>
            <span>Status</span>
            <span>Expiration</span>
          </div>

          {/* Rows */}
          {filteredRows.map(row => {
            const sc = COMPLIANCE_STATUS_COLORS[row.status] || COMPLIANCE_STATUS_COLORS.pending;
            return (
              <div
                key={row.id}
                onClick={() => handleRowClick(row)}
                style={{
                  display: 'grid', gridTemplateColumns: '2fr 2fr 1fr 1fr',
                  gap: 12, padding: '14px 16px', borderBottom: '1px solid var(--color-border)',
                  cursor: 'pointer', backgroundColor: '#fff', transition: 'background-color 0.1s',
                  alignItems: 'center',
                }}
                className="mobile-grid-1 compliance-row"
                onMouseEnter={e => (e.currentTarget.style.backgroundColor = '#f9fafb')}
                onMouseLeave={e => (e.currentTarget.style.backgroundColor = '#fff')}
              >
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {row.entity}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 2 }}>
                    {row.sourceType === 'certificate' ? 'Certificate' : 'Lease Check'}
                  </div>
                </div>
                <div style={{ fontSize: 13, color: 'var(--color-text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>
                  {row.evidenceLabel}
                </div>
                <div>
                  <span style={{
                    display: 'inline-block', padding: '3px 10px', borderRadius: 12,
                    fontSize: 12, fontWeight: 600, backgroundColor: sc.bg, color: sc.fg,
                    whiteSpace: 'nowrap',
                  }}>
                    {sc.label}
                  </span>
                </div>
                <div style={{ fontSize: 13, color: row.expiration ? 'var(--color-text)' : 'var(--color-text-muted)' }}>
                  {row.expiration || '\u2014'}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── Add Verification Choice Modal ── */}
      {showAddChoice && (
        <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.5)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
          <div style={{ backgroundColor: '#fff', borderRadius: 'var(--radius-lg)', padding: 20, maxWidth: 520, width: '100%' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
              <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>Add Verification</h2>
              <button
                onClick={() => { trackClick('add_verification_close'); setShowAddChoice(false); }}
                style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: 'var(--color-text-muted)', padding: 0, lineHeight: 1 }}
              >&times;</button>
            </div>
            <p style={{ fontSize: 14, color: 'var(--color-text-secondary)', margin: '0 0 20px' }}>
              What would you like to do?
            </p>
            <div className="form-grid-2" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
              <button
                onClick={() => {
                  trackClick('add_verification_upload');
                  setShowAddChoice(false);
                  resetForm();
                  setShowForm(true);
                }}
                style={{
                  padding: 24, border: '2px solid var(--color-border)', borderRadius: 'var(--radius-lg)',
                  backgroundColor: '#fff', cursor: 'pointer', textAlign: 'center', transition: 'border-color 0.15s',
                }}
                onMouseEnter={e => (e.currentTarget.style.borderColor = 'var(--color-primary)')}
                onMouseLeave={e => (e.currentTarget.style.borderColor = 'var(--color-border)')}
              >
                <div style={{ fontSize: 32, marginBottom: 12 }}>&#128196;</div>
                <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 6, color: 'var(--color-text)' }}>Upload Evidence</div>
                <div style={{ fontSize: 12, color: 'var(--color-text-secondary)', lineHeight: 1.5 }}>
                  Upload a COI or proof of insurance document
                </div>
              </button>
              <button
                onClick={() => {
                  trackClick('add_verification_define_reqs');
                  setShowAddChoice(false);
                  const bizPolicies = policies.filter(p => p.scope === 'business' && p.status === 'active');
                  if (bizPolicies.length === 0) {
                    toast('Add a business policy first, then define lease requirements on it.', 'info');
                    router.push('/policies');
                  } else if (bizPolicies.length === 1) {
                    router.push(`/policies/${bizPolicies[0].id}`);
                  } else {
                    // Show policy picker by navigating to policies
                    toast('Select a business policy to define requirements on.', 'info');
                    router.push('/policies');
                  }
                }}
                style={{
                  padding: 24, border: '2px solid var(--color-border)', borderRadius: 'var(--radius-lg)',
                  backgroundColor: '#fff', cursor: 'pointer', textAlign: 'center', transition: 'border-color 0.15s',
                }}
                onMouseEnter={e => (e.currentTarget.style.borderColor = 'var(--color-primary)')}
                onMouseLeave={e => (e.currentTarget.style.borderColor = 'var(--color-border)')}
              >
                <div style={{ fontSize: 32, marginBottom: 12 }}>&#128203;</div>
                <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 6, color: 'var(--color-text)' }}>Define Requirements</div>
                <div style={{ fontSize: 12, color: 'var(--color-text-secondary)', lineHeight: 1.5 }}>
                  Set lease or contract insurance requirements to check against
                </div>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Add/Edit Certificate Form Modal ── */}
      {showForm && (
        <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.5)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
          <div style={{ backgroundColor: '#fff', borderRadius: 'var(--radius-lg)', padding: 20, maxWidth: 560, width: '100%', maxHeight: '90vh', overflowY: 'auto' }}>
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
                <div style={{ fontSize: 11, color: '#6b7280', marginTop: 6 }}>&#128274; Your documents are encrypted and never shared.</div>
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
                    onClick={() => { trackClick('cert_form_direction', { value: d }); setForm(f => ({ ...f, direction: d })); }}
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

            {/* Linked policy */}
            <div style={{
              marginBottom: 16, padding: 12, borderRadius: 'var(--radius-sm)',
              backgroundColor: form.policy_id ? '#f0fdf4' : '#fef3c7',
              border: `1px solid ${form.policy_id ? '#bbf7d0' : '#fcd34d'}`,
            }}>
              <label style={{ ...labelStyle, color: form.policy_id ? '#166534' : '#92400e' }}>
                {form.policy_id ? 'Linked to Policy' : 'Link to a Policy (recommended)'}
              </label>
              <select
                style={{ ...inputStyle, borderColor: form.policy_id ? '#86efac' : '#d97706' }}
                value={form.policy_id ?? ''}
                onChange={e => { trackClick('cert_form_link_policy'); setForm(f => ({ ...f, policy_id: e.target.value ? Number(e.target.value) : null })); }}
              >
                <option value="">Select a policy...</option>
                {policyOptGroups.map(g => (
                  <optgroup key={g.label} label={g.label}>
                    {g.items.map(p => <option key={p.id} value={p.id}>{p.nickname || p.carrier} - {p.policy_type.replace(/_/g, ' ')}</option>)}
                  </optgroup>
                ))}
              </select>
              {!form.policy_id && (
                <div style={{ fontSize: 11, color: '#92400e', marginTop: 4 }}>
                  Linking ensures the COI badge appears on the policy and certificate shows in policy details.
                </div>
              )}
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
                        trackClick('cert_form_coverage_toggle', { type: ct, active: !active });
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
            <div style={{ display: 'flex', gap: 20, marginBottom: 16, flexWrap: 'wrap' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer' }}>
                <input type="checkbox" checked={form.additional_insured || false} onChange={e => { trackClick('cert_form_additional_insured', { checked: e.target.checked }); setForm(f => ({ ...f, additional_insured: e.target.checked })); }} />
                Additional Insured
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer' }}>
                <input type="checkbox" checked={form.waiver_of_subrogation || false} onChange={e => { trackClick('cert_form_waiver_subrogation', { checked: e.target.checked }); setForm(f => ({ ...f, waiver_of_subrogation: e.target.checked })); }} />
                Waiver of Subrogation
              </label>
            </div>

            {/* Notes */}
            <div style={{ marginBottom: 20 }}>
              <label style={labelStyle}>Notes</label>
              <textarea style={{ ...inputStyle, minHeight: 60 }} value={form.notes || ''} onChange={e => setForm(f => ({ ...f, notes: e.target.value || null }))} placeholder="Optional notes..." />
            </div>

            {/* Buttons */}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, flexWrap: 'wrap' }}>
              <button onClick={() => { trackClick('cert_form_cancel'); resetForm(); }} style={{ padding: '8px 20px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', backgroundColor: '#fff', cursor: 'pointer', fontSize: 14 }}>Cancel</button>
              <button onClick={handleSave} style={{ padding: '8px 20px', backgroundColor: 'var(--color-primary)', color: '#fff', border: 'none', borderRadius: 'var(--radius-sm)', fontWeight: 600, cursor: 'pointer', fontSize: 14 }}>
                {editingId ? 'Save Changes' : 'Add Certificate'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── View Certificate Detail Modal ── */}
      {viewingCert && (() => {
        const vc = viewingCert;
        const vcCtLabel = COUNTERPARTY_TYPES.find(ct => ct.value === vc.counterparty_type)?.label || vc.counterparty_type;
        const vcLinkedPolicy = vc.policy_id ? policyMap.get(vc.policy_id) : null;
        const vcSc = CERT_STATUS_COLORS[vc.status] || CERT_STATUS_COLORS.pending;
        // Check if there are matching lease requirements to prompt
        const matchingLeaseReqs = vc.direction === 'received' && vc.policy_id
          ? leaseReqs.filter(r => r.policy_id === vc.policy_id)
          : [];
        return (
          <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.5)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
            <div style={{ backgroundColor: '#fff', borderRadius: 'var(--radius-lg)', padding: 20, maxWidth: 560, width: '100%', maxHeight: '90vh', overflowY: 'auto' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
                <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>Certificate Details</h2>
                <button onClick={() => { trackClick('cert_detail_close'); setViewingCert(null); }} style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: 'var(--color-text-muted)', padding: 0, lineHeight: 1 }}>&times;</button>
              </div>

              {/* Direction + Status badges */}
              <div style={{ display: 'flex', gap: 8, marginBottom: 20, flexWrap: 'wrap' }}>
                <span style={{
                  padding: '3px 12px', borderRadius: 12, fontSize: 12, fontWeight: 600,
                  backgroundColor: vc.direction === 'issued' ? '#dbeafe' : '#fce7f3',
                  color: vc.direction === 'issued' ? '#1e40af' : '#9d174d',
                }}>
                  {vc.direction === 'issued' ? 'Shared (outgoing)' : 'Received (incoming)'}
                </span>
                <span style={{
                  padding: '3px 12px', borderRadius: 12, fontSize: 12, fontWeight: 600,
                  backgroundColor: vcSc.bg, color: vcSc.fg,
                }}>
                  {vc.status}
                </span>
              </div>

              {/* Counterparty */}
              <div className="form-grid-2" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 20 }}>
                <div>
                  <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text-secondary)', marginBottom: 4 }}>Counterparty</div>
                  <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--color-text)' }}>{vc.counterparty_name}</div>
                </div>
                <div>
                  <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text-secondary)', marginBottom: 4 }}>Type</div>
                  <div style={{ fontSize: 15, color: 'var(--color-text)' }}>{vcCtLabel}</div>
                </div>
              </div>

              {vc.counterparty_email && (
                <div style={{ marginBottom: 20 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text-secondary)', marginBottom: 4 }}>Email</div>
                  <div style={{ fontSize: 14, color: 'var(--color-text)' }}>{vc.counterparty_email}</div>
                </div>
              )}

              {/* Linked Policy */}
              {vcLinkedPolicy && (
                <div style={{
                  marginBottom: 20, padding: 12, borderRadius: 'var(--radius-sm)',
                  backgroundColor: '#f0fdf4', border: '1px solid #bbf7d0',
                }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: '#166534', marginBottom: 4 }}>Linked to Policy</div>
                  <div style={{ fontSize: 14, color: 'var(--color-text)' }}>
                    {vcLinkedPolicy.nickname || vcLinkedPolicy.carrier} &mdash; {vcLinkedPolicy.policy_type}
                  </div>
                </div>
              )}

              {/* Carrier + Policy # */}
              {(vc.carrier || vc.policy_number) && (
                <div className="form-grid-2" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 20 }}>
                  {vc.carrier && <div>
                    <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text-secondary)', marginBottom: 4 }}>{vc.direction === 'received' ? 'Their Carrier' : 'Carrier'}</div>
                    <div style={{ fontSize: 14, color: 'var(--color-text)' }}>{vc.carrier}</div>
                  </div>}
                  {vc.policy_number && <div>
                    <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text-secondary)', marginBottom: 4 }}>{vc.direction === 'received' ? 'Their Policy #' : 'Policy #'}</div>
                    <div style={{ fontSize: 14, color: 'var(--color-text)' }}>{vc.policy_number}</div>
                  </div>}
                </div>
              )}

              {/* Coverage Types */}
              {vc.coverage_types && (
                <div style={{ marginBottom: 20 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text-secondary)', marginBottom: 6 }}>Coverage Types</div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {vc.coverage_types.split(',').map(ct => ct.trim()).filter(Boolean).map(ct => (
                      <span key={ct} style={{
                        padding: '4px 12px', borderRadius: 12, fontSize: 12, fontWeight: 600,
                        border: '1px solid var(--color-primary)', backgroundColor: 'var(--color-primary)', color: '#fff',
                      }}>{ct}</span>
                    ))}
                  </div>
                </div>
              )}

              {/* Amount + Dates */}
              <div className="mobile-grid-1" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16, marginBottom: 20 }}>
                {vc.coverage_amount != null && <div>
                  <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text-secondary)', marginBottom: 4 }}>Coverage Amount</div>
                  <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--color-text)' }}>${(vc.coverage_amount / 100).toLocaleString()}</div>
                </div>}
                {vc.effective_date && <div>
                  <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text-secondary)', marginBottom: 4 }}>Effective Date</div>
                  <div style={{ fontSize: 14, color: 'var(--color-text)' }}>{vc.effective_date}</div>
                </div>}
                {vc.expiration_date && <div>
                  <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text-secondary)', marginBottom: 4 }}>Expiration Date</div>
                  <div style={{ fontSize: 14, color: 'var(--color-text)' }}>{vc.expiration_date}</div>
                </div>}
              </div>

              {/* Minimum coverage for received */}
              {vc.direction === 'received' && vc.minimum_coverage != null && (
                <div style={{ marginBottom: 20 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text-secondary)', marginBottom: 4 }}>Minimum Required Coverage</div>
                  <div style={{ fontSize: 14, color: 'var(--color-text)' }}>${(vc.minimum_coverage / 100).toLocaleString()}</div>
                  {vc.coverage_amount != null && (
                    <div style={{
                      marginTop: 6, padding: '4px 10px', borderRadius: 'var(--radius-sm)', fontSize: 12, fontWeight: 600, display: 'inline-block',
                      backgroundColor: vc.coverage_amount >= vc.minimum_coverage ? '#dcfce7' : '#fee2e2',
                      color: vc.coverage_amount >= vc.minimum_coverage ? '#166534' : '#991b1b',
                    }}>
                      {vc.coverage_amount >= vc.minimum_coverage ? 'Meets requirement' : 'Below requirement'}
                    </div>
                  )}
                </div>
              )}

              {/* Compliance flags */}
              <div style={{ display: 'flex', gap: 20, marginBottom: 20, flexWrap: 'wrap' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
                  <span style={{ color: vc.additional_insured ? '#166534' : 'var(--color-text-muted)', fontSize: 16 }}>{vc.additional_insured ? '\u2713' : '\u2717'}</span>
                  <span style={{ color: vc.additional_insured ? '#166534' : 'var(--color-text-muted)', fontWeight: vc.additional_insured ? 600 : 400 }}>Additional Insured</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
                  <span style={{ color: vc.waiver_of_subrogation ? '#166534' : 'var(--color-text-muted)', fontSize: 16 }}>{vc.waiver_of_subrogation ? '\u2713' : '\u2717'}</span>
                  <span style={{ color: vc.waiver_of_subrogation ? '#166534' : 'var(--color-text-muted)', fontWeight: vc.waiver_of_subrogation ? 600 : 400 }}>Waiver of Subrogation</span>
                </div>
              </div>

              {/* Notes */}
              {vc.notes && (
                <div style={{ marginBottom: 20 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text-secondary)', marginBottom: 4 }}>Notes</div>
                  <div style={{ fontSize: 14, color: 'var(--color-text)', lineHeight: 1.6, fontStyle: 'italic' }}>{vc.notes}</div>
                </div>
              )}

              {/* Auto-prompt: Check against lease requirements */}
              {matchingLeaseReqs.length > 0 && (
                <div style={{
                  marginBottom: 20, padding: '12px 16px', borderRadius: 'var(--radius-md)',
                  backgroundColor: '#f0f9ff', border: '1px solid #bae6fd',
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap',
                }}>
                  <div style={{ fontSize: 13, color: '#0c4a6e', fontWeight: 600 }}>
                    Check this COI against lease requirements?
                  </div>
                  <button
                    onClick={() => {
                      trackClick('cert_check_against_lease', { cert_id: vc.id, policy_id: vc.policy_id });
                      setViewingCert(null);
                      router.push(`/policies/${vc.policy_id}`);
                    }}
                    style={{
                      padding: '6px 14px', fontSize: 12, fontWeight: 600,
                      backgroundColor: 'var(--color-primary)', color: '#fff',
                      border: 'none', borderRadius: 'var(--radius-sm)', cursor: 'pointer',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    Run Check
                  </button>
                </div>
              )}

              {/* Actions */}
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, borderTop: '1px solid var(--color-border)', paddingTop: 16, flexWrap: 'wrap' }}>
                <button onClick={() => { trackClick('cert_detail_close'); setViewingCert(null); }} style={{ padding: '8px 20px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', backgroundColor: '#fff', cursor: 'pointer', fontSize: 14 }}>Close</button>
                <button onClick={() => { trackClick('cert_detail_edit', { id: vc.id }); setViewingCert(null); startEdit(vc); }} style={{ padding: '8px 20px', backgroundColor: 'var(--color-primary)', color: '#fff', border: 'none', borderRadius: 'var(--radius-sm)', fontWeight: 600, cursor: 'pointer', fontSize: 14 }}>Edit</button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ── View Lease Check Detail Modal ── */}
      {viewingLease && (() => {
        const req = viewingLease;
        const lc = req.latest_check;
        let verdict = 'Pending';
        let verdictColor = '#374151';
        let verdictBg = '#f3f4f6';
        if (lc) {
          if (lc.fail_count === 0 && lc.unclear_count === 0 && lc.pass_count > 0) {
            verdict = 'Compliant'; verdictColor = '#166534'; verdictBg = '#dcfce7';
          } else if (lc.fail_count > 0 && lc.pass_count > 0) {
            verdict = 'Partially Compliant'; verdictColor = '#92400e'; verdictBg = '#fef3c7';
          } else if (lc.fail_count > 0) {
            verdict = 'Non-Compliant'; verdictColor = '#991b1b'; verdictBg = '#fee2e2';
          } else {
            verdict = 'Needs Verification'; verdictColor = '#92400e'; verdictBg = '#fef3c7';
          }
        }

        return (
          <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.5)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
            <div style={{ backgroundColor: '#fff', borderRadius: 'var(--radius-lg)', padding: 20, maxWidth: 560, width: '100%', maxHeight: '90vh', overflowY: 'auto' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
                <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>Lease Check Details</h2>
                <button onClick={() => { trackClick('lease_detail_close'); setViewingLease(null); }} style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: 'var(--color-text-muted)', padding: 0, lineHeight: 1 }}>&times;</button>
              </div>

              {/* Verdict banner */}
              <div style={{
                padding: '12px 16px', borderRadius: 'var(--radius-md)', marginBottom: 20,
                backgroundColor: verdictBg, textAlign: 'center',
              }}>
                <div style={{ fontSize: 16, fontWeight: 700, color: verdictColor }}>{verdict}</div>
                {lc && (
                  <div style={{ fontSize: 12, color: verdictColor, marginTop: 4 }}>
                    {lc.pass_count} passed &middot; {lc.fail_count} failed &middot; {lc.unclear_count} unclear
                  </div>
                )}
              </div>

              {/* Details */}
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 8, color: 'var(--color-text)' }}>{req.label}</div>
                <div className="form-grid-2" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text-secondary)', marginBottom: 2 }}>Role</div>
                    <div style={{ fontSize: 14 }}>{req.role === 'tenant' ? 'Tenant' : 'Landlord'}</div>
                  </div>
                  {req.counterparty_name && (
                    <div>
                      <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text-secondary)', marginBottom: 2 }}>Counterparty</div>
                      <div style={{ fontSize: 14 }}>{req.counterparty_name}</div>
                    </div>
                  )}
                  {req.property_address && (
                    <div>
                      <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text-secondary)', marginBottom: 2 }}>Property</div>
                      <div style={{ fontSize: 14 }}>{req.property_address}</div>
                    </div>
                  )}
                </div>
              </div>

              {/* Actions */}
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, borderTop: '1px solid var(--color-border)', paddingTop: 16, flexWrap: 'wrap' }}>
                {req.policy_id && (
                  <button
                    onClick={() => {
                      trackClick('lease_detail_view_policy', { id: req.id, policy_id: req.policy_id });
                      setViewingLease(null);
                      router.push(`/policies/${req.policy_id}`);
                    }}
                    style={{ padding: '8px 20px', backgroundColor: 'var(--color-primary)', color: '#fff', border: 'none', borderRadius: 'var(--radius-sm)', fontWeight: 600, cursor: 'pointer', fontSize: 14 }}
                  >
                    View on Policy
                  </button>
                )}
                <button
                  onClick={() => {
                    trackClick('lease_detail_share', { id: req.id });
                    const url = `${window.location.origin}/lease-compliance/${req.access_code}`;
                    navigator.clipboard.writeText(url);
                    toast('Link copied to clipboard');
                  }}
                  style={{ padding: '8px 20px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', backgroundColor: '#fff', cursor: 'pointer', fontSize: 14 }}
                >
                  Copy Link
                </button>
                <button
                  onClick={async () => {
                    trackClick('lease_detail_delete', { id: req.id });
                    if (!confirm('Delete this lease check?')) return;
                    try {
                      await leaseComplianceApi.remove(req.id);
                      toast('Lease check deleted');
                      setViewingLease(null);
                      load();
                    } catch {
                      toast('Failed to delete', 'error');
                    }
                  }}
                  style={{ padding: '8px 20px', border: '1px solid #fecaca', borderRadius: 'var(--radius-sm)', backgroundColor: '#fff', color: 'var(--color-danger)', cursor: 'pointer', fontSize: 14 }}
                >
                  Delete
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Delete confirmation */}
      {deleteConfirm != null && (
        <ConfirmDialog
          open={true}
          title="Delete Certificate"
          message="Are you sure you want to delete this certificate? This cannot be undone."
          confirmLabel="Delete"
          danger
          onConfirm={() => handleDelete(deleteConfirm)}
          onCancel={() => { trackClick('cert_delete_cancel'); setDeleteConfirm(null); }}
        />
      )}
    </div>
  );
}
