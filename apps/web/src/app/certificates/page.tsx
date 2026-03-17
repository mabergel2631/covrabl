'use client';

import { useState, useEffect, useRef, useMemo, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '../../../lib/auth';
import { certificatesApi, policiesApi, leaseComplianceApi, Certificate, CertificateCreate, Policy, LeaseRequirement, LeaseRequirementItem, LeaseExtraction, ComplianceResultItem, checkFeatureAccess } from '../../../lib/api';
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
      evidenceLabel: `${req.role === 'requester' ? 'Document Check' : 'Lease Check'} \u2014 ${req.label}`,
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
  const editCertId = searchParams.get('edit') ? Number(searchParams.get('edit')) : null;
  const fromPolicyId = searchParams.get('from') ? Number(searchParams.get('from')) : addForPolicyId;
  const notifyReqId = searchParams.get('notify') ? Number(searchParams.get('notify')) : null;
  const { toast } = useToast();
  const notifyUsed = useRef(false);

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
  const [viewingCert, setViewingCert] = useState<Certificate | null>(null);
  const coiFileRef = useRef<HTMLInputElement>(null);

  // Add Verification choice modal
  const [showAddChoice, setShowAddChoice] = useState(false);
  const [addForUsed, setAddForUsed] = useState(false);
  const [editCertUsed, setEditCertUsed] = useState(false);
  const [showPolicyPicker, setShowPolicyPicker] = useState(false);

  // Lease detail modal
  const [viewingLease, setViewingLease] = useState<LeaseRequirement | null>(null);

  // Compare Documents multi-step flow
  const [showDocFlow, setShowDocFlow] = useState(false);
  const [docStep, setDocStep] = useState(1); // 1=input, 2=review, 3=compare, 4=results
  const [docBusy, setDocBusy] = useState(false);
  const docFileRef = useRef<HTMLInputElement>(null);
  const docCoiRef = useRef<HTMLInputElement>(null);
  const [docInputMode, setDocInputMode] = useState<'paste' | 'pdf'>('paste');
  const [docPasteText, setDocPasteText] = useState('');
  const [docLabel, setDocLabel] = useState('');
  const [docCounterpartyName, setDocCounterpartyName] = useState('');
  const [docCounterpartyEmail, setDocCounterpartyEmail] = useState('');
  const [docExtraction, setDocExtraction] = useState<LeaseExtraction | null>(null);
  const [docReqs, setDocReqs] = useState<LeaseRequirementItem[]>([]);
  const [docSavedReq, setDocSavedReq] = useState<LeaseRequirement | null>(null);
  const [docResults, setDocResults] = useState<ComplianceResultItem[]>([]);
  const [docResultCounts, setDocResultCounts] = useState({ pass: 0, fail: 0, unclear: 0 });
  const docPollCancelled = useRef(false);

  function resetDocFlow() {
    setDocStep(1); setDocBusy(false); setDocInputMode('paste'); setDocPasteText('');
    setDocLabel(''); setDocCounterpartyName(''); setDocCounterpartyEmail('');
    setDocExtraction(null); setDocReqs([]); setDocSavedReq(null);
    setDocResults([]); setDocResultCounts({ pass: 0, fail: 0, unclear: 0 });
    docPollCancelled.current = true;
  }

  // Delete requirement confirm
  const [deleteReqConfirm, setDeleteReqConfirm] = useState<number | null>(null);

  // Lease detail: loaded results & send modals
  const [leaseDetailResults, setLeaseDetailResults] = useState<ComplianceResultItem[]>([]);
  const [leaseDetailLoading, setLeaseDetailLoading] = useState(false);
  const [leaseDetailCheckId, setLeaseDetailCheckId] = useState<number | null>(null);
  const [leaseDetailHasDoc, setLeaseDetailHasDoc] = useState(false);
  const [showSendToCounterparty, setShowSendToCounterparty] = useState(false);
  const [sendEmail, setSendEmail] = useState('');
  const [sendName, setSendName] = useState('');
  const [sendNotes, setSendNotes] = useState('');
  const [sendMode, setSendMode] = useState<'request' | 'deficiency'>('request');

  useEffect(() => {
    if (!token) {
      const returnTo = typeof window !== 'undefined' ? window.location.pathname + window.location.search : '/certificates';
      router.replace('/login?returnTo=' + encodeURIComponent(returnTo));
      return;
    }
    trackPageView('compliance_verification');
    // Mark compliance as seen for nav badge
    if (typeof localStorage !== 'undefined') localStorage.setItem('pv_compliance_last_seen', new Date().toISOString());
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
      if (notifyReqId && !notifyUsed.current) {
        notifyUsed.current = true;
        const notifyReq = reqs.find(r => r.id === notifyReqId);
        if (notifyReq) {
          toast(`New COI submission received for "${notifyReq.label}"`, 'success');
          openLeaseDetail(notifyReq);
        }
        // Strip notify param from URL
        router.replace('/certificates', { scroll: false });
      } else if (editCertId && !editCertUsed) {
        const certToEdit = certs.find(c => c.id === editCertId);
        if (certToEdit) {
          startEdit(certToEdit);
          setEditCertUsed(true);
        }
      } else if (addForPolicyId && !addForUsed && pols.some(p => p.id === addForPolicyId)) {
        setForm(f => ({ ...f, policy_id: addForPolicyId }));
        setShowForm(true);
        setAddForUsed(true);
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
    if (!form.counterparty_name.trim()) { toast('Name is required', 'error'); return; }
    const isNew = !editingId;
    try {
      if (editingId) {
        trackClick('cert_save_edit', { id: editingId });
        await certificatesApi.update(editingId, form);
        toast('Certificate updated');
      } else {
        trackClick('cert_save_new');
        await certificatesApi.create(form);
        toast('Certificate added');
      }
      resetForm();
      // If user came from a policy page, navigate back after creating
      if (isNew && fromPolicyId) {
        router.push(`/policies/${fromPolicyId}`);
        return;
      }
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
      const { extraction, file_token } = await certificatesApi.extractFromPdf(file);
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
        file_token: file_token || null,
      }));
      toast(matchedPolicyId ? 'COI extracted and linked to matching policy' : 'COI data extracted successfully');
      if (coiFileRef.current) coiFileRef.current.value = '';
    } catch (err: any) {
      toast(err.message || 'Extraction failed', 'error');
    } finally {
      setExtracting(false);
    }
  }

  async function openLeaseDetail(req: LeaseRequirement) {
    setViewingLease(req);
    setLeaseDetailResults([]);
    setLeaseDetailCheckId(null);
    setLeaseDetailHasDoc(false);
    setLeaseDetailLoading(true);
    try {
      // Refresh the requirement to get up-to-date tenants/latest_check
      const freshReq = await leaseComplianceApi.get(req.id);
      if (freshReq) {
        setViewingLease(freshReq);
        // Also update in the main list so card reflects latest state
        setLeaseReqs(prev => prev.map(r => r.id === freshReq.id ? freshReq : r));
      }
      const checks = await leaseComplianceApi.listChecks(req.id);
      if (checks.length > 0) {
        const latest = checks[0];
        const results: ComplianceResultItem[] = latest.results || (latest.results_json ? JSON.parse(latest.results_json) : []);
        setLeaseDetailResults(results);
        setLeaseDetailCheckId(latest.id);
        setLeaseDetailHasDoc(!!latest.has_document);
      }
    } catch { /* ignore — just won't show results */ }
    setLeaseDetailLoading(false);
  }

  function handleRowClick(row: ComplianceRow) {
    trackClick('compliance_row_view', { type: row.sourceType, id: row.sourceId });
    if (row.sourceType === 'certificate') {
      setViewingCert(row.raw as Certificate);
    } else {
      openLeaseDetail(row.raw as LeaseRequirement);
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
      <BackButton
        href={fromPolicyId ? `/policies/${fromPolicyId}` : '/'}
        label="Compliance"
        parentLabel={fromPolicyId ? (policyMap.get(fromPolicyId)?.nickname || policyMap.get(fromPolicyId)?.carrier || 'Policy') : 'Home'}
      />

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
              display: 'grid', gridTemplateColumns: '2fr 2fr 1fr 1fr auto',
              gap: 12, padding: '10px 16px', fontSize: 12, fontWeight: 600,
              color: 'var(--color-text-secondary)', borderBottom: '1px solid var(--color-border)',
            }}
          >
            <span>Entity / Tenant</span>
            <span>Evidence</span>
            <span>Status</span>
            <span>Expiration</span>
            <span>Actions</span>
          </div>

          {/* Rows */}
          {filteredRows.map(row => {
            const sc = COMPLIANCE_STATUS_COLORS[row.status] || COMPLIANCE_STATUS_COLORS.pending;
            return (
              <div
                key={row.id}
                style={{
                  display: 'grid', gridTemplateColumns: '2fr 2fr 1fr 1fr auto',
                  gap: 12, padding: '14px 16px', borderBottom: '1px solid var(--color-border)',
                  backgroundColor: '#fff', transition: 'background-color 0.1s',
                  alignItems: 'center',
                }}
                className="mobile-grid-1 compliance-row"
                onMouseEnter={e => (e.currentTarget.style.backgroundColor = '#f9fafb')}
                onMouseLeave={e => (e.currentTarget.style.backgroundColor = '#fff')}
              >
                <div
                  style={{ minWidth: 0, cursor: 'pointer' }}
                  onClick={() => handleRowClick(row)}
                >
                  <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {row.entity}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 2 }}>
                    {row.sourceType === 'certificate' ? 'Certificate' : 'Lease Check'}
                  </div>
                </div>
                <div
                  style={{ fontSize: 13, color: 'var(--color-text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0, cursor: 'pointer' }}
                  onClick={() => handleRowClick(row)}
                >
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
                {/* Inline actions */}
                <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                  <button
                    onClick={(e) => { e.stopPropagation(); trackClick('row_view', { type: row.sourceType, id: row.sourceId }); handleRowClick(row); }}
                    style={{ padding: '4px 10px', fontSize: 12, border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', backgroundColor: '#fff', cursor: 'pointer', whiteSpace: 'nowrap' }}
                  >
                    View
                  </button>
                  {row.sourceType === 'certificate' && (row.raw as Certificate).policy_id && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        trackClick('row_verify', { type: row.sourceType, id: row.sourceId });
                        router.push(`/policies/${(row.raw as Certificate).policy_id}?from=certificates`);
                      }}
                      style={{ padding: '4px 10px', fontSize: 12, border: '1px solid #bae6fd', borderRadius: 'var(--radius-sm)', backgroundColor: '#f0f9ff', color: '#0c4a6e', cursor: 'pointer', whiteSpace: 'nowrap', fontWeight: 600 }}
                    >
                      Verify
                    </button>
                  )}
                  {row.sourceType === 'lease_check' && (() => {
                    const lr = row.raw as LeaseRequirement;
                    const hasDocs = lr.has_source_doc || lr.tenants?.some(t => t.has_document);
                    if (!hasDocs) return null;
                    return (
                      <button
                        onClick={async (e) => {
                          e.stopPropagation();
                          trackClick('row_view_docs', { id: lr.id });
                          // If there's a submitted COI, open it directly; otherwise open source doc
                          const tenant = lr.tenants?.find(t => t.has_document);
                          if (tenant) {
                            try {
                              const blob = await leaseComplianceApi.downloadCoiDocument(tenant.check_id);
                              window.open(URL.createObjectURL(blob), '_blank');
                            } catch { toast('Document not available', 'error'); }
                          } else if (lr.has_source_doc) {
                            try {
                              const blob = await leaseComplianceApi.downloadSourceDocument(lr.id);
                              window.open(URL.createObjectURL(blob), '_blank');
                            } catch { toast('Document not available', 'error'); }
                          }
                        }}
                        style={{ padding: '4px 10px', fontSize: 12, border: '1px solid #bbf7d0', borderRadius: 'var(--radius-sm)', backgroundColor: '#f0fdf4', color: '#166534', cursor: 'pointer', whiteSpace: 'nowrap', fontWeight: 600 }}
                      >
                        Docs
                      </button>
                    );
                  })()}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      trackClick('row_delete', { type: row.sourceType, id: row.sourceId });
                      if (row.sourceType === 'certificate') {
                        setDeleteConfirm(row.sourceId);
                      } else {
                        setDeleteReqConfirm(row.sourceId);
                      }
                    }}
                    style={{ padding: '4px 10px', fontSize: 12, border: '1px solid #fecaca', borderRadius: 'var(--radius-sm)', backgroundColor: '#fff', color: 'var(--color-danger)', cursor: 'pointer', whiteSpace: 'nowrap' }}
                  >
                    Delete
                  </button>
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
            <div className="mobile-grid-1" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
              <button
                onClick={() => {
                  trackClick('add_verification_upload');
                  setShowAddChoice(false);
                  resetForm();
                  setShowForm(true);
                }}
                style={{
                  padding: 20, border: '2px solid var(--color-border)', borderRadius: 'var(--radius-lg)',
                  backgroundColor: '#fff', cursor: 'pointer', textAlign: 'center', transition: 'border-color 0.15s',
                }}
                onMouseEnter={e => (e.currentTarget.style.borderColor = 'var(--color-primary)')}
                onMouseLeave={e => (e.currentTarget.style.borderColor = 'var(--color-border)')}
              >
                <div style={{ fontSize: 28, marginBottom: 10 }}>&#128196;</div>
                <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 4, color: 'var(--color-text)' }}>Upload Evidence</div>
                <div style={{ fontSize: 11, color: 'var(--color-text-secondary)', lineHeight: 1.5 }}>
                  Upload a COI or proof of insurance
                </div>
              </button>
              <button
                onClick={() => {
                  trackClick('add_verification_define_reqs');
                  setShowAddChoice(false);
                  const bizPolicies = policies.filter(p => p.scope === 'business' && p.status === 'active');
                  if (bizPolicies.length === 0) {
                    toast('Add a business policy first, then define lease requirements on it.', 'info');
                  } else if (bizPolicies.length === 1) {
                    router.push(`/policies/${bizPolicies[0].id}?from=certificates`);
                  } else {
                    setShowPolicyPicker(true);
                  }
                }}
                style={{
                  padding: 20, border: '2px solid var(--color-border)', borderRadius: 'var(--radius-lg)',
                  backgroundColor: '#fff', cursor: 'pointer', textAlign: 'center', transition: 'border-color 0.15s',
                }}
                onMouseEnter={e => (e.currentTarget.style.borderColor = 'var(--color-primary)')}
                onMouseLeave={e => (e.currentTarget.style.borderColor = 'var(--color-border)')}
              >
                <div style={{ fontSize: 28, marginBottom: 10 }}>&#128203;</div>
                <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 4, color: 'var(--color-text)' }}>From a Policy</div>
                <div style={{ fontSize: 11, color: 'var(--color-text-secondary)', lineHeight: 1.5 }}>
                  Define requirements from an existing policy
                </div>
              </button>
              <button
                onClick={() => {
                  trackClick('add_verification_upload_doc');
                  setShowAddChoice(false);
                  resetDocFlow();
                  setShowDocFlow(true);
                }}
                style={{
                  padding: 20, border: '2px solid var(--color-border)', borderRadius: 'var(--radius-lg)',
                  backgroundColor: '#fff', cursor: 'pointer', textAlign: 'center', transition: 'border-color 0.15s',
                }}
                onMouseEnter={e => (e.currentTarget.style.borderColor = 'var(--color-primary)')}
                onMouseLeave={e => (e.currentTarget.style.borderColor = 'var(--color-border)')}
              >
                <div style={{ fontSize: 28, marginBottom: 10 }}>&#128194;</div>
                <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 4, color: 'var(--color-text)' }}>Compare Documents</div>
                <div style={{ fontSize: 11, color: 'var(--color-text-secondary)', lineHeight: 1.5 }}>
                  Upload a requirements document to compare
                </div>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Policy Picker for Define Requirements ── */}
      {showPolicyPicker && (() => {
        const bizPolicies = policies.filter(p => p.scope === 'business' && p.status === 'active');
        return (
          <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.5)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
            <div style={{ backgroundColor: '#fff', borderRadius: 'var(--radius-lg)', padding: 20, maxWidth: 480, width: '100%' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>Select a Policy</h2>
                <button
                  onClick={() => { trackClick('policy_picker_close'); setShowPolicyPicker(false); }}
                  style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: 'var(--color-text-muted)', padding: 0, lineHeight: 1 }}
                >&times;</button>
              </div>
              <p style={{ fontSize: 13, color: 'var(--color-text-secondary)', margin: '0 0 16px' }}>
                Choose which business policy to define lease requirements on.
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {bizPolicies.map(p => (
                  <button
                    key={p.id}
                    onClick={() => {
                      trackClick('policy_picker_select', { policy_id: p.id });
                      setShowPolicyPicker(false);
                      router.push(`/policies/${p.id}?from=certificates`);
                    }}
                    style={{
                      padding: '12px 16px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)',
                      backgroundColor: '#fff', cursor: 'pointer', textAlign: 'left', transition: 'border-color 0.15s',
                    }}
                    onMouseEnter={e => (e.currentTarget.style.borderColor = 'var(--color-primary)')}
                    onMouseLeave={e => (e.currentTarget.style.borderColor = 'var(--color-border)')}
                  >
                    <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-text)' }}>{p.nickname || p.carrier || 'Unnamed Policy'}</div>
                    <div style={{ fontSize: 12, color: 'var(--color-text-secondary)', marginTop: 2 }}>{p.policy_type.replace(/_/g, ' ')}</div>
                  </button>
                ))}
              </div>
            </div>
          </div>
        );
      })()}

      {/* ── Compare Documents Multi-Step Flow ── */}
      {showDocFlow && (
        <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.5)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
          <div style={{ backgroundColor: '#fff', borderRadius: 'var(--radius-lg)', padding: 20, maxWidth: 600, width: '100%', maxHeight: '90vh', overflowY: 'auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>
                Compare Documents
                <span style={{ fontSize: 12, fontWeight: 400, color: 'var(--color-text-muted)', marginLeft: 10 }}>
                  Step {docStep} of 4
                </span>
              </h2>
              <button onClick={() => { setShowDocFlow(false); resetDocFlow(); }} style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: 'var(--color-text-muted)', padding: 0, lineHeight: 1 }}>&times;</button>
            </div>

            {/* ── Step 1: Input requirements ── */}
            {docStep === 1 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <p style={{ fontSize: 13, color: 'var(--color-text-secondary)', margin: 0 }}>
                  Enter the insurance requirements from your loan, lease, contract, or other document.
                </p>

                {/* Toggle: paste vs PDF */}
                <div style={{ display: 'flex', gap: 8 }}>
                  <button
                    onClick={() => setDocInputMode('paste')}
                    style={{ padding: '6px 14px', borderRadius: 20, fontSize: 13, fontWeight: 600, cursor: 'pointer', border: 'none', backgroundColor: docInputMode === 'paste' ? 'var(--color-primary)' : '#f3f4f6', color: docInputMode === 'paste' ? '#fff' : 'var(--color-text)' }}
                  >Paste Text</button>
                  <button
                    onClick={() => setDocInputMode('pdf')}
                    style={{ padding: '6px 14px', borderRadius: 20, fontSize: 13, fontWeight: 600, cursor: 'pointer', border: 'none', backgroundColor: docInputMode === 'pdf' ? 'var(--color-primary)' : '#f3f4f6', color: docInputMode === 'pdf' ? '#fff' : 'var(--color-text)' }}
                  >Upload PDF</button>
                </div>

                {docInputMode === 'paste' ? (
                  <textarea
                    value={docPasteText}
                    onChange={e => setDocPasteText(e.target.value)}
                    placeholder="Paste the insurance requirements section from your loan, lease, contract, or vendor agreement..."
                    style={{ width: '100%', padding: '10px 12px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', fontSize: 13, minHeight: 140, lineHeight: 1.6, fontFamily: 'var(--font-sans)', resize: 'vertical', boxSizing: 'border-box' }}
                  />
                ) : (
                  <div style={{ padding: 16, backgroundColor: '#f0f9ff', border: '1px dashed #93c5fd', borderRadius: 'var(--radius-md)' }}>
                    <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: 'var(--color-text)', marginBottom: 8 }}>Select PDF document</label>
                    <input ref={docFileRef} type="file" accept=".pdf" style={{ fontSize: 13, width: '100%' }} />
                  </div>
                )}

                <button
                  onClick={async () => {
                    setDocBusy(true);
                    try {
                      trackFeatureUse('compare_documents_extract');
                      let extraction: LeaseExtraction;
                      if (docInputMode === 'paste') {
                        if (!docPasteText.trim()) { toast('Please paste the requirements text', 'error'); setDocBusy(false); return; }
                        const res = await leaseComplianceApi.extract(docPasteText.trim());
                        extraction = res.extraction;
                      } else {
                        const file = docFileRef.current?.files?.[0];
                        if (!file) { toast('Please select a PDF file', 'error'); setDocBusy(false); return; }
                        const res = await leaseComplianceApi.extractPdf(file);
                        extraction = res.extraction;
                      }
                      if (!extraction.requirements || extraction.requirements.length === 0) {
                        toast('No insurance requirements found in the document. Try a different section or document.', 'error');
                        setDocBusy(false);
                        return;
                      }
                      setDocExtraction(extraction);
                      setDocReqs(extraction.requirements);
                      // Auto-fill label from extraction
                      if (!docLabel && extraction.property_address) setDocLabel(extraction.property_address);
                      if (!docCounterpartyName && extraction.landlord_name) setDocCounterpartyName(extraction.landlord_name);
                      setDocStep(2);
                    } catch (err: any) {
                      toast(err.message || 'Extraction failed', 'error');
                    } finally {
                      setDocBusy(false);
                    }
                  }}
                  disabled={docBusy}
                  style={{ padding: '10px 20px', backgroundColor: 'var(--color-primary)', color: '#fff', border: 'none', borderRadius: 'var(--radius-md)', cursor: docBusy ? 'wait' : 'pointer', fontSize: 14, fontWeight: 600, opacity: docBusy ? 0.7 : 1 }}
                >
                  {docBusy ? 'Extracting...' : 'Extract Requirements'}
                </button>
              </div>
            )}

            {/* ── Step 2: Review requirements & save ── */}
            {docStep === 2 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                {docExtraction?.raw_summary && (
                  <div style={{ padding: 12, backgroundColor: '#f0f9ff', borderRadius: 'var(--radius-md)', fontSize: 13, color: '#0c4a6e', lineHeight: 1.5 }}>
                    {docExtraction.raw_summary}
                  </div>
                )}

                <div>
                  <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: 'var(--color-text)', marginBottom: 4 }}>Label *</label>
                  <input type="text" value={docLabel} onChange={e => setDocLabel(e.target.value)} placeholder="e.g. 123 Main St Loan, Vendor Contract" style={{ width: '100%', padding: '8px 10px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', fontSize: 13, boxSizing: 'border-box' }} />
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <div>
                    <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: 'var(--color-text)', marginBottom: 4 }}>Counterparty Name</label>
                    <input type="text" value={docCounterpartyName} onChange={e => setDocCounterpartyName(e.target.value)} placeholder="e.g. ABC Bank" style={{ width: '100%', padding: '8px 10px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', fontSize: 13, boxSizing: 'border-box' }} />
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: 'var(--color-text)', marginBottom: 4 }}>Counterparty Email</label>
                    <input type="email" value={docCounterpartyEmail} onChange={e => setDocCounterpartyEmail(e.target.value)} placeholder="email@example.com" style={{ width: '100%', padding: '8px 10px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', fontSize: 13, boxSizing: 'border-box' }} />
                  </div>
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: 'var(--color-text)', marginBottom: 8 }}>
                    Extracted Requirements ({docReqs.length})
                  </label>
                  <div style={{ maxHeight: 200, overflowY: 'auto', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)' }}>
                    {docReqs.map((r, i) => (
                      <div key={i} style={{ padding: '8px 12px', borderBottom: i < docReqs.length - 1 ? '1px solid var(--color-border)' : 'none', fontSize: 13, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span>{r.label}</span>
                        <button onClick={() => setDocReqs(prev => prev.filter((_, j) => j !== i))} style={{ background: 'none', border: 'none', color: 'var(--color-danger)', cursor: 'pointer', fontSize: 14, padding: '0 4px' }}>&times;</button>
                      </div>
                    ))}
                  </div>
                </div>

                <div style={{ display: 'flex', gap: 10, justifyContent: 'space-between' }}>
                  <button onClick={() => setDocStep(1)} style={{ padding: '10px 20px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', backgroundColor: '#fff', cursor: 'pointer', fontSize: 14 }}>Back</button>
                  <button
                    onClick={async () => {
                      if (!docLabel.trim()) { toast('Please enter a label', 'error'); return; }
                      if (docReqs.length === 0) { toast('At least one requirement is needed', 'error'); return; }
                      // If already saved (user came back from Step 3), update instead of creating duplicate
                      if (docSavedReq) {
                        setDocBusy(true);
                        try {
                          await leaseComplianceApi.update(docSavedReq.id, {
                            label: docLabel.trim(),
                            counterparty_name: docCounterpartyName.trim() || null,
                            counterparty_email: docCounterpartyEmail.trim() || null,
                            requirements_json: JSON.stringify(docReqs),
                          });
                          setDocStep(3);
                          toast('Requirements updated!');
                          load();
                        } catch (err: any) {
                          toast(err.message || 'Failed to update', 'error');
                        } finally {
                          setDocBusy(false);
                        }
                        return;
                      }
                      setDocBusy(true);
                      try {
                        // Save requirements
                        const saved = await leaseComplianceApi.create({
                          label: docLabel.trim(),
                          role: 'requester',
                          counterparty_name: docCounterpartyName.trim() || null,
                          counterparty_email: docCounterpartyEmail.trim() || null,
                          property_address: docExtraction?.property_address || null,
                          lease_clause_text: docExtraction?.raw_summary || docPasteText.trim() || null,
                          requirements_json: JSON.stringify(docReqs),
                        });
                        setDocSavedReq(saved);
                        setDocStep(3);
                        toast('Requirements saved!');
                        load(); // refresh list in background
                      } catch (err: any) {
                        toast(err.message || 'Failed to save', 'error');
                      } finally {
                        setDocBusy(false);
                      }
                    }}
                    disabled={docBusy}
                    style={{ padding: '10px 20px', backgroundColor: 'var(--color-primary)', color: '#fff', border: 'none', borderRadius: 'var(--radius-md)', cursor: docBusy ? 'wait' : 'pointer', fontSize: 14, fontWeight: 600, opacity: docBusy ? 0.7 : 1 }}
                  >
                    {docBusy ? 'Saving...' : 'Save & Compare'}
                  </button>
                </div>
              </div>
            )}

            {/* ── Step 3: Compare against evidence ── */}
            {docStep === 3 && docSavedReq && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <p style={{ fontSize: 13, color: 'var(--color-text-secondary)', margin: 0 }}>
                  Now compare your requirements against evidence. Upload a COI or select an existing policy.
                </p>

                {/* Upload COI */}
                <div style={{ padding: 16, backgroundColor: '#f0f9ff', border: '1px dashed #93c5fd', borderRadius: 'var(--radius-md)' }}>
                  <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: 'var(--color-text)', marginBottom: 8 }}>Upload COI or Insurance Document (PDF)</label>
                  <input ref={docCoiRef} type="file" accept=".pdf" style={{ fontSize: 13, width: '100%' }} />
                  <button
                    onClick={async () => {
                      const file = docCoiRef.current?.files?.[0];
                      if (!file) { toast('Please select a PDF file', 'error'); return; }
                      setDocBusy(true);
                      try {
                        trackFeatureUse('compare_documents_check_coi');
                        const res = await leaseComplianceApi.checkDocument(docSavedReq.id, file);
                        // Poll for results
                        let attempts = 0;
                        docPollCancelled.current = false;
                        const poll = async (): Promise<void> => {
                          if (docPollCancelled.current) { setDocBusy(false); return; }
                          const status = await leaseComplianceApi.pollCheckStatus(res.id);
                          if (status.status === 'complete' && status.results) {
                            setDocResults(status.results);
                            setDocResultCounts({ pass: status.pass_count || 0, fail: status.fail_count || 0, unclear: status.unclear_count || 0 });
                            setDocStep(4);
                            setDocBusy(false);
                            load();
                            return;
                          } else if (status.status === 'error') {
                            toast(status.error || 'Comparison failed', 'error');
                            setDocBusy(false);
                            return;
                          }
                          attempts++;
                          if (attempts > 60) { toast('Comparison timed out', 'error'); setDocBusy(false); return; }
                          await new Promise(r => setTimeout(r, 2000));
                          return poll();
                        };
                        await poll();
                      } catch (err: any) {
                        toast(err.message || 'Comparison failed', 'error');
                        setDocBusy(false);
                      }
                    }}
                    disabled={docBusy}
                    style={{ marginTop: 10, padding: '8px 16px', backgroundColor: '#2563eb', color: '#fff', border: 'none', borderRadius: 'var(--radius-md)', cursor: docBusy ? 'wait' : 'pointer', fontSize: 13, fontWeight: 600, opacity: docBusy ? 0.7 : 1 }}
                  >
                    {docBusy ? 'Comparing...' : 'Upload & Compare'}
                  </button>
                </div>

                {/* Or compare against existing policies */}
                {policies.filter(p => p.status === 'active').length > 0 && (
                  <>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '4px 0' }}>
                      <div style={{ flex: 1, height: 1, backgroundColor: 'var(--color-border)' }} />
                      <span style={{ fontSize: 11, color: 'var(--color-text-muted)', fontWeight: 600 }}>OR COMPARE AGAINST POLICY</span>
                      <div style={{ flex: 1, height: 1, backgroundColor: 'var(--color-border)' }} />
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 180, overflowY: 'auto' }}>
                      {policies.filter(p => p.status === 'active').map(p => (
                        <button
                          key={p.id}
                          disabled={docBusy}
                          onClick={async () => {
                            setDocBusy(true);
                            try {
                              trackFeatureUse('compare_documents_check_policy');
                              const res = await leaseComplianceApi.runCheck(docSavedReq.id, 'policy', { policyId: p.id });
                              const results: ComplianceResultItem[] = res.results || (res.results_json ? JSON.parse(res.results_json) : []);
                              setDocResults(results);
                              setDocResultCounts({ pass: res.pass_count, fail: res.fail_count, unclear: res.unclear_count });
                              setDocStep(4);
                              load();
                            } catch (err: any) {
                              toast(err.message || 'Comparison failed', 'error');
                            } finally {
                              setDocBusy(false);
                            }
                          }}
                          style={{ padding: '10px 14px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', backgroundColor: '#fff', cursor: docBusy ? 'wait' : 'pointer', textAlign: 'left', opacity: docBusy ? 0.7 : 1 }}
                        >
                          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-text)' }}>{p.nickname || p.carrier || 'Unnamed Policy'}</div>
                          <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 2 }}>{p.policy_type.replace(/_/g, ' ')}{p.business_name ? ` \u2022 ${p.business_name}` : ''}</div>
                        </button>
                      ))}
                    </div>
                  </>
                )}

                <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
                  <button onClick={() => setDocStep(2)} disabled={docBusy} style={{ padding: '10px 20px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', backgroundColor: '#fff', cursor: 'pointer', fontSize: 14 }}>Back</button>
                </div>
              </div>
            )}

            {/* ── Step 4: Results ── */}
            {docStep === 4 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                {/* Verdict banner */}
                {(() => {
                  let verdict = 'Compliant';
                  let verdictColor = '#166534';
                  let verdictBg = '#dcfce7';
                  if (docResultCounts.fail > 0 && docResultCounts.pass > 0) {
                    verdict = 'Partially Compliant'; verdictColor = '#92400e'; verdictBg = '#fef3c7';
                  } else if (docResultCounts.fail > 0) {
                    verdict = 'Non-Compliant'; verdictColor = '#991b1b'; verdictBg = '#fee2e2';
                  } else if (docResultCounts.unclear > 0) {
                    verdict = 'Needs Review'; verdictColor = '#92400e'; verdictBg = '#fef3c7';
                  }
                  return (
                    <div style={{ padding: '14px 16px', borderRadius: 'var(--radius-md)', backgroundColor: verdictBg, textAlign: 'center' }}>
                      <div style={{ fontSize: 18, fontWeight: 700, color: verdictColor }}>{verdict}</div>
                      <div style={{ fontSize: 13, color: verdictColor, marginTop: 4 }}>
                        {docResultCounts.pass} passed &middot; {docResultCounts.fail} failed &middot; {docResultCounts.unclear} unclear
                      </div>
                    </div>
                  );
                })()}

                {/* Results list */}
                <div style={{ maxHeight: 280, overflowY: 'auto', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)' }}>
                  {docResults.map((r, i) => (
                    <div key={i} style={{ padding: '10px 14px', borderBottom: i < docResults.length - 1 ? '1px solid var(--color-border)' : 'none', display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                      <span style={{ fontSize: 16, flexShrink: 0, marginTop: 1 }}>
                        {r.status === 'pass' ? '\u2705' : r.status === 'fail' ? '\u274C' : '\u2753'}
                      </span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-text)' }}>{r.requirement_label}</div>
                        <div style={{ fontSize: 12, color: 'var(--color-text-secondary)', marginTop: 2 }}>{r.note}</div>
                      </div>
                    </div>
                  ))}
                </div>

                {/* Actions */}
                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                  {docSavedReq && (
                    <button
                      onClick={() => {
                        trackClick('doc_flow_request_coi');
                        setSendEmail(docCounterpartyEmail || '');
                        setSendName(docCounterpartyName || '');
                        setSendNotes('');
                        setSendMode('request');
                        // Temporarily set viewingLease for the send modal to use
                        setViewingLease(docSavedReq);
                        setShowSendToCounterparty(true);
                      }}
                      style={{ padding: '8px 16px', backgroundColor: 'var(--color-primary)', color: '#fff', border: 'none', borderRadius: 'var(--radius-sm)', cursor: 'pointer', fontSize: 13, fontWeight: 600 }}
                    >
                      Request COI
                    </button>
                  )}
                  {docResultCounts.fail > 0 && docSavedReq && (
                    <button
                      onClick={() => {
                        trackClick('doc_flow_send_deficiency');
                        setSendEmail(docCounterpartyEmail || '');
                        setSendName(docCounterpartyName || '');
                        setSendNotes('');
                        setSendMode('deficiency');
                        setViewingLease(docSavedReq);
                        setLeaseDetailResults(docResults);
                        setShowSendToCounterparty(true);
                      }}
                      style={{ padding: '8px 16px', backgroundColor: '#dc2626', color: '#fff', border: 'none', borderRadius: 'var(--radius-sm)', cursor: 'pointer', fontSize: 13, fontWeight: 600 }}
                    >
                      Send Deficiency Notice
                    </button>
                  )}
                  <button
                    onClick={() => { setDocResults([]); setDocResultCounts({ pass: 0, fail: 0, unclear: 0 }); setDocStep(3); }}
                    style={{ padding: '8px 16px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', backgroundColor: '#fff', cursor: 'pointer', fontSize: 13 }}
                  >
                    Compare Again
                  </button>
                  <button
                    onClick={() => { setShowDocFlow(false); resetDocFlow(); }}
                    style={{ padding: '8px 16px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', backgroundColor: '#fff', cursor: 'pointer', fontSize: 13, fontWeight: 600 }}
                  >
                    Done
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Delete Requirement Confirmation ── */}
      <ConfirmDialog
        open={deleteReqConfirm != null}
        title="Delete Requirement"
        message="Are you sure you want to delete this requirement set and all its compliance checks? This cannot be undone."
        confirmLabel="Delete"
        danger
        onConfirm={async () => {
          if (deleteReqConfirm == null) return;
          try {
            await leaseComplianceApi.remove(deleteReqConfirm);
            toast('Requirement deleted', 'success');
            setDeleteReqConfirm(null);
            await load();
          } catch (err: any) {
            toast(err.message || 'Failed to delete', 'error');
          }
        }}
        onCancel={() => setDeleteReqConfirm(null)}
      />

      {/* ── Add/Edit Certificate Form Modal ── */}
      {showForm && (
        <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.5)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
          <div style={{ backgroundColor: '#fff', borderRadius: 'var(--radius-lg)', padding: 20, maxWidth: 560, width: '100%', maxHeight: '90vh', overflowY: 'auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>
                {editingId ? 'Edit Certificate' : 'Add Certificate'}
              </h2>
              <button onClick={() => { trackClick('cert_form_close'); resetForm(); }} style={{ background: 'none', border: 'none', fontSize: 22, cursor: 'pointer', color: 'var(--color-text-muted)', padding: '0 4px', lineHeight: 1 }} aria-label="Close">&times;</button>
            </div>

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

            {/* Direction toggle — plain language */}
            <div style={{ marginBottom: 16 }}>
              <label style={labelStyle}>What are you doing?</label>
              <div style={{ display: 'flex', gap: 8 }}>
                {([
                  { value: 'issued' as const, label: 'Sharing my insurance proof', desc: 'Someone asked me to prove I have coverage' },
                  { value: 'received' as const, label: 'I received their proof', desc: 'Someone sent me proof they have coverage' },
                ] as const).map(d => (
                  <button
                    key={d.value}
                    onClick={() => { trackClick('cert_form_direction', { value: d.value }); setForm(f => ({ ...f, direction: d.value })); }}
                    style={{
                      flex: 1, padding: '10px 12px', borderRadius: 'var(--radius-sm)', cursor: 'pointer', textAlign: 'left',
                      border: form.direction === d.value ? '2px solid var(--color-primary)' : '1px solid var(--color-border)',
                      backgroundColor: form.direction === d.value ? '#eff6ff' : '#fff',
                    }}
                  >
                    <div style={{ fontSize: 13, fontWeight: 600, color: form.direction === d.value ? 'var(--color-primary)' : 'var(--color-text)' }}>{d.label}</div>
                    <div style={{ fontSize: 11, color: 'var(--color-text-secondary)', marginTop: 2 }}>{d.desc}</div>
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

            {/* Who is the other party */}
            <div className="form-grid-2" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
              <div>
                <label style={labelStyle}>{form.direction === 'issued' ? 'Who requested this? *' : 'Who provided this? *'}</label>
                <input style={inputStyle} value={form.counterparty_name} onChange={e => setForm(f => ({ ...f, counterparty_name: e.target.value }))} placeholder={form.direction === 'issued' ? 'e.g. ABC Property Management' : 'e.g. John Smith Contracting'} />
              </div>
              <div>
                <label style={labelStyle}>Their role</label>
                <select style={inputStyle} value={form.counterparty_type} onChange={e => setForm(f => ({ ...f, counterparty_type: e.target.value }))}>
                  {COUNTERPARTY_TYPES.map(ct => <option key={ct.value} value={ct.value}>{ct.label}</option>)}
                </select>
              </div>
            </div>

            <div style={{ marginBottom: 12 }}>
              <label style={labelStyle}>Their email</label>
              <input style={inputStyle} type="email" value={form.counterparty_email || ''} onChange={e => setForm(f => ({ ...f, counterparty_email: e.target.value || null }))} placeholder="Optional — for expiration reminders" />
            </div>

            {/* Their insurance details (for received) */}
            {form.direction === 'received' && (
              <div className="form-grid-2" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
                <div>
                  <label style={labelStyle}>Their insurance company</label>
                  <input style={inputStyle} value={form.carrier || ''} onChange={e => setForm(f => ({ ...f, carrier: e.target.value || null }))} placeholder="e.g. State Farm" />
                </div>
                <div>
                  <label style={labelStyle}>Their policy number</label>
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
                <label style={labelStyle}>Minimum coverage you require ($)</label>
                <input style={inputStyle} type="number" value={form.minimum_coverage != null ? form.minimum_coverage / 100 : ''} onChange={e => setForm(f => ({ ...f, minimum_coverage: e.target.value ? Math.round(Number(e.target.value) * 100) : null }))} placeholder="e.g. 1000000" />
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
                  {vc.direction === 'issued' ? 'I shared my proof' : 'I received their proof'}
                </span>
                <span style={{
                  padding: '3px 12px', borderRadius: 12, fontSize: 12, fontWeight: 600,
                  backgroundColor: vcSc.bg, color: vcSc.fg,
                }}>
                  {vc.status}
                </span>
              </div>

              {/* View uploaded PDF */}
              {vc.has_document && (
                <button
                  onClick={async () => {
                    trackClick('cert_detail_view_pdf', { id: vc.id });
                    try {
                      const blob = await certificatesApi.downloadDocument(vc.id);
                      const url = URL.createObjectURL(blob);
                      window.open(url, '_blank');
                    } catch {
                      toast('Document not available', 'error');
                    }
                  }}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '12px 16px',
                    marginBottom: 20, borderRadius: 'var(--radius-md)', border: '1px solid #bae6fd',
                    backgroundColor: '#f0f9ff', cursor: 'pointer', fontSize: 14, fontWeight: 600,
                    color: '#0c4a6e',
                  }}
                >
                  <span style={{ fontSize: 18 }}>&#128196;</span>
                  View Uploaded Certificate (PDF)
                </button>
              )}

              {/* All fields — always shown with placeholders */}
              {(() => {
                const dim = 'var(--color-text-muted)';
                const na = <span style={{ color: dim, fontStyle: 'italic' }}>Not provided</span>;
                return (
                  <>
                    <div className="form-grid-2" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
                      <div>
                        <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text-secondary)', marginBottom: 4 }}>{vc.direction === 'issued' ? 'Requested by' : 'Provided by'}</div>
                        <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--color-text)' }}>{vc.counterparty_name || na}</div>
                      </div>
                      <div>
                        <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text-secondary)', marginBottom: 4 }}>Their Role</div>
                        <div style={{ fontSize: 15, color: 'var(--color-text)' }}>{vcCtLabel}</div>
                      </div>
                    </div>

                    <div style={{ marginBottom: 16 }}>
                      <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text-secondary)', marginBottom: 4 }}>Email</div>
                      <div style={{ fontSize: 14, color: vc.counterparty_email ? 'var(--color-text)' : dim }}>{vc.counterparty_email || na}</div>
                    </div>

                    {/* Linked Policy */}
                    {vcLinkedPolicy && (
                      <div style={{ marginBottom: 16, padding: 12, borderRadius: 'var(--radius-sm)', backgroundColor: '#f0fdf4', border: '1px solid #bbf7d0' }}>
                        <div style={{ fontSize: 12, fontWeight: 600, color: '#166534', marginBottom: 4 }}>Linked to Policy</div>
                        <div style={{ fontSize: 14, color: 'var(--color-text)' }}>{vcLinkedPolicy.nickname || vcLinkedPolicy.carrier} &mdash; {vcLinkedPolicy.policy_type}</div>
                      </div>
                    )}

                    <div className="form-grid-2" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
                      <div>
                        <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text-secondary)', marginBottom: 4 }}>{vc.direction === 'received' ? 'Their Insurance Company' : 'Carrier'}</div>
                        <div style={{ fontSize: 14, color: vc.carrier ? 'var(--color-text)' : dim }}>{vc.carrier || na}</div>
                      </div>
                      <div>
                        <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text-secondary)', marginBottom: 4 }}>{vc.direction === 'received' ? 'Their Policy #' : 'Policy #'}</div>
                        <div style={{ fontSize: 14, color: vc.policy_number ? 'var(--color-text)' : dim }}>{vc.policy_number || na}</div>
                      </div>
                    </div>

                    <div style={{ marginBottom: 16 }}>
                      <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text-secondary)', marginBottom: 6 }}>Coverage Types</div>
                      {vc.coverage_types ? (
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                          {vc.coverage_types.split(',').map(ct => ct.trim()).filter(Boolean).map(ct => (
                            <span key={ct} style={{ padding: '4px 12px', borderRadius: 12, fontSize: 12, fontWeight: 600, border: '1px solid var(--color-primary)', backgroundColor: 'var(--color-primary)', color: '#fff' }}>{ct}</span>
                          ))}
                        </div>
                      ) : <div style={{ color: dim, fontStyle: 'italic', fontSize: 14 }}>Not provided</div>}
                    </div>

                    <div className="mobile-grid-1" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16, marginBottom: 16 }}>
                      <div>
                        <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text-secondary)', marginBottom: 4 }}>Coverage Amount</div>
                        <div style={{ fontSize: 15, fontWeight: 600, color: vc.coverage_amount != null ? 'var(--color-text)' : dim }}>{vc.coverage_amount != null ? `$${(vc.coverage_amount / 100).toLocaleString()}` : na}</div>
                      </div>
                      <div>
                        <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text-secondary)', marginBottom: 4 }}>Effective Date</div>
                        <div style={{ fontSize: 14, color: vc.effective_date ? 'var(--color-text)' : dim }}>{vc.effective_date || na}</div>
                      </div>
                      <div>
                        <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text-secondary)', marginBottom: 4 }}>Expiration Date</div>
                        <div style={{ fontSize: 14, color: vc.expiration_date ? 'var(--color-text)' : dim }}>{vc.expiration_date || na}</div>
                      </div>
                    </div>

                    {vc.direction === 'received' && (
                      <div style={{ marginBottom: 16 }}>
                        <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text-secondary)', marginBottom: 4 }}>Minimum Required Coverage</div>
                        <div style={{ fontSize: 14, color: vc.minimum_coverage != null ? 'var(--color-text)' : dim }}>{vc.minimum_coverage != null ? `$${(vc.minimum_coverage / 100).toLocaleString()}` : na}</div>
                        {vc.minimum_coverage != null && vc.coverage_amount != null && (
                          <div style={{ marginTop: 6, padding: '4px 10px', borderRadius: 'var(--radius-sm)', fontSize: 12, fontWeight: 600, display: 'inline-block', backgroundColor: vc.coverage_amount >= vc.minimum_coverage ? '#dcfce7' : '#fee2e2', color: vc.coverage_amount >= vc.minimum_coverage ? '#166534' : '#991b1b' }}>
                            {vc.coverage_amount >= vc.minimum_coverage ? 'Meets requirement' : 'Below requirement'}
                          </div>
                        )}
                      </div>
                    )}

                    <div style={{ display: 'flex', gap: 20, marginBottom: 16, flexWrap: 'wrap' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
                        <span style={{ color: vc.additional_insured ? '#166534' : dim, fontSize: 16 }}>{vc.additional_insured ? '\u2713' : '\u2717'}</span>
                        <span style={{ color: vc.additional_insured ? '#166534' : dim, fontWeight: vc.additional_insured ? 600 : 400 }}>Additional Insured</span>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
                        <span style={{ color: vc.waiver_of_subrogation ? '#166534' : dim, fontSize: 16 }}>{vc.waiver_of_subrogation ? '\u2713' : '\u2717'}</span>
                        <span style={{ color: vc.waiver_of_subrogation ? '#166534' : dim, fontWeight: vc.waiver_of_subrogation ? 600 : 400 }}>Waiver of Subrogation</span>
                      </div>
                    </div>

                    <div style={{ marginBottom: 20 }}>
                      <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text-secondary)', marginBottom: 4 }}>Notes</div>
                      <div style={{ fontSize: 14, color: vc.notes ? 'var(--color-text)' : dim, lineHeight: 1.6, fontStyle: vc.notes ? 'italic' : 'normal' }}>{vc.notes || na}</div>
                    </div>
                  </>
                );
              })()}

              {/* Check against requirements — always show for received certs linked to a policy */}
              {vc.policy_id && (
                <div style={{
                  marginBottom: 20, padding: '12px 16px', borderRadius: 'var(--radius-md)',
                  backgroundColor: '#f0f9ff', border: '1px solid #bae6fd',
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap',
                }}>
                  <div>
                    <div style={{ fontSize: 13, color: '#0c4a6e', fontWeight: 600 }}>
                      {matchingLeaseReqs.length > 0 ? 'Check this COI against lease requirements' : 'Run a compliance check on this certificate'}
                    </div>
                    <div style={{ fontSize: 11, color: '#6b7280', marginTop: 2 }}>
                      {matchingLeaseReqs.length > 0
                        ? `${matchingLeaseReqs.length} requirement${matchingLeaseReqs.length !== 1 ? 's' : ''} defined for this policy`
                        : 'Define requirements on the policy page, then verify this certificate'}
                    </div>
                  </div>
                  <button
                    onClick={() => {
                      trackClick('cert_check_against_lease', { cert_id: vc.id, policy_id: vc.policy_id });
                      setViewingCert(null);
                      router.push(`/policies/${vc.policy_id}?from=certificates`);
                    }}
                    style={{
                      padding: '6px 14px', fontSize: 12, fontWeight: 600,
                      backgroundColor: 'var(--color-primary)', color: '#fff',
                      border: 'none', borderRadius: 'var(--radius-sm)', cursor: 'pointer',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {matchingLeaseReqs.length > 0 ? 'Run Check' : 'Go to Policy'}
                  </button>
                </div>
              )}

              {/* Actions */}
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, borderTop: '1px solid var(--color-border)', paddingTop: 16, flexWrap: 'wrap' }}>
                <button
                  onClick={() => {
                    trackClick('cert_detail_delete', { id: vc.id });
                    setViewingCert(null);
                    setDeleteConfirm(vc.id);
                  }}
                  style={{ padding: '8px 20px', border: '1px solid #fecaca', borderRadius: 'var(--radius-sm)', backgroundColor: '#fff', color: 'var(--color-danger)', cursor: 'pointer', fontSize: 14 }}
                >
                  Delete
                </button>
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
        const reqItems: LeaseRequirementItem[] = (() => { try { return JSON.parse(req.requirements_json); } catch { return []; } })();
        const isDocCheck = req.role === 'requester';
        const submittedTenant = req.tenants?.find(t => t.submitted_at && t.has_document);
        // Fallback: use the check loaded by openLeaseDetail if tenants array didn't match
        const coiCheckId = submittedTenant?.check_id ?? (leaseDetailHasDoc ? leaseDetailCheckId : null);

        return (
          <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.5)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
            <div style={{ backgroundColor: '#fff', borderRadius: 'var(--radius-lg)', padding: 20, maxWidth: 620, width: '100%', maxHeight: '90vh', overflowY: 'auto' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
                <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>{isDocCheck ? 'Document Check Details' : 'Lease Check Details'}</h2>
                <button onClick={() => { trackClick('lease_detail_close'); setViewingLease(null); }} style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: 'var(--color-text-muted)', padding: 0, lineHeight: 1 }}>&times;</button>
              </div>

              {/* Verdict banner */}
              <div style={{ padding: '12px 16px', borderRadius: 'var(--radius-md)', marginBottom: 16, backgroundColor: verdictBg, textAlign: 'center' }}>
                <div style={{ fontSize: 16, fontWeight: 700, color: verdictColor }}>{verdict}</div>
                {lc && (
                  <div style={{ fontSize: 12, color: verdictColor, marginTop: 4 }}>
                    {lc.pass_count} passed &middot; {lc.fail_count} failed &middot; {lc.unclear_count} unclear
                  </div>
                )}
              </div>

              {/* Info section */}
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 8, color: 'var(--color-text)' }}>{req.label}</div>
                <div className="form-grid-2" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  {req.counterparty_name && (
                    <div>
                      <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--color-text-secondary)' }}>Counterparty</div>
                      <div style={{ fontSize: 13 }}>{req.counterparty_name}</div>
                    </div>
                  )}
                  {req.property_address && (
                    <div>
                      <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--color-text-secondary)' }}>Property / Reference</div>
                      <div style={{ fontSize: 13 }}>{req.property_address}</div>
                    </div>
                  )}
                  {req.counterparty_email && (
                    <div>
                      <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--color-text-secondary)' }}>Email</div>
                      <div style={{ fontSize: 13 }}>{req.counterparty_email}</div>
                    </div>
                  )}
                </div>
              </div>

              {/* View Documents */}
              {(req.has_source_doc || coiCheckId) && (
                <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
                  {req.has_source_doc && (
                    <button
                      onClick={async () => {
                        trackClick('lease_detail_view_source_doc', { id: req.id });
                        try {
                          const blob = await leaseComplianceApi.downloadSourceDocument(req.id);
                          window.open(URL.createObjectURL(blob), '_blank');
                        } catch { toast('Document not available', 'error'); }
                      }}
                      style={{ padding: '8px 14px', backgroundColor: '#f0f9ff', border: '1px solid #bae6fd', borderRadius: 'var(--radius-sm)', cursor: 'pointer', fontSize: 13, fontWeight: 600, color: '#0c4a6e' }}
                    >
                      View Requirements Doc{req.source_doc_name ? ` (${req.source_doc_name})` : ''}
                    </button>
                  )}
                  {coiCheckId && (
                    <button
                      onClick={async () => {
                        trackClick('lease_detail_view_coi', { checkId: coiCheckId });
                        try {
                          const blob = await leaseComplianceApi.downloadCoiDocument(coiCheckId);
                          window.open(URL.createObjectURL(blob), '_blank');
                        } catch { toast('Document not available', 'error'); }
                      }}
                      style={{ padding: '8px 14px', backgroundColor: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 'var(--radius-sm)', cursor: 'pointer', fontSize: 13, fontWeight: 600, color: '#166534' }}
                    >
                      View Uploaded COI
                    </button>
                  )}
                </div>
              )}

              {/* Requirements list */}
              {reqItems.length > 0 && (
                <div style={{ marginBottom: 16 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--color-text)', marginBottom: 6 }}>
                    Requirements ({reqItems.length})
                  </div>
                  <div style={{ maxHeight: 140, overflowY: 'auto', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', fontSize: 12 }}>
                    {reqItems.map((r, i) => (
                      <div key={i} style={{ padding: '6px 10px', borderBottom: i < reqItems.length - 1 ? '1px solid var(--color-border)' : 'none', color: 'var(--color-text)' }}>
                        {r.label}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Full compliance results */}
              {leaseDetailLoading && (
                <div style={{ textAlign: 'center', padding: 16, color: 'var(--color-text-muted)', fontSize: 13 }}>Loading results...</div>
              )}
              {leaseDetailResults.length > 0 && (
                <div style={{ marginBottom: 16 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--color-text)', marginBottom: 6 }}>
                    Compliance Results
                  </div>
                  <div style={{ maxHeight: 200, overflowY: 'auto', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)' }}>
                    {leaseDetailResults.map((r, i) => (
                      <div key={i} style={{ padding: '8px 12px', borderBottom: i < leaseDetailResults.length - 1 ? '1px solid var(--color-border)' : 'none', display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                        <span style={{ fontSize: 14, flexShrink: 0, marginTop: 1 }}>
                          {r.status === 'pass' ? '\u2705' : r.status === 'fail' ? '\u274C' : '\u2753'}
                        </span>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-text)' }}>{r.requirement_label}</div>
                          <div style={{ fontSize: 11, color: 'var(--color-text-secondary)', marginTop: 2 }}>{r.note}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Action buttons */}
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', borderTop: '1px solid var(--color-border)', paddingTop: 14 }}>
                {/* Send to counterparty — request their COI */}
                <button
                  onClick={() => {
                    trackClick('lease_detail_send_request', { id: req.id });
                    setSendEmail(req.counterparty_email || '');
                    setSendName(req.counterparty_name || '');
                    setSendNotes('');
                    setSendMode('request');
                    setShowSendToCounterparty(true);
                  }}
                  style={{ padding: '8px 14px', backgroundColor: 'var(--color-primary)', color: '#fff', border: 'none', borderRadius: 'var(--radius-sm)', fontWeight: 600, cursor: 'pointer', fontSize: 13 }}
                >
                  Request COI
                </button>
                {/* Send deficiency notice */}
                {lc && lc.fail_count > 0 && (
                  <button
                    onClick={() => {
                      trackClick('lease_detail_send_deficiency', { id: req.id });
                      setSendEmail(req.counterparty_email || '');
                      setSendName(req.counterparty_name || '');
                      setSendNotes('');
                      setSendMode('deficiency');
                      setShowSendToCounterparty(true);
                    }}
                    style={{ padding: '8px 14px', backgroundColor: '#dc2626', color: '#fff', border: 'none', borderRadius: 'var(--radius-sm)', fontWeight: 600, cursor: 'pointer', fontSize: 13 }}
                  >
                    Send Deficiency Notice
                  </button>
                )}
                {req.policy_id && (
                  <button onClick={() => { setViewingLease(null); router.push(`/policies/${req.policy_id}?from=certificates`); }}
                    style={{ padding: '8px 14px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', backgroundColor: '#fff', cursor: 'pointer', fontSize: 13 }}>
                    View Policy
                  </button>
                )}
                <button
                  onClick={() => { navigator.clipboard.writeText(`${window.location.origin}/lease-compliance/${req.access_code}`); toast('Public link copied'); }}
                  style={{ padding: '8px 14px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', backgroundColor: '#fff', cursor: 'pointer', fontSize: 13 }}>
                  Copy Link
                </button>
                <button
                  onClick={() => { setViewingLease(null); setDeleteReqConfirm(req.id); }}
                  style={{ padding: '8px 14px', border: '1px solid #fecaca', borderRadius: 'var(--radius-sm)', backgroundColor: '#fff', color: 'var(--color-danger)', cursor: 'pointer', fontSize: 13 }}>
                  Delete
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ── Send to Counterparty Modal ── */}
      {showSendToCounterparty && viewingLease && (
        <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.5)', zIndex: 1100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
          <div style={{ backgroundColor: '#fff', borderRadius: 'var(--radius-lg)', padding: 20, maxWidth: 460, width: '100%' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>
                {sendMode === 'request' ? 'Request Certificate of Insurance' : 'Send Deficiency Notice'}
              </h2>
              <button onClick={() => setShowSendToCounterparty(false)} style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: 'var(--color-text-muted)', padding: 0, lineHeight: 1 }}>&times;</button>
            </div>

            <p style={{ fontSize: 13, color: 'var(--color-text-secondary)', margin: '0 0 16px' }}>
              {sendMode === 'request'
                ? 'Send a link where the counterparty can upload their certificate of insurance for compliance verification.'
                : 'Notify the counterparty of specific compliance failures and request updated documentation.'}
            </p>

            <div style={{ marginBottom: 12 }}>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--color-text-secondary)', marginBottom: 4 }}>Recipient Email *</label>
              <input type="email" value={sendEmail} onChange={e => setSendEmail(e.target.value)} placeholder="email@example.com" style={{ width: '100%', padding: '8px 10px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', fontSize: 13, boxSizing: 'border-box' }} />
            </div>
            <div style={{ marginBottom: 12 }}>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--color-text-secondary)', marginBottom: 4 }}>Recipient Name</label>
              <input type="text" value={sendName} onChange={e => setSendName(e.target.value)} placeholder="e.g. John Smith" style={{ width: '100%', padding: '8px 10px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', fontSize: 13, boxSizing: 'border-box' }} />
            </div>
            <div style={{ marginBottom: 16 }}>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--color-text-secondary)', marginBottom: 4 }}>Notes (optional)</label>
              <textarea value={sendNotes} onChange={e => setSendNotes(e.target.value)} placeholder={sendMode === 'request' ? 'e.g. Please upload your COI by end of week.' : 'e.g. Please address the items listed below.'} style={{ width: '100%', padding: '8px 10px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', fontSize: 13, minHeight: 60, boxSizing: 'border-box', fontFamily: 'var(--font-sans)', resize: 'vertical' }} />
            </div>

            {sendMode === 'deficiency' && leaseDetailResults.filter(r => r.status === 'fail').length > 0 && (
              <div style={{ marginBottom: 16, padding: 10, backgroundColor: '#fee2e2', borderRadius: 'var(--radius-sm)', fontSize: 12 }}>
                <div style={{ fontWeight: 600, color: '#991b1b', marginBottom: 4 }}>Failed Items ({leaseDetailResults.filter(r => r.status === 'fail').length})</div>
                {leaseDetailResults.filter(r => r.status === 'fail').map((r, i) => (
                  <div key={i} style={{ color: '#991b1b', marginTop: 2 }}>&bull; {r.requirement_label}</div>
                ))}
              </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
              <button onClick={() => setShowSendToCounterparty(false)} style={{ padding: '8px 20px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', backgroundColor: '#fff', cursor: 'pointer', fontSize: 13 }}>Cancel</button>
              <button
                onClick={async () => {
                  if (!sendEmail.trim()) { toast('Email is required', 'error'); return; }
                  try {
                    if (sendMode === 'request') {
                      trackClick('send_coi_request', { req_id: viewingLease.id });
                      const res = await leaseComplianceApi.sendToTenant(viewingLease.id, sendEmail.trim(), sendName.trim() || undefined, sendNotes.trim() || undefined);
                      toast('COI request sent!');
                      if (res.public_url) {
                        navigator.clipboard.writeText(res.public_url);
                        toast('Public link also copied to clipboard');
                      }
                    } else {
                      trackClick('send_deficiency_notice', { req_id: viewingLease.id });
                      await leaseComplianceApi.sendDeficiencyNotice(viewingLease.id, sendEmail.trim(), sendName.trim() || undefined, sendNotes.trim() || undefined);
                      toast('Deficiency notice sent!');
                    }
                    setShowSendToCounterparty(false);
                  } catch (err: any) {
                    toast(err.message || 'Failed to send', 'error');
                  }
                }}
                style={{
                  padding: '8px 20px', border: 'none', borderRadius: 'var(--radius-sm)', fontWeight: 600, cursor: 'pointer', fontSize: 13,
                  backgroundColor: sendMode === 'request' ? 'var(--color-primary)' : '#dc2626', color: '#fff',
                }}
              >
                {sendMode === 'request' ? 'Send COI Request' : 'Send Notice'}
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
          onCancel={() => { trackClick('cert_delete_cancel'); setDeleteConfirm(null); }}
        />
      )}
    </div>
  );
}
