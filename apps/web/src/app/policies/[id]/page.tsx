'use client';

import { useState, useEffect, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useAuth } from '../../../../lib/auth';
import { API_BASE, policiesApi, contactsApi, documentsApi, coverageApi, policyDetailsApi, claimsApi, sharingApi, exportApi, premiumHistoryApi, exposuresApi, gapsApi, certificatesApi, leaseComplianceApi, Policy, Contact, DocMeta, ContactCreate, ExtractionData, CoverageItem, CoverageItemCreate, PolicyDetail, PolicyDetailCreate, PolicyUpdate, Claim, ClaimCreate, PolicyShareType, ShareCreate, PremiumHistoryEntry, Exposure, CoverageGap, Certificate, LeaseRequirement, LeaseRequirementItem, ComplianceResultItem, LeaseExtraction, BrokerEmail, checkFeatureAccess, parseUpgradeError } from '../../../../lib/api';
import { formatPhone, cleanPhone } from '../../../../lib/format';
import { useToast } from '../../components/Toast';
import { Skeleton } from '../../components/Skeleton';
import UpgradePrompt from '../../components/UpgradePrompt';
import BackButton from '../../components/BackButton';
import { POLICY_TYPES, POLICY_TYPE_CONFIG } from '../../constants';

const DOC_TYPES = [
  { value: 'policy', label: 'Full Policy' },
  { value: 'insurance_card', label: 'Insurance Card' },
  { value: 'endorsement', label: 'Endorsement' },
  { value: 'other', label: 'Other' },
];

const SUGGESTED_FIELDS: Record<string, string[]> = {
  auto: ['vehicle_1_description', 'vehicle_1_VIN', 'vehicle_2_description', 'vehicle_2_VIN', 'listed_drivers', 'garaging_address', 'usage_type', 'liability_limit'],
  home: ['year_built', 'square_footage', 'construction_type', 'roof_type', 'roof_age', 'stories', 'alarm_system', 'sprinkler_system', 'swimming_pool', 'replacement_cost'],
  renters: ['personal_property_limit', 'liability_limit', 'loss_of_use_limit', 'replacement_cost'],
  life: ['insured_name', 'beneficiary', 'face_value', 'term_length', 'cash_value'],
  disability: ['benefit_amount', 'benefit_period', 'elimination_period', 'own_occupation', 'residual_benefit'],
  flood: ['flood_zone', 'building_coverage', 'contents_coverage', 'elevated_structure', 'basement_coverage'],
  earthquake: ['dwelling_limit', 'personal_property_limit', 'deductible_percentage', 'loss_of_use_limit'],
  liability: ['underlying_policies', 'aggregate_limit', 'per_occurrence_limit'],
  umbrella: ['underlying_policies', 'aggregate_limit', 'per_occurrence_limit'],
  general_liability: ['aggregate_limit', 'per_occurrence_limit', 'products_completed_ops', 'personal_advertising_injury', 'damage_to_rented_premises', 'medical_payments'],
  professional_liability: ['per_claim_limit', 'aggregate_limit', 'retroactive_date', 'tail_coverage', 'covered_services'],
  commercial_property: ['building_limit', 'bpp_limit', 'business_income_limit', 'coinsurance_percentage', 'valuation_method', 'equipment_breakdown'],
  commercial_auto: ['vehicle_schedule', 'combined_single_limit', 'hired_auto', 'non_owned_auto', 'cargo_coverage'],
  cyber: ['first_party_limit', 'third_party_limit', 'ransomware_coverage', 'business_interruption', 'data_breach_response', 'social_engineering'],
  bop: ['building_limit', 'bpp_limit', 'liability_limit', 'business_income_limit'],
  workers_comp: ['business_name', 'classification_code', 'payroll_amount', 'experience_modifier', 'state'],
  directors_officers: ['per_claim_limit', 'aggregate_limit', 'side_a_coverage', 'entity_coverage', 'securities_claim'],
  epli: ['per_claim_limit', 'aggregate_limit', 'third_party_coverage', 'wage_hour_coverage', 'retroactive_date'],
  inland_marine: ['scheduled_equipment', 'blanket_limit', 'transit_coverage', 'installation_coverage'],
  health: ['plan_type', 'plan_tier', 'group_number', 'covered_members', 'premium_individual', 'premium_family', 'deductible_individual_in_network', 'deductible_family_in_network', 'oop_max_individual_in_network', 'oop_max_family_in_network', 'office_visit_copay', 'specialist_copay', 'er_copay', 'prescription_copay_generic', 'prescription_copay_preferred', 'coinsurance_in_network', 'network_name'],
  dental: ['plan_type', 'group_number', 'covered_members', 'premium_individual', 'premium_family', 'deductible_individual', 'deductible_family', 'annual_maximum', 'preventive_coverage', 'basic_coverage', 'major_coverage', 'orthodontia_coverage', 'network_name'],
  vision: ['plan_type', 'group_number', 'covered_members', 'premium_individual', 'premium_family', 'exam_copay', 'frames_allowance', 'contact_lens_allowance', 'exam_frequency', 'frames_frequency', 'network_name'],
};

export default function PolicyDetailPage() {
  const { id } = useParams();
  const policyId = Number(id);
  const { token, plan, logout } = useAuth();
  const router = useRouter();

  const [policy, setPolicy] = useState<Policy | null>(null);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [docs, setDocs] = useState<DocMeta[]>([]);
  const [coverageItems, setCoverageItems] = useState<CoverageItem[]>([]);
  const [details, setDetails] = useState<PolicyDetail[]>([]);
  const [showCoverageForm, setShowCoverageForm] = useState(false);
  const [coverageForm, setCoverageForm] = useState<CoverageItemCreate>({ item_type: 'inclusion', description: '', limit: '' });
  const [error, setError] = useState('');
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [extractingId, setExtractingId] = useState<number | null>(null);
  const [docType, setDocType] = useState('policy');
  const fileRef = useRef<HTMLInputElement>(null);

  const [showIdCard, setShowIdCard] = useState(false);
  const [showDocHistory, setShowDocHistory] = useState(false);
  const idCardRef = useRef<HTMLDivElement>(null);

  // Edit mode
  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState<PolicyUpdate>({});

  // Contact form
  const [showContactForm, setShowContactForm] = useState(false);
  const [contactForm, setContactForm] = useState<ContactCreate>({ role: 'broker', name: '', company: '', phone: '', email: '', notes: '' });

  // Detail form
  const [showDetailForm, setShowDetailForm] = useState(false);
  const [detailForm, setDetailForm] = useState<PolicyDetailCreate>({ field_name: '', field_value: '' });

  // Claims
  const [claims, setClaims] = useState<Claim[]>([]);
  const [showClaimForm, setShowClaimForm] = useState(false);
  const [claimForm, setClaimForm] = useState<ClaimCreate>({ claim_number: '', status: 'open', date_filed: '', description: '' });
  const [claimExtracting, setClaimExtracting] = useState(false);
  const claimFileRef = useRef<HTMLInputElement>(null);

  // Sharing
  const [shares, setShares] = useState<PolicyShareType[]>([]);
  const [showShareForm, setShowShareForm] = useState(false);
  const [shareForm, setShareForm] = useState<ShareCreate>({ shared_with_email: '', permission: 'view', role_label: null, expires_at: null });
  const { toast } = useToast();

  // Deductible tracking
  const [editingDeductible, setEditingDeductible] = useState(false);
  const [deductibleForm, setDeductibleForm] = useState<{ type: string; period_start: string; applied: number }>({ type: 'annual', period_start: '', applied: 0 });

  // Coverage summary expansion
  const [showAllInclusions, setShowAllInclusions] = useState(false);
  const [showAllExclusions, setShowAllExclusions] = useState(false);

  // Premium history
  const [premiumHistory, setPremiumHistory] = useState<PremiumHistoryEntry[]>([]);
  const [premiumHistoryChange, setPremiumHistoryChange] = useState<number>(0);
  const [showAddPremiumHistory, setShowAddPremiumHistory] = useState(false);
  const [premiumHistoryForm, setPremiumHistoryForm] = useState({ amount: 0, effective_date: '' });

  // Exposures
  const [exposures, setExposures] = useState<Exposure[]>([]);
  const [policyGaps, setPolicyGaps] = useState<CoverageGap[]>([]);
  const [policyCertificates, setPolicyCertificates] = useState<Certificate[]>([]);
  const [viewingPolicyCert, setViewingPolicyCert] = useState<Certificate | null>(null);

  // Lease Check
  const [leaseReqs, setLeaseReqs] = useState<LeaseRequirement[]>([]);
  const [leaseView, setLeaseView] = useState<'list' | 'create' | 'results'>('list');
  const [leaseCreateStep, setLeaseCreateStep] = useState(1);
  const [leaseClauseText, setLeaseClauseText] = useState('');
  const [leaseExtracting, setLeaseExtracting] = useState(false);
  const [leaseExtraction, setLeaseExtraction] = useState<LeaseExtraction | null>(null);
  const [leaseEditableReqs, setLeaseEditableReqs] = useState<LeaseRequirementItem[]>([]);
  const [leaseFormLabel, setLeaseFormLabel] = useState('');
  const [leaseFormRole, setLeaseFormRole] = useState<'tenant' | 'landlord'>('tenant');
  const [leaseFormPropertyAddress, setLeaseFormPropertyAddress] = useState('');
  const [leaseFormCounterpartyName, setLeaseFormCounterpartyName] = useState('');
  const [leaseFormCounterpartyEmail, setLeaseFormCounterpartyEmail] = useState('');
  const [leaseSaving, setLeaseSaving] = useState(false);
  const [leaseActiveReqId, setLeaseActiveReqId] = useState<number | null>(null);
  const [leaseResults, setLeaseResults] = useState<ComplianceResultItem[]>([]);
  const [leaseCheckCounts, setLeaseCheckCounts] = useState({ pass: 0, fail: 0, unclear: 0 });
  const [leaseChecking, setLeaseChecking] = useState(false);
  const [leaseBrokerModal, setLeaseBrokerModal] = useState(false);
  const [leaseBrokerEmail, setLeaseBrokerEmail] = useState<BrokerEmail | null>(null);
  const [leaseLoadingBroker, setLeaseLoadingBroker] = useState(false);
  const [leaseShareModal, setLeaseShareModal] = useState(false);
  const [leaseShareReq, setLeaseShareReq] = useState<LeaseRequirement | null>(null);
  const [leaseCopiedLink, setLeaseCopiedLink] = useState(false);
  const [leaseDeleteConfirm, setLeaseDeleteConfirm] = useState<number | null>(null);
  const [leaseCheckedAgainst, setLeaseCheckedAgainst] = useState<string>(''); // description of what was checked
  const [leaseTenantEmail, setLeaseTenantEmail] = useState('');
  const [leaseTenantName, setLeaseTenantName] = useState('');
  const [leaseTenantNotes, setLeaseTenantNotes] = useState('');
  const [leaseSending, setLeaseSending] = useState(false);
  const leasePdfRef = useRef<HTMLInputElement>(null);

  // Claims quick-start
  const [copiedPolicyNumber, setCopiedPolicyNumber] = useState(false);

  // Permission: null/undefined = owner, "view" = view-only shared, "edit" = edit shared
  const isOwner = !policy?.permission;
  const isViewOnly = policy?.permission === 'view';
  const canEdit = isOwner || policy?.permission === 'edit';

  const toggleDetailForm = () => {
    if (!showDetailForm && availableSuggestions.length > 0) {
      setDetailForm({ field_name: availableSuggestions[0], field_value: '' });
    }
    setShowDetailForm(!showDetailForm);
  };

  // Extraction review modal
  const [reviewDocId, setReviewDocId] = useState<number | null>(null);
  const [reviewData, setReviewData] = useState<ExtractionData | null>(null);
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    if (showIdCard && idCardRef.current) {
      idCardRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, [showIdCard]);

  useEffect(() => {
    if (!token) { router.replace('/login'); return; }
    loadAll().then(() => {
      // Check if there's extraction data from the upload-first flow
      const stored = sessionStorage.getItem(`pv_extract_${policyId}`);
      if (stored) {
        sessionStorage.removeItem(`pv_extract_${policyId}`);
        try {
          const { docId, data } = JSON.parse(stored);
          setReviewDocId(docId);
          setReviewData(data);
        } catch {}
      }
    });
  }, [token, policyId]);

  const loadAll = async () => {
    try {
      const [p, c, d, cv, det, cl, sh, ph, exp, gapsResult, certs, leaseReqsResult] = await Promise.all([
        policiesApi.get(policyId),
        contactsApi.list(policyId),
        documentsApi.list(policyId),
        coverageApi.list(policyId),
        policyDetailsApi.list(policyId),
        claimsApi.list(policyId),
        sharingApi.listShares(policyId).catch(() => [] as PolicyShareType[]),
        premiumHistoryApi.list(policyId).catch(() => ({ history: [], total_change_pct: 0, entry_count: 0 })),
        exposuresApi.list().catch(() => [] as Exposure[]),
        gapsApi.forPolicy(policyId).catch(() => ({ gaps: [] as CoverageGap[], policy_id: policyId })),
        certificatesApi.list(undefined, policyId).catch(() => [] as Certificate[]),
        leaseComplianceApi.list(undefined, policyId).catch(() => [] as LeaseRequirement[]),
      ]);
      setPolicy(p);
      setContacts(c);
      setDocs(d);
      setCoverageItems(cv);
      setDetails(det);
      setClaims(cl);
      setShares(sh);
      setPremiumHistory(ph.history);
      setPremiumHistoryChange(ph.total_change_pct);
      setExposures(exp);
      setPolicyGaps(gapsResult.gaps || []);
      setPolicyCertificates(certs);
      setLeaseReqs(leaseReqsResult);
    } catch (err: any) {
      if (err.status === 401) { logout(); router.replace('/login'); return; }
      setError(err.message);
    }
  };

  const startEdit = () => {
    if (!policy) return;
    setEditForm({
      scope: policy.scope,
      policy_type: policy.policy_type,
      carrier: policy.carrier,
      policy_number: policy.policy_number,
      nickname: policy.nickname || '',
      business_name: policy.business_name || '',
      coverage_amount: policy.coverage_amount,
      deductible: policy.deductible,
      premium_amount: policy.premium_amount,
      renewal_date: policy.renewal_date,
      exposure_id: policy.exposure_id,
      status: policy.status || 'active',
    });
    setEditing(true);
  };

  const handleSaveEdit = async () => {
    setError('');
    try {
      const updated = await policiesApi.update(policyId, { ...editForm, nickname: editForm.nickname || null, business_name: editForm.scope === 'business' ? (editForm.business_name || null) : null });
      setPolicy(updated);
      setEditing(false);
      toast('Policy updated', 'success');
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleAddContact = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await contactsApi.create(policyId, contactForm);
      setShowContactForm(false);
      setContactForm({ role: 'broker', name: '', company: '', phone: '', email: '', notes: '' });
      const c = await contactsApi.list(policyId);
      setContacts(c);
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleDeleteContact = async (contactId: number) => {
    try {
      await contactsApi.remove(policyId, contactId);
      setContacts(prev => prev.filter(c => c.id !== contactId));
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleAddDetail = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await policyDetailsApi.create(policyId, detailForm);
      setShowDetailForm(false);
      setDetailForm({ field_name: '', field_value: '' });
      setDetails(await policyDetailsApi.list(policyId));
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleDeleteDetail = async (detailId: number) => {
    try {
      await policyDetailsApi.remove(policyId, detailId);
      setDetails(prev => prev.filter(d => d.id !== detailId));
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleDownload = async (docId: number) => {
    try {
      const { download_url } = await documentsApi.download(docId);
      window.open(download_url, '_blank');
    } catch (err: any) {
      setError(err.message);
    }
  };

  const ALLOWED_FILE_TYPES = ['application/pdf', 'image/png', 'image/jpeg', 'image/webp'];
  const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20 MB

  const handleUpload = async () => {
    const file = fileRef.current?.files?.[0];
    if (!file) return;
    if (!ALLOWED_FILE_TYPES.includes(file.type)) {
      toast('Only PDF and image files (PNG, JPG, WebP) are allowed.', 'error');
      return;
    }
    if (file.size > MAX_FILE_SIZE) {
      toast('File size must be under 20 MB.', 'error');
      return;
    }
    setUploading(true);
    setUploadProgress(0);
    setError('');
    try {
      const ct = file.type || 'application/octet-stream';
      const currentDocType = docType;
      const formData = new FormData();
      formData.append('file', file);
      formData.append('policy_id', String(policyId));
      formData.append('doc_type', docType);

      const document_id = await new Promise<number>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.upload.onprogress = (e) => { if (e.lengthComputable) setUploadProgress(Math.round((e.loaded / e.total) * 100)); };
        xhr.onload = () => {
          setUploadProgress(100);
          try {
            const res = JSON.parse(xhr.responseText);
            if (xhr.status >= 400) reject(new Error(res.detail || 'Upload failed'));
            else resolve(res.document_id);
          } catch { reject(new Error('Upload failed')); }
        };
        xhr.onerror = () => reject(new Error('Upload failed'));
        const token = localStorage.getItem('pv_token');
        xhr.open('POST', `${API_BASE}/files/direct-upload`);
        if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);
        xhr.send(formData);
      });

      if (fileRef.current) fileRef.current.value = '';
      setDocType('policy');

      const d = await documentsApi.list(policyId);
      setDocs(d);

      if (ct === 'application/pdf' && (currentDocType === 'policy' || currentDocType === 'endorsement')) {
        setUploading(false);
        setUploadProgress(null);
        try {
          await handleExtract(document_id);
        } catch {
          // Extraction unavailable (no API key) — user can extract later or fill manually
        }
        return;
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setUploading(false);
      setUploadProgress(null);
    }
  };

  const handleExtract = async (docId: number) => {
    setExtractingId(docId);
    setError('');
    try {
      const res = await documentsApi.extract(docId);
      setReviewDocId(res.document_id);
      setReviewData(res.extraction);
      const d = await documentsApi.list(policyId);
      setDocs(d);
    } catch (err: any) {
      const upgrade = parseUpgradeError(err);
      if (upgrade) {
        setError(upgrade.message);
      } else if (err.message?.includes('authentication') || err.message?.includes('api_key')) {
        // No API key configured — skip silently
      } else {
        setError(err.message);
      }
    } finally {
      setExtractingId(null);
    }
  };

  const handleConfirmExtraction = async () => {
    if (!reviewDocId || !reviewData) return;
    setConfirming(true);
    setError('');
    try {
      await documentsApi.confirmExtraction(reviewDocId, reviewData);
      setReviewDocId(null);
      setReviewData(null);
      await loadAll();
      toast('Extraction data saved', 'success');
    } catch (err: any) {
      setError(err.message);
    } finally {
      setConfirming(false);
    }
  };

  const handleDiscardExtraction = () => {
    setReviewDocId(null);
    setReviewData(null);
  };

  const updateReviewField = (field: string, value: any) => {
    if (!reviewData) return;
    setReviewData({ ...reviewData, [field]: value });
  };

  const updateReviewContact = (idx: number, field: string, value: string) => {
    if (!reviewData) return;
    const updated = [...reviewData.contacts];
    updated[idx] = { ...updated[idx], [field]: value };
    setReviewData({ ...reviewData, contacts: updated });
  };

  const removeReviewContact = (idx: number) => {
    if (!reviewData) return;
    setReviewData({ ...reviewData, contacts: reviewData.contacts.filter((_, i) => i !== idx) });
  };

  const suggestedFields = policy ? (SUGGESTED_FIELDS[policy.policy_type] || []) : [];
  const usedFieldNames = details.map(d => d.field_name);
  const availableSuggestions = suggestedFields.filter(f => !usedFieldNames.includes(f));

  if (!token) return null;
  if (!policy) return (
    <div style={{ padding: 24, maxWidth: 900, margin: '0 auto' }}>
      <BackButton href="/policies" label="Policy" parentLabel="Policies" />
      {error ? <div className="alert alert-error">{error}</div> : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <Skeleton width={200} height={28} />
          <Skeleton width={120} height={16} />
          <div className="card" style={{ padding: 20 }}>
            <Skeleton width="60%" height={16} style={{ marginBottom: 12 }} />
            <Skeleton width="80%" height={14} style={{ marginBottom: 8 }} />
            <Skeleton width="40%" height={14} />
          </div>
        </div>
      )}
    </div>
  );

  return (
    <div style={{ maxWidth: 960, margin: '0 auto', padding: 24, overflowX: 'hidden' }}>
      {/* Back Navigation */}
      <BackButton href="/policies" label={policy?.nickname || policy?.carrier || 'Policy'} parentLabel="Policies" />

      {error && <div className="alert alert-error">{error}</div>}

      {/* View-Only Banner for shared users */}
      {isViewOnly && (
        <div style={{ padding: '10px 16px', marginBottom: 16, backgroundColor: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 'var(--radius-md)', display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, color: '#1e40af' }}>
          <span style={{ fontSize: 16 }}>👁</span>
          <span><strong>View Only</strong> — This policy was shared with you in read-only mode.</span>
        </div>
      )}

      {/* Extraction Review Modal */}
      {reviewData && (
        <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <div style={{ backgroundColor: 'var(--color-surface)', borderRadius: 'var(--radius-lg)', padding: 32, width: 640, maxHeight: '90vh', overflow: 'auto', boxShadow: 'var(--shadow-lg)' }}>
            <h2 style={{ margin: '0 0 8px', fontSize: 20, fontWeight: 700 }}>Review Extracted Data</h2>
            <p style={{ margin: '0 0 20px', color: 'var(--color-text-secondary)', fontSize: 14 }}>Verify and edit the fields below before saving to the policy.</p>

            <div className="form-grid-2" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div>
                <label style={labelStyle}>Carrier</label>
                <input value={reviewData.carrier ?? ''} onChange={e => updateReviewField('carrier', e.target.value)} style={inputStyle} />
              </div>
              <div>
                <label style={labelStyle}>Policy Number</label>
                <input value={reviewData.policy_number ?? ''} onChange={e => updateReviewField('policy_number', e.target.value)} style={inputStyle} />
              </div>
              <div>
                <label style={labelStyle}>Policy Type</label>
                <select value={reviewData.policy_type ?? ''} onChange={e => updateReviewField('policy_type', e.target.value)} style={inputStyle}>
                  <option value="">--</option>
                  {POLICY_TYPES.map(t => <option key={t} value={t}>{POLICY_TYPE_CONFIG[t]?.icon} {POLICY_TYPE_CONFIG[t]?.label || t}</option>)}
                </select>
              </div>
              <div>
                <label style={labelStyle}>Scope</label>
                <select value={reviewData.scope ?? ''} onChange={e => updateReviewField('scope', e.target.value)} style={inputStyle}>
                  <option value="">--</option>
                  <option value="personal">Personal</option>
                  <option value="business">Business</option>
                </select>
              </div>
              <div>
                <label style={labelStyle}>Coverage Amount</label>
                <input type="number" value={reviewData.coverage_amount ?? ''} onChange={e => updateReviewField('coverage_amount', e.target.value ? Number(e.target.value) : null)} style={inputStyle} />
              </div>
              <div>
                <label style={labelStyle}>Deductible</label>
                <input type="number" value={reviewData.deductible ?? ''} onChange={e => updateReviewField('deductible', e.target.value ? Number(e.target.value) : null)} style={inputStyle} />
              </div>
              <div>
                <label style={labelStyle}>Premium Amount</label>
                <input type="number" value={reviewData.premium_amount ?? ''} onChange={e => updateReviewField('premium_amount', e.target.value ? Number(e.target.value) : null)} style={inputStyle} />
              </div>
              <div>
                <label style={labelStyle}>Renewal Date</label>
                <input type="date" value={reviewData.renewal_date ?? ''} onChange={e => updateReviewField('renewal_date', e.target.value || null)} style={inputStyle} />
              </div>
            </div>

            {/* Extracted Contacts */}
            {reviewData.contacts.length > 0 && (
              <div style={{ marginTop: 20 }}>
                <h3 style={{ margin: '0 0 12px', fontSize: 16 }}>Extracted Contacts</h3>
                {reviewData.contacts.map((c, i) => (
                  <div key={i} style={{ padding: 12, marginBottom: 8, backgroundColor: 'var(--color-bg)', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                      <span style={{ fontSize: 12, fontWeight: 600, textTransform: 'uppercase', color: '#666' }}>{c.role}</span>
                      <button onClick={() => removeReviewContact(i)} className="btn btn-danger">Remove</button>
                    </div>
                    <div className="form-grid-2" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                      <input placeholder="Name" value={c.name ?? ''} onChange={e => updateReviewContact(i, 'name', e.target.value)} style={inputStyleSm} />
                      <input placeholder="Company" value={c.company ?? ''} onChange={e => updateReviewContact(i, 'company', e.target.value)} style={inputStyleSm} />
                      <input placeholder="Phone" value={c.phone ?? ''} onChange={e => updateReviewContact(i, 'phone', e.target.value)} style={inputStyleSm} />
                      <input placeholder="Email" value={c.email ?? ''} onChange={e => updateReviewContact(i, 'email', e.target.value)} style={inputStyleSm} />
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Extracted Coverage Items */}
            {reviewData.coverage_items && reviewData.coverage_items.length > 0 && (
              <div style={{ marginTop: 20 }}>
                <h3 style={{ margin: '0 0 12px', fontSize: 16 }}>Extracted Inclusions &amp; Exclusions</h3>
                {reviewData.coverage_items.map((ci, i) => (
                  <div key={i} style={{ padding: 8, marginBottom: 4, backgroundColor: ci.item_type === 'inclusion' ? '#f0fdf4' : '#fef2f2', borderRadius: 4, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                      <span style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', color: ci.item_type === 'inclusion' ? '#166534' : '#991b1b', marginRight: 8 }}>{ci.item_type}</span>
                      <span style={{ fontSize: 13 }}>{ci.description}</span>
                      {ci.limit && <span style={{ marginLeft: 8, fontSize: 12, color: '#666' }}>({ci.limit})</span>}
                    </div>
                    <button onClick={() => { if (!reviewData) return; setReviewData({ ...reviewData, coverage_items: reviewData.coverage_items!.filter((_, j) => j !== i) }); }} className="btn btn-danger">Remove</button>
                  </div>
                ))}
              </div>
            )}

            {/* Extracted Details */}
            {reviewData.details && reviewData.details.length > 0 && (
              <div style={{ marginTop: 20 }}>
                <h3 style={{ margin: '0 0 12px', fontSize: 16 }}>Extracted Details</h3>
                {reviewData.details.map((d, i) => (
                  <div key={i} style={{ padding: 8, marginBottom: 4, backgroundColor: '#f5f3ff', borderRadius: 4, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
                    <div>
                      <span style={{ fontSize: 12, fontWeight: 600, color: '#555', marginRight: 8 }}>{d.field_name}:</span>
                      <span style={{ fontSize: 13 }}>{d.field_value}</span>
                    </div>
                    <button onClick={() => { if (!reviewData) return; setReviewData({ ...reviewData, details: reviewData.details!.filter((_, j) => j !== i) }); }} className="btn btn-danger">Remove</button>
                  </div>
                ))}
              </div>
            )}

            <div style={{ display: 'flex', gap: 12, marginTop: 24, justifyContent: 'flex-end' }}>
              <button onClick={handleDiscardExtraction} className="btn btn-outline" style={{ padding: '10px 20px' }}>
                Discard
              </button>
              <button onClick={handleConfirmExtraction} disabled={confirming} className="btn btn-accent" style={{ padding: '10px 20px', opacity: confirming ? 0.6 : 1 }}>
                {confirming ? 'Saving...' : 'Confirm & Save'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Policy header */}
      <div className="card" style={{ marginBottom: 32 }}>
        {!editing ? (
          <>
            <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 }}>
              <div style={{ minWidth: 0, flex: 1 }}>
                <h1 style={{ margin: '0 0 4px', fontSize: 22, fontWeight: 700, color: 'var(--color-primary)', overflowWrap: 'break-word' }}>
                  {policy.nickname || `${policy.carrier} - ${policy.policy_type}`}
                </h1>
                {policy.nickname && <p style={{ margin: '0 0 4px', color: 'var(--color-text-secondary)', fontSize: 15 }}>{policy.carrier} - {policy.policy_type}</p>}
                <p style={{ margin: '0 0 8px', color: 'var(--color-text-muted)', fontSize: 14 }}>Policy # <span style={{ fontFamily: 'monospace' }}>{policy.policy_number}</span></p>

                {/* Asset + Status tags */}
                <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                  {policy.exposure_name && (
                    <span style={{ padding: '2px 10px', borderRadius: 12, fontSize: 12, fontWeight: 600, backgroundColor: '#ede9fe', color: '#6d28d9' }}>
                      {policy.exposure_name}
                    </span>
                  )}
                  {policy.status && policy.status !== 'active' && (
                    <span style={{
                      padding: '2px 10px', borderRadius: 12, fontSize: 12, fontWeight: 600,
                      backgroundColor: policy.status === 'expired' ? 'var(--color-danger-bg)' : '#f3f4f6',
                      color: policy.status === 'expired' ? 'var(--color-danger)' : '#6b7280',
                    }}>
                      {policy.status.charAt(0).toUpperCase() + policy.status.slice(1)}
                    </span>
                  )}
                </div>

                {/* Sharing Status - Always Visible */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                  <div style={{
                    fontSize: 13,
                    color: shares.length > 0 ? 'var(--color-text-secondary)' : 'var(--color-text-muted)',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    minWidth: 0,
                    flexWrap: 'wrap',
                  }}>
                    {shares.length > 0 ? (
                      <>
                        <span style={{ fontSize: 14 }}>👥</span>
                        <span>
                          Shared with: {shares.map((s, i) => (
                            <span key={s.id}>
                              <strong>{s.shared_with_email.split('@')[0]}</strong>
                              <span style={{ color: 'var(--color-text-muted)', fontSize: 12 }}> ({s.permission})</span>
                              {i < shares.length - 1 ? ', ' : ''}
                            </span>
                          ))}
                        </span>
                      </>
                    ) : (
                      <>
                        <span style={{ fontSize: 14 }}>🔒</span>
                        <span>Private — only you have access</span>
                      </>
                    )}
                  </div>
                  {isOwner && checkFeatureAccess(plan || 'free', 'sharing').allowed && (
                    <button
                      onClick={() => setShowShareForm(!showShareForm)}
                      className="btn btn-outline"
                      style={{ padding: '4px 12px', fontSize: 12 }}
                    >
                      {showShareForm ? 'Cancel' : shares.length > 0 ? 'Manage Access' : 'Share'}
                    </button>
                  )}
                </div>
              </div>
              <div className="header-actions" style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <span className={`badge badge-${policy.scope}`}>{policy.scope}</span>
                <button onClick={() => router.push(`/chat?policy=${policyId}&carrier=${encodeURIComponent(policy.carrier)}`)} className="btn btn-outline">Ask About This Policy</button>
                <button onClick={() => setShowIdCard(!showIdCard)} className="btn btn-outline">{showIdCard ? 'Hide Card' : 'ID Card'}</button>
                <button onClick={() => exportApi.singlePolicy(policyId)} className="btn btn-outline">Export CSV</button>
                {canEdit && <button onClick={startEdit} className="btn btn-primary">Edit Policy</button>}
              </div>
            </div>

            {/* Last extracted timestamp */}
            {(() => {
              const extractedDoc = [...docs].filter(d => d.extraction_status === 'done').sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())[0];
              if (!extractedDoc) return null;
              const date = new Date(extractedDoc.created_at);
              const formatted = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
              const fileName = extractedDoc.filename || 'document';
              return (
                <div style={{ marginTop: 8, fontSize: 12, color: 'var(--color-text-muted)' }}>
                  Last extracted from {fileName} · {formatted}
                </div>
              );
            })()}

            {/* Inline Share Form - appears below header when toggled (owner only) */}
            {showShareForm && isOwner && (
              <div style={{ marginTop: 20, padding: 20, backgroundColor: 'var(--color-bg)', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)' }}>
                <h3 style={{ margin: '0 0 16px', fontSize: 16, fontWeight: 600 }}>Share This Policy</h3>
                <form onSubmit={async (e) => { e.preventDefault(); try { await sharingApi.share(policyId, shareForm); setShowShareForm(false); setShareForm({ shared_with_email: '', permission: 'view', role_label: null, expires_at: null }); setShares(await sharingApi.listShares(policyId)); toast('Invite sent', 'success'); } catch (err: any) { setError(err.message); } }}>
                  <div className="form-grid-2" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                    <div>
                      <label style={labelStyle}>Email</label>
                      <input type="email" value={shareForm.shared_with_email} onChange={e => setShareForm({ ...shareForm, shared_with_email: e.target.value })} required style={inputStyle} placeholder="user@example.com" />
                    </div>
                    <div>
                      <label style={labelStyle}>Permission</label>
                      <select value={shareForm.permission} onChange={e => setShareForm({ ...shareForm, permission: e.target.value })} style={inputStyle}>
                        <option value="view">View Only</option>
                        <option value="edit">Can Edit</option>
                      </select>
                    </div>
                    <div>
                      <label style={labelStyle}>Role (optional)</label>
                      <select value={shareForm.role_label || ''} onChange={e => setShareForm({ ...shareForm, role_label: e.target.value || null })} style={inputStyle}>
                        <option value="">No label</option>
                        <option value="spouse">Spouse</option>
                        <option value="child">Child</option>
                        <option value="parent">Parent</option>
                        <option value="attorney">Attorney</option>
                        <option value="cpa">CPA / Accountant</option>
                        <option value="caregiver">Caregiver</option>
                        <option value="broker">Broker</option>
                        <option value="other">Other</option>
                      </select>
                    </div>
                    <div>
                      <label style={labelStyle}>Expires (optional)</label>
                      <input type="date" value={shareForm.expires_at || ''} onChange={e => setShareForm({ ...shareForm, expires_at: e.target.value || null })} style={inputStyle} />
                    </div>
                  </div>
                  <button type="submit" className="btn btn-accent" style={{ marginTop: 12, padding: '8px 20px' }}>Send Invite</button>
                </form>

                {/* Current Shares Management */}
                {shares.length > 0 && (
                  <div style={{ marginTop: 20, paddingTop: 16, borderTop: '1px solid var(--color-border)' }}>
                    <h4 style={{ margin: '0 0 12px', fontSize: 14, fontWeight: 600, color: 'var(--color-text-secondary)' }}>Current Access</h4>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      {shares.map(s => (
                        <div key={s.id} className="mobile-wrap" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: 10, backgroundColor: '#fff', borderRadius: 4, border: '1px solid var(--color-border)', flexWrap: 'wrap', gap: 8 }}>
                          <div style={{ minWidth: 0 }}>
                            <span style={{ fontWeight: 500, wordBreak: 'break-all' }}>{s.shared_with_email}</span>
                            <span style={{ marginLeft: 8, padding: '2px 6px', borderRadius: 3, fontSize: 11, fontWeight: 600, backgroundColor: s.permission === 'edit' ? '#dbeafe' : '#f0f0f0', color: s.permission === 'edit' ? '#1e40af' : '#555' }}>{s.permission}</span>
                            {s.role_label && <span style={{ marginLeft: 8, padding: '2px 6px', borderRadius: 3, fontSize: 11, fontWeight: 600, backgroundColor: '#f5f3ff', color: '#6d28d9' }}>{s.role_label}</span>}
                            {!s.accepted && <span style={{ marginLeft: 8, fontSize: 11, color: '#999' }}>pending</span>}
                          </div>
                          <button onClick={async () => { await sharingApi.revoke(s.id); setShares(prev => prev.filter(x => x.id !== s.id)); toast('Access revoked', 'success'); }} className="btn btn-danger" style={{ padding: '4px 10px', fontSize: 12 }}>Revoke</button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
            <div className="mobile-grid-1" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16, marginTop: 20, paddingTop: 20, borderTop: '1px solid var(--color-border)' }}>
              <div>
                <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginBottom: 2, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Premium</div>
                <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--color-primary)' }}>{policy.premium_amount ? `$${policy.premium_amount.toLocaleString()}` : '-'}</div>
              </div>
              <div>
                <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginBottom: 2, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Deductible</div>
                <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--color-text)' }}>{policy.deductible ? `$${policy.deductible.toLocaleString()}` : '-'}</div>
              </div>
              <div>
                <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginBottom: 2, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Renewal Date</div>
                <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--color-text)' }}>{policy.renewal_date ?? '-'}</div>
              </div>
            </div>
          </>
        ) : (
          <div>
            <h2 style={{ margin: '0 0 16px', fontSize: 18, fontWeight: 700 }}>Edit Policy</h2>
            <div className="form-grid-2" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div>
                <label style={labelStyle}>Nickname</label>
                <input value={editForm.nickname ?? ''} onChange={e => setEditForm({ ...editForm, nickname: e.target.value })} placeholder="e.g. Mom's Car" style={inputStyle} />
              </div>
              <div>
                <label style={labelStyle}>Carrier</label>
                <input value={editForm.carrier ?? ''} onChange={e => setEditForm({ ...editForm, carrier: e.target.value })} style={inputStyle} />
              </div>
              <div>
                <label style={labelStyle}>Policy Number</label>
                <input value={editForm.policy_number ?? ''} onChange={e => setEditForm({ ...editForm, policy_number: e.target.value })} style={inputStyle} />
              </div>
              <div>
                <label style={labelStyle}>Scope</label>
                <select value={editForm.scope ?? ''} onChange={e => setEditForm({ ...editForm, scope: e.target.value as "personal" | "business" })} style={inputStyle}>
                  <option value="personal">Personal</option>
                  <option value="business">Business</option>
                </select>
              </div>
              {editForm.scope === 'business' && (
                <div>
                  <label style={labelStyle}>Business Name</label>
                  <input value={editForm.business_name ?? ''} onChange={e => setEditForm({ ...editForm, business_name: e.target.value })} placeholder="e.g. Acme Corp" style={inputStyle} />
                </div>
              )}
              <div>
                <label style={labelStyle}>Type</label>
                <select value={editForm.policy_type ?? ''} onChange={e => setEditForm({ ...editForm, policy_type: e.target.value })} style={inputStyle}>
                  {POLICY_TYPES.map(t => <option key={t} value={t}>{POLICY_TYPE_CONFIG[t]?.icon} {POLICY_TYPE_CONFIG[t]?.label || t}</option>)}
                </select>
              </div>
              <div>
                <label style={labelStyle}>Coverage Amount</label>
                <input type="number" value={editForm.coverage_amount ?? ''} onChange={e => setEditForm({ ...editForm, coverage_amount: e.target.value ? Number(e.target.value) : null })} style={inputStyle} />
              </div>
              <div>
                <label style={labelStyle}>Deductible</label>
                <input type="number" value={editForm.deductible ?? ''} onChange={e => setEditForm({ ...editForm, deductible: e.target.value ? Number(e.target.value) : null })} style={inputStyle} />
              </div>
              <div>
                <label style={labelStyle}>Premium Amount</label>
                <input type="number" value={editForm.premium_amount ?? ''} onChange={e => setEditForm({ ...editForm, premium_amount: e.target.value ? Number(e.target.value) : null })} style={inputStyle} />
              </div>
              <div>
                <label style={labelStyle}>Renewal Date</label>
                <input type="date" value={editForm.renewal_date ?? ''} onChange={e => setEditForm({ ...editForm, renewal_date: e.target.value || null })} style={inputStyle} />
              </div>
              <div>
                <label style={labelStyle}>Asset</label>
                <select value={editForm.exposure_id ?? ''} onChange={e => setEditForm({ ...editForm, exposure_id: e.target.value ? Number(e.target.value) : null })} style={inputStyle}>
                  <option value="">None</option>
                  {exposures.map(exp => <option key={exp.id} value={exp.id}>{exp.name}</option>)}
                </select>
              </div>
              <div>
                <label style={labelStyle}>Status</label>
                <select value={editForm.status ?? 'active'} onChange={e => setEditForm({ ...editForm, status: e.target.value })} style={inputStyle}>
                  <option value="active">Active</option>
                  <option value="expired">Expired</option>
                  <option value="archived">Archived</option>
                </select>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
              <button onClick={handleSaveEdit} className="btn btn-accent" style={{ padding: '8px 20px' }}>Save</button>
              <button onClick={() => setEditing(false)} className="btn btn-outline" style={{ padding: '8px 20px' }}>Cancel</button>
            </div>
          </div>
        )}
      </div>

      {/* ID Card — appears directly below header when toggled */}
      {showIdCard && (() => {
        const det: Record<string, string> = {};
        details.forEach(d => { det[d.field_name] = d.field_value; });
        const kc: Record<string, Contact> = {};
        contacts.forEach(c => { if (c.role && !kc[c.role]) kc[c.role] = c; });
        const claimsPhone = kc.claims?.phone || kc.customer_service?.phone;

        // Gather vehicles
        const vehicles: { desc: string; vin?: string }[] = [];
        for (let i = 1; i <= 10; i++) {
          const d = det[`vehicle_${i}_description`];
          if (d) vehicles.push({ desc: d, vin: det[`vehicle_${i}_VIN`] });
        }
        if (vehicles.length === 0 && (det.vehicle_description || det.year || det.make || det.model)) {
          vehicles.push({ desc: det.vehicle_description || [det.year, det.make, det.model].filter(Boolean).join(' '), vin: det.VIN });
        }

        return (
          <div ref={idCardRef} className="card" style={{ marginBottom: 24, padding: 0, overflow: 'hidden', maxWidth: 420, width: '100%' }}>
            <div style={{ padding: '16px 20px', backgroundColor: 'var(--color-primary)', color: '#fff' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 16 }}>{policy.carrier}</div>
                  {policy.nickname && <div style={{ fontSize: 12, opacity: 0.8, marginTop: 2 }}>{policy.nickname}</div>}
                </div>
                <span style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', padding: '2px 8px', borderRadius: 10, backgroundColor: 'rgba(255,255,255,0.2)' }}>{policy.policy_type}</span>
              </div>
            </div>
            <div style={{ padding: '12px 20px' }}>
              <div className="form-grid-2" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, fontSize: 13, marginBottom: 12 }}>
                <div>
                  <div style={{ color: 'var(--color-text-muted)', fontSize: 10, fontWeight: 600, textTransform: 'uppercase' }}>Policy #</div>
                  <div style={{ fontFamily: 'monospace', fontWeight: 500 }}>{policy.policy_number}</div>
                </div>
                {det.effective_date && (
                  <div>
                    <div style={{ color: 'var(--color-text-muted)', fontSize: 10, fontWeight: 600, textTransform: 'uppercase' }}>Effective</div>
                    <div>{det.effective_date}</div>
                  </div>
                )}
                <div>
                  <div style={{ color: 'var(--color-text-muted)', fontSize: 10, fontWeight: 600, textTransform: 'uppercase' }}>Expiration</div>
                  <div>{policy.renewal_date ?? '-'}</div>
                </div>
              </div>

              {det.named_insured && (
                <div style={{ fontSize: 13, marginBottom: 8 }}>
                  <span style={{ color: 'var(--color-text-muted)', fontSize: 10, fontWeight: 600, textTransform: 'uppercase' }}>Insured: </span>
                  <span style={{ fontWeight: 500 }}>{det.named_insured}</span>
                </div>
              )}

              {/* Auto: vehicles & drivers */}
              {policy.policy_type === 'auto' && (vehicles.length > 0 || det.listed_drivers) && (
                <div style={{ fontSize: 12, padding: '8px 10px', backgroundColor: 'var(--color-bg)', borderRadius: 'var(--radius-sm)', marginBottom: 8 }}>
                  {vehicles.length > 0 && (
                    <>
                      <div style={{ color: 'var(--color-text-muted)', fontSize: 10, fontWeight: 600, textTransform: 'uppercase', marginBottom: 4 }}>{vehicles.length > 1 ? 'Vehicles' : 'Vehicle'}</div>
                      {vehicles.map((v, i) => (
                        <div key={i} style={{ marginBottom: i < vehicles.length - 1 ? 4 : 0 }}>
                          <div style={{ fontWeight: 500, fontSize: 13 }}>{v.desc}</div>
                          {v.vin && <div style={{ fontFamily: 'monospace', fontSize: 11, color: 'var(--color-text-secondary)' }}>VIN: {v.vin}</div>}
                        </div>
                      ))}
                    </>
                  )}
                  {det.listed_drivers && (
                    <div style={{ marginTop: vehicles.length > 0 ? 6 : 0 }}>
                      <div style={{ color: 'var(--color-text-muted)', fontSize: 10, fontWeight: 600, textTransform: 'uppercase', marginBottom: 2 }}>Listed Drivers</div>
                      <div style={{ fontSize: 13, fontWeight: 500 }}>{det.listed_drivers}</div>
                    </div>
                  )}
                </div>
              )}

              {/* Home: property */}
              {policy.policy_type === 'home' && det.property_address && (
                <div style={{ fontSize: 12, padding: '8px 10px', backgroundColor: 'var(--color-bg)', borderRadius: 'var(--radius-sm)', marginBottom: 8 }}>
                  <div style={{ color: 'var(--color-text-muted)', fontSize: 10, fontWeight: 600, textTransform: 'uppercase', marginBottom: 4 }}>Property</div>
                  <div style={{ fontWeight: 500, fontSize: 13 }}>{det.property_address}</div>
                </div>
              )}

              {/* Life */}
              {policy.policy_type === 'life' && (det.beneficiary || det.face_value || det.term_length) && (
                <div style={{ fontSize: 12, padding: '8px 10px', backgroundColor: 'var(--color-bg)', borderRadius: 'var(--radius-sm)', marginBottom: 8 }}>
                  <div style={{ color: 'var(--color-text-muted)', fontSize: 10, fontWeight: 600, textTransform: 'uppercase', marginBottom: 4 }}>Life Policy Details</div>
                  {det.beneficiary && <div style={{ fontWeight: 500, fontSize: 13 }}>Beneficiary: {det.beneficiary}</div>}
                  {det.face_value && <div style={{ fontSize: 12, marginTop: 2 }}>Face Value: {det.face_value}</div>}
                  {det.term_length && <div style={{ fontSize: 12, marginTop: 2 }}>Term: {det.term_length}</div>}
                </div>
              )}

              {/* Health */}
              {policy.policy_type === 'health' && (det.plan_type || det.covered_members || det.office_visit_copay || det.deductible_individual_in_network) && (
                <div style={{ fontSize: 12, padding: '8px 10px', backgroundColor: 'var(--color-bg)', borderRadius: 'var(--radius-sm)', marginBottom: 8 }}>
                  <div style={{ color: 'var(--color-text-muted)', fontSize: 10, fontWeight: 600, textTransform: 'uppercase', marginBottom: 4 }}>Health Plan Details</div>
                  {det.plan_type && <div style={{ fontWeight: 500, fontSize: 13 }}>{det.plan_type}{det.plan_tier ? ` — ${det.plan_tier}` : ''}</div>}
                  {det.group_number && <div style={{ fontSize: 12, marginTop: 2 }}>Group #: {det.group_number}</div>}
                  {det.covered_members && <div style={{ fontSize: 12, marginTop: 2 }}>Covered: {det.covered_members}</div>}
                  {det.network_name && <div style={{ fontSize: 12, marginTop: 2 }}>Network: {det.network_name}</div>}
                  {(det.deductible_individual_in_network || det.deductible_family_in_network) && (
                    <div style={{ fontSize: 12, marginTop: 4 }}>
                      Deductible: {det.deductible_individual_in_network && `${det.deductible_individual_in_network} (ind)`}
                      {det.deductible_individual_in_network && det.deductible_family_in_network && ' / '}
                      {det.deductible_family_in_network && `${det.deductible_family_in_network} (fam)`}
                    </div>
                  )}
                  {(det.oop_max_individual_in_network || det.oop_max_family_in_network) && (
                    <div style={{ fontSize: 12, marginTop: 2 }}>
                      OOP Max: {det.oop_max_individual_in_network && `${det.oop_max_individual_in_network} (ind)`}
                      {det.oop_max_individual_in_network && det.oop_max_family_in_network && ' / '}
                      {det.oop_max_family_in_network && `${det.oop_max_family_in_network} (fam)`}
                    </div>
                  )}
                  {det.office_visit_copay && <div style={{ fontSize: 12, marginTop: 2 }}>Office Visit: {det.office_visit_copay}</div>}
                  {det.specialist_copay && <div style={{ fontSize: 12, marginTop: 2 }}>Specialist: {det.specialist_copay}</div>}
                  {det.er_copay && <div style={{ fontSize: 12, marginTop: 2 }}>ER: {det.er_copay}</div>}
                  {det.prescription_copay_generic && <div style={{ fontSize: 12, marginTop: 2 }}>Rx (Generic): {det.prescription_copay_generic}</div>}
                </div>
              )}

              {/* Dental */}
              {policy.policy_type === 'dental' && (det.plan_type || det.annual_maximum || det.preventive_coverage) && (
                <div style={{ fontSize: 12, padding: '8px 10px', backgroundColor: 'var(--color-bg)', borderRadius: 'var(--radius-sm)', marginBottom: 8 }}>
                  <div style={{ color: 'var(--color-text-muted)', fontSize: 10, fontWeight: 600, textTransform: 'uppercase', marginBottom: 4 }}>Dental Plan Details</div>
                  {det.plan_type && <div style={{ fontWeight: 500, fontSize: 13 }}>{det.plan_type}</div>}
                  {det.group_number && <div style={{ fontSize: 12, marginTop: 2 }}>Group #: {det.group_number}</div>}
                  {det.covered_members && <div style={{ fontSize: 12, marginTop: 2 }}>Covered: {det.covered_members}</div>}
                  {det.annual_maximum && <div style={{ fontSize: 12, marginTop: 4 }}>Annual Max: {det.annual_maximum}</div>}
                  {det.preventive_coverage && <div style={{ fontSize: 12, marginTop: 2 }}>Preventive: {det.preventive_coverage}</div>}
                  {det.basic_coverage && <div style={{ fontSize: 12, marginTop: 2 }}>Basic: {det.basic_coverage}</div>}
                  {det.major_coverage && <div style={{ fontSize: 12, marginTop: 2 }}>Major: {det.major_coverage}</div>}
                  {det.orthodontia_coverage && <div style={{ fontSize: 12, marginTop: 2 }}>Ortho: {det.orthodontia_coverage}</div>}
                  {det.network_name && <div style={{ fontSize: 12, marginTop: 2 }}>Network: {det.network_name}</div>}
                </div>
              )}

              {/* Vision */}
              {policy.policy_type === 'vision' && (det.exam_copay || det.frames_allowance) && (
                <div style={{ fontSize: 12, padding: '8px 10px', backgroundColor: 'var(--color-bg)', borderRadius: 'var(--radius-sm)', marginBottom: 8 }}>
                  <div style={{ color: 'var(--color-text-muted)', fontSize: 10, fontWeight: 600, textTransform: 'uppercase', marginBottom: 4 }}>Vision Plan Details</div>
                  {det.plan_type && <div style={{ fontWeight: 500, fontSize: 13 }}>{det.plan_type}</div>}
                  {det.group_number && <div style={{ fontSize: 12, marginTop: 2 }}>Group #: {det.group_number}</div>}
                  {det.covered_members && <div style={{ fontSize: 12, marginTop: 2 }}>Covered: {det.covered_members}</div>}
                  {det.exam_copay && <div style={{ fontSize: 12, marginTop: 4 }}>Exam Copay: {det.exam_copay}</div>}
                  {det.frames_allowance && <div style={{ fontSize: 12, marginTop: 2 }}>Frames: {det.frames_allowance}</div>}
                  {det.contact_lens_allowance && <div style={{ fontSize: 12, marginTop: 2 }}>Contacts: {det.contact_lens_allowance}</div>}
                  {det.exam_frequency && <div style={{ fontSize: 12, marginTop: 2 }}>Exam Freq: {det.exam_frequency}</div>}
                  {det.network_name && <div style={{ fontSize: 12, marginTop: 2 }}>Network: {det.network_name}</div>}
                </div>
              )}

              {/* Liability / Umbrella */}
              {(policy.policy_type === 'liability' || policy.policy_type === 'umbrella') && (det.aggregate_limit || det.per_occurrence_limit) && (
                <div style={{ fontSize: 12, padding: '8px 10px', backgroundColor: 'var(--color-bg)', borderRadius: 'var(--radius-sm)', marginBottom: 8 }}>
                  <div style={{ color: 'var(--color-text-muted)', fontSize: 10, fontWeight: 600, textTransform: 'uppercase', marginBottom: 4 }}>{policy.policy_type === 'umbrella' ? 'Umbrella' : 'Liability'} Details</div>
                  {det.per_occurrence_limit && <div style={{ fontWeight: 500, fontSize: 13 }}>Per Occurrence: {det.per_occurrence_limit}</div>}
                  {det.aggregate_limit && <div style={{ fontSize: 12, marginTop: 2 }}>Aggregate: {det.aggregate_limit}</div>}
                </div>
              )}

              {/* Workers Comp */}
              {policy.policy_type === 'workers_comp' && (det.business_name || det.classification_code) && (
                <div style={{ fontSize: 12, padding: '8px 10px', backgroundColor: 'var(--color-bg)', borderRadius: 'var(--radius-sm)', marginBottom: 8 }}>
                  <div style={{ color: 'var(--color-text-muted)', fontSize: 10, fontWeight: 600, textTransform: 'uppercase', marginBottom: 4 }}>Workers Comp Details</div>
                  {det.business_name && <div style={{ fontWeight: 500, fontSize: 13 }}>{det.business_name}</div>}
                  {det.classification_code && <div style={{ fontSize: 12, marginTop: 2 }}>Class Code: {det.classification_code}</div>}
                </div>
              )}

              {claimsPhone && (
                <div style={{ fontSize: 12, marginBottom: 6 }}>
                  <span style={{ color: 'var(--color-text-muted)', fontSize: 10, fontWeight: 600, textTransform: 'uppercase' }}>Claims: </span>
                  <a href={`tel:${cleanPhone(claimsPhone)}`} style={{ color: 'var(--color-accent)', fontWeight: 500, textDecoration: 'none' }}>{formatPhone(claimsPhone)}</a>
                </div>
              )}

              <div style={{ fontSize: 12 }}>
                <span style={{ color: 'var(--color-text-muted)', fontSize: 10, fontWeight: 600, textTransform: 'uppercase' }}>Shared with: </span>
                <span style={{ fontWeight: 500, color: 'var(--color-text-secondary)' }}>
                  {shares.length > 0 ? shares.map(s => s.shared_with_email).join(', ') : 'None'}
                </span>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Policy Status — derived from gap analysis */}
      {(() => {
        const highGaps = policyGaps.filter(g => g.severity === 'high');
        const medGaps = policyGaps.filter(g => g.severity === 'medium');
        const infoGaps = policyGaps.filter(g => g.severity === 'info');
        const actionGaps = [...highGaps, ...medGaps];
        const statusColor = highGaps.length > 0 ? 'var(--color-danger)' : medGaps.length > 0 ? 'var(--color-warning)' : 'var(--color-success)';
        const statusBg = highGaps.length > 0 ? 'var(--color-danger-bg)' : medGaps.length > 0 ? 'var(--color-warning-bg)' : 'var(--color-success-bg)';
        const statusLabel = highGaps.length > 0 ? 'Needs Attention' : medGaps.length > 0 ? 'Review Recommended' : 'Looking Good';
        const statusIcon = highGaps.length > 0 ? '●' : medGaps.length > 0 ? '●' : '●';
        return (
          <div className="card" style={{ marginBottom: 24, border: `1px solid ${statusColor}20`, backgroundColor: statusBg }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: actionGaps.length > 0 ? 16 : 0 }}>
              <span style={{ color: statusColor, fontSize: 20 }}>{statusIcon}</span>
              <span style={{ fontSize: 16, fontWeight: 700, color: statusColor }}>{statusLabel}</span>
              {actionGaps.length === 0 && infoGaps.length === 0 && (
                <span style={{ fontSize: 13, color: 'var(--color-text-secondary)', marginLeft: 4 }}>No issues found with this policy</span>
              )}
            </div>
            {actionGaps.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {actionGaps.map((gap, i) => (
                  <div key={i} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: 12, backgroundColor: '#fff', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)' }}>
                    <span style={{
                      padding: '2px 8px', borderRadius: 10, fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap',
                      backgroundColor: gap.severity === 'high' ? 'var(--color-danger-bg)' : 'var(--color-warning-bg)',
                      color: gap.severity === 'high' ? 'var(--color-danger)' : 'var(--color-warning)',
                    }}>{gap.severity === 'high' ? 'High' : 'Medium'}</span>
                    <div>
                      <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-text)' }}>{gap.name}</div>
                      <div style={{ fontSize: 13, color: 'var(--color-text-secondary)', marginTop: 2 }}>{gap.description}</div>
                      {gap.recommendation && (
                        <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 4 }}>💡 {gap.recommendation}</div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
            {infoGaps.length > 0 && (
              <details style={{ marginTop: actionGaps.length > 0 ? 12 : 0 }}>
                <summary style={{ fontSize: 13, color: 'var(--color-text-muted)', cursor: 'pointer' }}>
                  {infoGaps.length} informational note{infoGaps.length > 1 ? 's' : ''}
                </summary>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8 }}>
                  {infoGaps.map((gap, i) => (
                    <div key={i} style={{ fontSize: 13, color: 'var(--color-text-secondary)', paddingLeft: 12, borderLeft: '2px solid var(--color-border)' }}>
                      <strong>{gap.name}</strong> — {gap.description}
                    </div>
                  ))}
                </div>
              </details>
            )}
          </div>
        );
      })()}

      {/* What You're Protected Against - Primary understanding section */}
      <div className="card" style={{ marginBottom: 32, backgroundColor: '#fff' }}>
        <h2 style={{ margin: '0 0 16px', fontSize: 20, fontWeight: 700, color: 'var(--color-text)' }}>What You&apos;re Protected Against</h2>

        {/* Key Figures Grid */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 16, marginBottom: 20 }}>
          {policy.coverage_amount && (
            <div style={{ padding: 16, backgroundColor: '#fff', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)' }}>
              <div style={{ fontSize: 11, color: 'var(--color-text-muted)', fontWeight: 600, textTransform: 'uppercase', marginBottom: 4 }}>Coverage Limit</div>
              <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--color-primary)' }}>${policy.coverage_amount.toLocaleString()}</div>
            </div>
          )}
          {policy.deductible && (
            <div style={{ padding: 16, backgroundColor: '#fff', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)' }}>
              <div style={{ fontSize: 11, color: 'var(--color-text-muted)', fontWeight: 600, textTransform: 'uppercase', marginBottom: 4 }}>Deductible</div>
              <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--color-text)' }}>${policy.deductible.toLocaleString()}</div>
            </div>
          )}
          {policy.premium_amount && (
            <div style={{ padding: 16, backgroundColor: '#fff', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)' }}>
              <div style={{ fontSize: 11, color: 'var(--color-text-muted)', fontWeight: 600, textTransform: 'uppercase', marginBottom: 4 }}>Annual Premium</div>
              <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--color-text)' }}>${policy.premium_amount.toLocaleString()}</div>
            </div>
          )}
          {policy.renewal_date && (
            <div style={{ padding: 16, backgroundColor: '#fff', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)' }}>
              <div style={{ fontSize: 11, color: 'var(--color-text-muted)', fontWeight: 600, textTransform: 'uppercase', marginBottom: 4 }}>Renewal Date</div>
              <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--color-text)' }}>{policy.renewal_date}</div>
            </div>
          )}
        </div>

        {/* Quick Coverage Summary - What's Covered */}
        {coverageItems.filter(ci => ci.item_type === 'inclusion').length > 0 && (() => {
          const inclusions = coverageItems.filter(ci => ci.item_type === 'inclusion');
          const displayCount = showAllInclusions ? inclusions.length : 6;
          const hasMore = inclusions.length > 6;

          return (
            <div style={{ marginBottom: 16 }}>
              <h3 style={{ margin: '0 0 8px', fontSize: 14, fontWeight: 600, color: '#166534' }}>Covered</h3>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {inclusions.slice(0, displayCount).map(ci => (
                  <span key={ci.id} style={{ padding: '4px 10px', backgroundColor: '#f0fdf4', color: '#166534', borderRadius: 16, fontSize: 12, fontWeight: 500 }}>
                    {ci.description}{ci.limit && `: ${ci.limit}`}
                  </span>
                ))}
                {hasMore && (
                  <button
                    onClick={() => setShowAllInclusions(!showAllInclusions)}
                    style={{
                      padding: '4px 10px',
                      backgroundColor: '#e0e7ff',
                      color: '#3730a3',
                      borderRadius: 16,
                      fontSize: 12,
                      fontWeight: 500,
                      border: 'none',
                      cursor: 'pointer',
                    }}
                  >
                    {showAllInclusions ? 'Show less' : `+${inclusions.length - 6} more`}
                  </button>
                )}
              </div>
            </div>
          );
        })()}

        {/* Key Exclusions Warning */}
        {coverageItems.filter(ci => ci.item_type === 'exclusion').length > 0 && (() => {
          const exclusions = coverageItems.filter(ci => ci.item_type === 'exclusion');
          const displayCount = showAllExclusions ? exclusions.length : 4;
          const hasMore = exclusions.length > 4;

          return (
            <div>
              <h3 style={{ margin: '0 0 8px', fontSize: 14, fontWeight: 600, color: '#991b1b' }}>Potential Risk Areas</h3>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {exclusions.slice(0, displayCount).map(ci => (
                  <span key={ci.id} style={{ padding: '4px 10px', backgroundColor: '#fef2f2', color: '#991b1b', borderRadius: 16, fontSize: 12, fontWeight: 500 }}>
                    {ci.description}
                  </span>
                ))}
                {hasMore && (
                  <button
                    onClick={() => setShowAllExclusions(!showAllExclusions)}
                    style={{
                      padding: '4px 10px',
                      backgroundColor: '#fce7f3',
                      color: '#9d174d',
                      borderRadius: 16,
                      fontSize: 12,
                      fontWeight: 500,
                      border: 'none',
                      cursor: 'pointer',
                    }}
                  >
                    {showAllExclusions ? 'Show less' : `+${exclusions.length - 4} more`}
                  </button>
                )}
              </div>
            </div>
          );
        })()}

        {/* Empty state */}
        {!policy.coverage_amount && !policy.deductible && coverageItems.length === 0 && (
          <p style={{ color: 'var(--color-text-muted)', margin: 0, fontSize: 14 }}>
            Upload a policy document to extract coverage details, or add them manually below.
          </p>
        )}
      </div>

      {/* Deductible Tracking - Only show if policy has a deductible */}
      {policy.deductible && policy.deductible > 0 && (
        <div className="card" style={{ marginBottom: 32 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 12 }}>
            <h2 className="section-title" style={{ margin: 0 }}>Deductible Tracking</h2>
            {canEdit && (
              <button
                onClick={() => {
                  if (!editingDeductible) {
                    setDeductibleForm({
                      type: policy.deductible_type || 'annual',
                      period_start: policy.deductible_period_start || new Date().getFullYear() + '-01-01',
                      applied: policy.deductible_applied || 0,
                    });
                  }
                  setEditingDeductible(!editingDeductible);
                }}
                className="btn btn-outline"
                style={{ padding: '6px 12px', fontSize: 13 }}
              >
                {editingDeductible ? 'Cancel' : 'Update'}
              </button>
            )}
          </div>

          {/* Display Mode */}
          {!editingDeductible && (() => {
            const deductibleAmount = policy.deductible || 0;
            const appliedAmount = policy.deductible_applied || 0;
            const remaining = Math.max(0, deductibleAmount - appliedAmount);
            const percentUsed = deductibleAmount > 0 ? Math.min(100, (appliedAmount / deductibleAmount) * 100) : 0;

            return (
              <div>
                {/* Progress bar */}
                <div style={{ marginBottom: 16 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6, fontSize: 13 }}>
                    <span style={{ color: 'var(--color-text-secondary)' }}>
                      ${appliedAmount.toLocaleString()} applied
                    </span>
                    <span style={{ fontWeight: 600, color: 'var(--color-text)' }}>
                      ${remaining.toLocaleString()} remaining
                    </span>
                  </div>
                  <div style={{ height: 8, backgroundColor: 'var(--color-border)', borderRadius: 4, overflow: 'hidden' }}>
                    <div
                      style={{
                        width: `${percentUsed}%`,
                        height: '100%',
                        backgroundColor: percentUsed >= 100 ? 'var(--color-success)' : 'var(--color-primary)',
                        borderRadius: 4,
                        transition: 'width 0.3s',
                      }}
                    />
                  </div>
                </div>

                {/* Details */}
                <div className="mobile-grid-1" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16, fontSize: 13 }}>
                  <div>
                    <div style={{ color: 'var(--color-text-muted)', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', marginBottom: 4 }}>Deductible</div>
                    <div style={{ fontWeight: 600, fontSize: 16 }}>${deductibleAmount.toLocaleString()}</div>
                  </div>
                  <div>
                    <div style={{ color: 'var(--color-text-muted)', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', marginBottom: 4 }}>Type</div>
                    <div style={{ fontWeight: 500 }}>{policy.deductible_type === 'per_incident' ? 'Per Incident' : 'Annual'}</div>
                  </div>
                  <div>
                    <div style={{ color: 'var(--color-text-muted)', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', marginBottom: 4 }}>Period Start</div>
                    <div style={{ fontWeight: 500 }}>{policy.deductible_period_start || 'Not set'}</div>
                  </div>
                </div>

                {percentUsed >= 100 && (
                  <div style={{ marginTop: 16, padding: 12, backgroundColor: '#dcfce7', borderRadius: 'var(--radius-md)', color: '#166534', fontSize: 14, fontWeight: 500 }}>
                    Deductible met! Claims are now fully covered up to your policy limits.
                  </div>
                )}
              </div>
            );
          })()}

          {/* Edit Mode */}
          {editingDeductible && (
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                try {
                  const updated = await policiesApi.update(policyId, {
                    deductible_type: deductibleForm.type,
                    deductible_period_start: deductibleForm.period_start || null,
                    deductible_applied: deductibleForm.applied,
                  });
                  setPolicy(updated);
                  setEditingDeductible(false);
                  toast('Deductible tracking updated', 'success');
                } catch (err: any) {
                  setError(err.message);
                }
              }}
              style={{ padding: 16, backgroundColor: '#fff', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)' }}
            >
              <div className="mobile-grid-1" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
                <div>
                  <label style={labelStyle}>Deductible Type</label>
                  <select
                    value={deductibleForm.type}
                    onChange={e => setDeductibleForm({ ...deductibleForm, type: e.target.value })}
                    style={inputStyle}
                  >
                    <option value="annual">Annual</option>
                    <option value="per_incident">Per Incident</option>
                  </select>
                </div>
                <div>
                  <label style={labelStyle}>Period Start Date</label>
                  <input
                    type="date"
                    value={deductibleForm.period_start}
                    onChange={e => setDeductibleForm({ ...deductibleForm, period_start: e.target.value })}
                    style={inputStyle}
                  />
                </div>
                <div>
                  <label style={labelStyle}>Amount Applied ($)</label>
                  <input
                    type="number"
                    step="1"
                    value={deductibleForm.applied || ''}
                    onChange={e => setDeductibleForm({ ...deductibleForm, applied: Number(e.target.value) || 0 })}
                    placeholder="0"
                    style={inputStyle}
                  />
                </div>
              </div>
              <button type="submit" className="btn btn-accent" style={{ marginTop: 12, padding: '8px 20px' }}>Save</button>
            </form>
          )}
        </div>
      )}

      {/* Claims Quick-Start */}
      {(() => {
        const claimsContact = contacts.find(c => c.role === 'claims') || contacts.find(c => c.role === 'customer_service');
        if (!claimsContact?.phone) return null;

        return (
          <div className="card" style={{ marginBottom: 24, background: 'linear-gradient(135deg, #fef2f2 0%, #fee2e2 100%)', border: '1px solid #fecaca' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
              <div>
                <h2 style={{ margin: '0 0 4px', fontSize: 18, color: '#991b1b' }}>If something happens</h2>
                <p style={{ margin: 0, fontSize: 13, color: '#b91c1c' }}>Everything you need to start a claim</p>
              </div>
            </div>

            <div className="form-grid-2" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
              <div style={{ padding: 16, backgroundColor: '#fff', borderRadius: 8, border: '1px solid #fecaca' }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: '#991b1b', textTransform: 'uppercase', marginBottom: 6 }}>Policy Number</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontFamily: 'monospace', fontSize: 16, fontWeight: 600 }}>{policy.policy_number}</span>
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(policy.policy_number);
                      setCopiedPolicyNumber(true);
                      setTimeout(() => setCopiedPolicyNumber(false), 2000);
                    }}
                    style={{
                      padding: '4px 8px',
                      fontSize: 11,
                      backgroundColor: copiedPolicyNumber ? '#22c55e' : '#f3f4f6',
                      color: copiedPolicyNumber ? '#fff' : '#374151',
                      border: 'none',
                      borderRadius: 4,
                      cursor: 'pointer',
                    }}
                  >
                    {copiedPolicyNumber ? '✓ Copied' : 'Copy'}
                  </button>
                </div>
              </div>
              <div style={{ padding: 16, backgroundColor: '#fff', borderRadius: 8, border: '1px solid #fecaca' }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: '#991b1b', textTransform: 'uppercase', marginBottom: 6 }}>Coverage Limit</div>
                <div style={{ fontSize: 16, fontWeight: 600 }}>
                  {policy.coverage_amount ? `$${policy.coverage_amount.toLocaleString()}` : 'See policy'}
                </div>
              </div>
            </div>

            <a
              href={`tel:${cleanPhone(claimsContact.phone)}`}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 8,
                padding: '14px 24px',
                backgroundColor: 'var(--color-danger)',
                color: '#fff',
                borderRadius: 8,
                textDecoration: 'none',
                fontSize: 16,
                fontWeight: 600,
              }}
            >
              📞 Call Claims: {formatPhone(claimsContact.phone)}
            </a>

            <button
              onClick={() => router.push('/emergency')}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 8,
                width: '100%',
                marginTop: 12,
                padding: '12px 24px',
                backgroundColor: '#fff',
                color: 'var(--color-danger-dark)',
                border: '2px solid var(--color-danger)',
                borderRadius: 8,
                fontSize: 14,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              🆘 View Emergency Card
            </button>

            {policy.deductible && (
              <p style={{ margin: '12px 0 0', fontSize: 12, color: 'var(--color-danger-dark)', textAlign: 'center' }}>
                Remember: Your deductible is ${policy.deductible.toLocaleString()}
              </p>
            )}
          </div>
        );
      })()}

      {/* Premium History */}
      {(premiumHistory.length > 0 || policy.premium_amount) && !checkFeatureAccess(plan || 'free', 'premium_history').allowed && (
        <UpgradePrompt feature="premium_history" requiredPlan={checkFeatureAccess(plan || 'free', 'premium_history').requiredPlan} message="Upgrade to Pro to track how your premiums change over time." />
      )}
      {(premiumHistory.length > 0 || policy.premium_amount) && checkFeatureAccess(plan || 'free', 'premium_history').allowed && (
        <div className="card" style={{ marginBottom: 32 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 12 }}>
            <div>
              <h2 className="section-title" style={{ margin: 0 }}>Premium History</h2>
              {premiumHistoryChange !== 0 && (
                <p style={{ margin: '4px 0 0', fontSize: 13, color: premiumHistoryChange > 0 ? 'var(--color-danger)' : 'var(--color-success)' }}>
                  {premiumHistoryChange > 0 ? '↑' : '↓'} {Math.abs(premiumHistoryChange)}% total change
                </p>
              )}
            </div>
            {canEdit && (
              <button
                onClick={() => setShowAddPremiumHistory(!showAddPremiumHistory)}
                className="btn btn-outline"
                style={{ padding: '6px 12px', fontSize: 13 }}
              >
                {showAddPremiumHistory ? 'Cancel' : '+ Add Entry'}
              </button>
            )}
          </div>

          {/* Add Premium History Form */}
          {showAddPremiumHistory && (
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                try {
                  await premiumHistoryApi.add(policyId, premiumHistoryForm.amount, premiumHistoryForm.effective_date);
                  const result = await premiumHistoryApi.list(policyId);
                  setPremiumHistory(result.history);
                  setPremiumHistoryChange(result.total_change_pct);
                  setShowAddPremiumHistory(false);
                  setPremiumHistoryForm({ amount: 0, effective_date: '' });
                  toast('Premium history added', 'success');
                } catch (err: any) {
                  setError(err.message);
                }
              }}
              style={{ padding: 16, marginBottom: 16, backgroundColor: 'var(--color-bg)', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)' }}
            >
              <div className="form-grid-2" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div>
                  <label style={labelStyle}>Annual Premium ($)</label>
                  <input
                    type="number"
                    required
                    value={premiumHistoryForm.amount || ''}
                    onChange={e => setPremiumHistoryForm({ ...premiumHistoryForm, amount: Number(e.target.value) })}
                    placeholder="e.g., 1200"
                    style={inputStyle}
                  />
                </div>
                <div>
                  <label style={labelStyle}>Effective Date</label>
                  <input
                    type="date"
                    required
                    value={premiumHistoryForm.effective_date}
                    onChange={e => setPremiumHistoryForm({ ...premiumHistoryForm, effective_date: e.target.value })}
                    style={inputStyle}
                  />
                </div>
              </div>
              <button type="submit" className="btn btn-accent" style={{ marginTop: 12, padding: '8px 20px' }}>
                Add Entry
              </button>
            </form>
          )}

          {/* Premium Trend Chart */}
          {premiumHistory.length > 1 && (
            <div style={{ marginBottom: 16 }}>
              <div style={{ display: 'flex', alignItems: 'flex-end', gap: 4, height: 80, padding: '0 4px' }}>
                {premiumHistory.map((entry, i) => {
                  const maxAmount = Math.max(...premiumHistory.map(e => e.amount));
                  const height = maxAmount > 0 ? (entry.amount / maxAmount) * 100 : 0;
                  const isIncrease = i > 0 && entry.amount > premiumHistory[i - 1].amount;
                  const isDecrease = i > 0 && entry.amount < premiumHistory[i - 1].amount;

                  return (
                    <div key={entry.id} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                      <div
                        style={{
                          width: '100%',
                          maxWidth: 40,
                          height: `${height}%`,
                          backgroundColor: isIncrease ? '#fecaca' : isDecrease ? '#bbf7d0' : '#dbeafe',
                          borderRadius: '4px 4px 0 0',
                          minHeight: 4,
                        }}
                        title={`$${entry.amount.toLocaleString()} - ${entry.effective_date}`}
                      />
                    </div>
                  );
                })}
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4, fontSize: 10, color: 'var(--color-text-muted)' }}>
                <span>{premiumHistory[0]?.effective_date}</span>
                <span>{premiumHistory[premiumHistory.length - 1]?.effective_date}</span>
              </div>
            </div>
          )}

          {/* Premium History List */}
          {premiumHistory.length > 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {premiumHistory.slice().reverse().map((entry, i) => (
                <div
                  key={entry.id}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    padding: '10px 12px',
                    backgroundColor: 'var(--color-bg)',
                    borderRadius: 'var(--radius-sm)',
                    border: '1px solid var(--color-border)',
                  }}
                >
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 15 }}>${entry.amount.toLocaleString()}/year</div>
                    <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>
                      Effective: {entry.effective_date}
                      {entry.source !== 'manual' && (
                        <span style={{ marginLeft: 8, fontSize: 10, color: '#6b7280' }}>({entry.source})</span>
                      )}
                    </div>
                  </div>
                  {entry.change_pct !== null && entry.change_pct !== undefined && (
                    <span style={{
                      padding: '4px 8px',
                      borderRadius: 4,
                      fontSize: 12,
                      fontWeight: 600,
                      backgroundColor: entry.change_pct > 0 ? 'var(--color-danger-bg)' : entry.change_pct < 0 ? 'var(--color-success-bg)' : '#f3f4f6',
                      color: entry.change_pct > 0 ? 'var(--color-danger)' : entry.change_pct < 0 ? 'var(--color-success)' : '#6b7280',
                    }}>
                      {entry.change_pct > 0 ? '+' : ''}{entry.change_pct}%
                    </span>
                  )}
                </div>
              ))}
            </div>
          ) : policy.premium_amount ? (
            <div style={{ textAlign: 'center', padding: 20, backgroundColor: 'var(--color-bg)', borderRadius: 'var(--radius-md)' }}>
              <p style={{ fontSize: 14, color: 'var(--color-text-secondary)', marginBottom: 12 }}>
                Current premium: <strong>${policy.premium_amount.toLocaleString()}/year</strong>
              </p>
              <p style={{ fontSize: 12, color: 'var(--color-text-muted)', margin: 0 }}>
                Add historical entries to track premium changes over time
              </p>
            </div>
          ) : (
            <p style={{ color: 'var(--color-text-muted)', fontSize: 14, textAlign: 'center', padding: 16 }}>
              No premium history recorded. Add entries to track price changes.
            </p>
          )}
        </div>
      )}

      {/* Documents */}
      <div className="card" style={{ marginBottom: 32 }}>
        <h2 style={{ margin: '0 0 4px', fontSize: 18 }}>Documents</h2>
        <p style={{ margin: '0 0 16px', fontSize: 13, color: '#666' }}>Upload a policy PDF to auto-extract carrier, coverage, contacts and more.</p>
        {canEdit && (
          <div style={{ display: 'flex', gap: 8, marginBottom: 16, alignItems: 'center', flexWrap: 'wrap' }}>
            <select value={docType} onChange={e => setDocType(e.target.value)} style={{ padding: '8px 10px', border: '1px solid #ddd', borderRadius: 4, fontSize: 13 }}>
              {DOC_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
            <input ref={fileRef} type="file" style={{ fontSize: 14, minWidth: 0 }} />
            <button onClick={handleUpload} disabled={uploading} className="btn btn-accent">
              {uploading ? 'Uploading...' : 'Upload'}
            </button>
          </div>
        )}

        {(uploading || extractingId) && (
          <div style={{ padding: 12, marginBottom: 12, backgroundColor: '#eff6ff', color: '#1e40af', borderRadius: 4, fontSize: 13 }}>
            {extractingId ? 'Extracting data from PDF... This may take a moment.' : 'Uploading document...'}
            {uploadProgress !== null && (
              <div style={{ marginTop: 8, backgroundColor: '#e0e7ff', borderRadius: 4, height: 8, overflow: 'hidden' }}>
                <div style={{ width: `${uploadProgress}%`, height: '100%', backgroundColor: '#3b82f6', borderRadius: 4, transition: 'width 0.2s' }} />
              </div>
            )}
          </div>
        )}

        {docs.length === 0 ? (
          <p style={{ color: '#999', margin: 0 }}>No documents uploaded yet.</p>
        ) : (
          <div style={{ display: 'grid', gap: 8 }}>
            {/* Current (most recent) document */}
            {(() => { const d = docs[0]; return (
              <div key={d.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: 12, backgroundColor: '#fff', border: '1px solid #e5e7eb', borderRadius: 6, flexWrap: 'wrap', gap: 8 }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <span style={{ fontWeight: 500, wordBreak: 'break-all' }}>{d.filename}</span>
                    <span style={{ padding: '1px 6px', borderRadius: 3, fontSize: 10, fontWeight: 600, backgroundColor: docTypeBg(d.doc_type), color: docTypeFg(d.doc_type) }}>
                      {DOC_TYPES.find(t => t.value === d.doc_type)?.label || d.doc_type}
                    </span>
                    {d.extraction_status !== 'none' && (
                      <span style={{ padding: '1px 6px', borderRadius: 3, fontSize: 10, fontWeight: 600, backgroundColor: statusBg(d.extraction_status), color: statusFg(d.extraction_status) }}>
                        {d.extraction_status}
                      </span>
                    )}
                    <span style={{ padding: '1px 6px', borderRadius: 3, fontSize: 10, fontWeight: 600, backgroundColor: '#dbeafe', color: '#1e40af' }}>Current</span>
                  </div>
                  <div style={{ fontSize: 12, color: '#999', marginTop: 2 }}>{d.content_type} - {d.created_at}</div>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button onClick={() => handleDownload(d.id)} className="btn btn-primary">Download</button>
                  {canEdit && d.content_type === 'application/pdf' && d.extraction_status !== 'pending' && (
                    <button onClick={() => handleExtract(d.id)} disabled={extractingId === d.id} className="btn btn-accent">
                      {extractingId === d.id ? 'Extracting...' : d.extraction_status === 'done' ? 'Re-Extract' : d.extraction_status === 'failed' ? 'Retry Extract' : 'Extract'}
                    </button>
                  )}
                </div>
              </div>
            ); })()}

            {/* Document History toggle */}
            {docs.length > 1 && (
              <>
                <button
                  onClick={() => setShowDocHistory(!showDocHistory)}
                  style={{
                    background: 'none', border: 'none', padding: '8px 0', fontSize: 13,
                    color: 'var(--color-primary, #2563eb)', cursor: 'pointer', textAlign: 'left', fontWeight: 500,
                  }}
                >
                  {showDocHistory ? '\u25be' : '\u25b8'} Document History ({docs.length - 1} older)
                </button>
                {showDocHistory && docs.slice(1).map(d => (
                  <div key={d.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: 12, backgroundColor: '#fff', border: '1px solid #e5e7eb', borderRadius: 6, flexWrap: 'wrap', gap: 8 }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                        <span style={{ fontWeight: 500, wordBreak: 'break-all' }}>{d.filename}</span>
                        <span style={{ padding: '1px 6px', borderRadius: 3, fontSize: 10, fontWeight: 600, backgroundColor: docTypeBg(d.doc_type), color: docTypeFg(d.doc_type) }}>
                          {DOC_TYPES.find(t => t.value === d.doc_type)?.label || d.doc_type}
                        </span>
                        {d.extraction_status !== 'none' && (
                          <span style={{ padding: '1px 6px', borderRadius: 3, fontSize: 10, fontWeight: 600, backgroundColor: statusBg(d.extraction_status), color: statusFg(d.extraction_status) }}>
                            {d.extraction_status}
                          </span>
                        )}
                      </div>
                      <div style={{ fontSize: 12, color: '#999', marginTop: 2 }}>{d.content_type} - {d.created_at}</div>
                    </div>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button onClick={() => handleDownload(d.id)} className="btn btn-primary">Download</button>
                      {canEdit && d.content_type === 'application/pdf' && d.extraction_status !== 'pending' && (
                        <button onClick={() => handleExtract(d.id)} disabled={extractingId === d.id} className="btn btn-accent">
                          {extractingId === d.id ? 'Extracting...' : d.extraction_status === 'done' ? 'Re-Extract' : d.extraction_status === 'failed' ? 'Retry Extract' : 'Extract'}
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </>
            )}
          </div>
        )}
      </div>

      {/* Certificates of Insurance */}
      <div className="card" style={{ marginBottom: 32 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 12 }}>
          <h2 className="section-title" style={{ margin: 0 }}>Certificates of Insurance</h2>
          {canEdit && <button onClick={() => router.push(`/certificates?addFor=${policyId}`)} className="btn btn-primary">+ Add COI</button>}
        </div>
        {policyCertificates.length === 0 ? (
          <p style={{ color: '#999', margin: 0, fontSize: 14 }}>No certificates linked to this policy.</p>
        ) : (
          <div style={{ display: 'grid', gap: 12 }}>
            {policyCertificates.map(cert => {
              const isExpired = cert.status === 'expired';
              const isExpiring = cert.status === 'expiring';
              const badgeBg = isExpired ? 'var(--color-danger-bg)' : isExpiring ? 'var(--color-warning-bg)' : 'var(--color-success-bg)';
              const badgeColor = isExpired ? 'var(--color-danger)' : isExpiring ? 'var(--color-warning)' : 'var(--color-success)';
              return (
                <div key={cert.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: 14, backgroundColor: '#fff', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', flexWrap: 'wrap', gap: 8 }}>
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4, flexWrap: 'wrap' }}>
                      <span style={{ fontSize: 14, fontWeight: 600 }}>{cert.counterparty_name || 'Unnamed'}</span>
                      <span style={{ padding: '1px 8px', borderRadius: 10, fontSize: 11, fontWeight: 600, backgroundColor: '#e8e8e8', color: '#555', textTransform: 'uppercase' }}>
                        {cert.direction === 'issued' ? 'Shared' : 'Received'}
                      </span>
                      <span style={{ padding: '1px 8px', borderRadius: 10, fontSize: 11, fontWeight: 600, backgroundColor: badgeBg, color: badgeColor }}>
                        {cert.status}
                      </span>
                    </div>
                    <div style={{ fontSize: 13, color: 'var(--color-text-secondary)' }}>
                      {cert.coverage_types && <span style={{ marginRight: 12 }}>{cert.coverage_types}</span>}
                      {cert.coverage_amount && <span style={{ marginRight: 12 }}>${Number(cert.coverage_amount).toLocaleString()}</span>}
                      {cert.expiration_date && <span>Exp: {cert.expiration_date}</span>}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button onClick={() => setViewingPolicyCert(cert)} style={{ padding: '4px 10px', fontSize: 12, border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', backgroundColor: '#fff', cursor: 'pointer' }}>View</button>
                    <button onClick={() => router.push('/certificates')} style={{ padding: '4px 10px', fontSize: 12, border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', backgroundColor: '#fff', cursor: 'pointer' }}>Edit</button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Lease Check — only for business/commercial policy types */}
      {policy && (() => {
        const LEASE_CHECK_TYPES = ['general_liability', 'professional_liability', 'commercial_property', 'commercial_auto', 'cyber', 'bop', 'workers_comp', 'directors_officers', 'epli', 'inland_marine', 'liability', 'umbrella'];
        const showLeaseCheck = policy.scope === 'business' || LEASE_CHECK_TYPES.includes(policy.policy_type);
        if (!showLeaseCheck) return null;

        const CATEGORY_LABELS: Record<string, string> = {
          general_liability: 'General Liability', commercial_auto: 'Commercial Auto', umbrella: 'Umbrella / Excess',
          workers_comp: "Workers' Comp", property: 'Property', professional_liability: 'Professional Liability',
          cyber: 'Cyber', other: 'Other',
        };
        const CATEGORY_COLORS: Record<string, { bg: string; fg: string }> = {
          general_liability: { bg: '#dbeafe', fg: '#1e40af' }, commercial_auto: { bg: '#fce7f3', fg: '#9d174d' },
          umbrella: { bg: '#ede9fe', fg: '#5b21b6' }, workers_comp: { bg: '#fef3c7', fg: '#92400e' },
          property: { bg: '#dcfce7', fg: '#166534' }, professional_liability: { bg: '#e0e7ff', fg: '#3730a3' },
          cyber: { bg: '#f0fdfa', fg: '#115e59' }, other: { bg: '#f3f4f6', fg: '#374151' },
        };
        const STATUS_ICONS: Record<string, { icon: string; color: string; bg: string }> = {
          pass: { icon: '\u2713', color: '#166534', bg: '#dcfce7' },
          fail: { icon: '\u2717', color: '#991b1b', bg: '#fee2e2' },
          unclear: { icon: '?', color: '#92400e', bg: '#fef3c7' },
        };

        function getLeaseShareUrl(code: string) {
          if (typeof window === 'undefined') return '';
          return `${window.location.origin}/lease-compliance/${code}`;
        }

        async function handleLeaseExtractText() {
          if (!leaseClauseText.trim()) { toast('Please paste a lease clause', 'error'); return; }
          setLeaseExtracting(true);
          try {
            const { extraction: ext } = await leaseComplianceApi.extract(leaseClauseText);
            setLeaseExtraction(ext);
            setLeaseEditableReqs(ext.requirements || []);
            if (ext.property_address) setLeaseFormPropertyAddress(ext.property_address);
            if (ext.landlord_name && leaseFormRole === 'tenant') setLeaseFormCounterpartyName(ext.landlord_name);
            if (ext.tenant_name && leaseFormRole === 'landlord') setLeaseFormCounterpartyName(ext.tenant_name);
            if (!leaseFormLabel && ext.property_address) setLeaseFormLabel(`${ext.property_address} Lease`);
            setLeaseCreateStep(2);
            toast('Requirements extracted successfully');
          } catch (err: any) {
            toast(err.message || 'Extraction failed', 'error');
          } finally {
            setLeaseExtracting(false);
          }
        }

        async function handleLeaseExtractPdf() {
          const file = leasePdfRef.current?.files?.[0];
          if (!file) { toast('Please select a PDF file', 'error'); return; }
          setLeaseExtracting(true);
          try {
            const { extraction: ext } = await leaseComplianceApi.extractPdf(file);
            setLeaseExtraction(ext);
            setLeaseEditableReqs(ext.requirements || []);
            if (ext.property_address) setLeaseFormPropertyAddress(ext.property_address);
            if (ext.landlord_name && leaseFormRole === 'tenant') setLeaseFormCounterpartyName(ext.landlord_name);
            if (ext.tenant_name && leaseFormRole === 'landlord') setLeaseFormCounterpartyName(ext.tenant_name);
            if (!leaseFormLabel && ext.property_address) setLeaseFormLabel(`${ext.property_address} Lease`);
            setLeaseCreateStep(2);
            toast('Requirements extracted from PDF');
            if (leasePdfRef.current) leasePdfRef.current.value = '';
          } catch (err: any) {
            toast(err.message || 'PDF extraction failed', 'error');
          } finally {
            setLeaseExtracting(false);
          }
        }

        async function handleLeaseSaveAndCheck() {
          if (!leaseFormLabel.trim()) { toast('Please enter a label', 'error'); return; }
          if (leaseEditableReqs.length === 0) { toast('Add at least one requirement', 'error'); return; }
          setLeaseSaving(true);
          try {
            const created = await leaseComplianceApi.create({
              label: leaseFormLabel,
              role: leaseFormRole,
              policy_id: policyId,
              counterparty_name: leaseFormCounterpartyName || null,
              counterparty_email: leaseFormCounterpartyEmail || null,
              property_address: leaseFormPropertyAddress || null,
              lease_clause_text: leaseClauseText || null,
              requirements_json: JSON.stringify(leaseEditableReqs),
            });
            toast('Requirements saved');

            // Immediately add to local list so results view has access
            setLeaseReqs(prev => [created, ...prev]);
            setLeaseActiveReqId(created.id);
            setLeaseCheckedAgainst(`${policy!.carrier ? policy!.carrier + ' ' : ''}${policy!.policy_type.replace(/_/g, ' ')} policy`);
            setLeaseChecking(true);
            try {
              const check = await leaseComplianceApi.runCheck(created.id, 'policy', { policyId });
              setLeaseResults(check.results || []);
              setLeaseCheckCounts({ pass: check.pass_count, fail: check.fail_count, unclear: check.unclear_count });
            } catch {
              toast('Compliance check failed — you can re-check later', 'error');
            } finally {
              setLeaseChecking(false);
            }

            setLeaseView('results');
            // Reload lease reqs
            leaseComplianceApi.list(undefined, policyId).then(setLeaseReqs).catch(() => {});
          } catch (err: any) {
            toast(err.message || 'Failed to save', 'error');
          } finally {
            setLeaseSaving(false);
          }
        }

        async function handleLeaseRecheck(reqId: number) {
          setLeaseChecking(true);
          try {
            const check = await leaseComplianceApi.runCheck(reqId, 'policy', { policyId });
            setLeaseResults(check.results || []);
            setLeaseCheckCounts({ pass: check.pass_count, fail: check.fail_count, unclear: check.unclear_count });
            setLeaseActiveReqId(reqId);
            setLeaseCheckedAgainst(`${policy!.carrier ? policy!.carrier + ' ' : ''}${policy!.policy_type.replace(/_/g, ' ')} policy`);
            toast('Compliance check updated');
            leaseComplianceApi.list(undefined, policyId).then(setLeaseReqs).catch(() => {});
          } catch (err: any) {
            toast(err.message || 'Check failed', 'error');
          } finally {
            setLeaseChecking(false);
          }
        }

        async function handleLeaseViewResults(req: LeaseRequirement) {
          setLeaseActiveReqId(req.id);
          if (req.latest_check) {
            try {
              const checks = await leaseComplianceApi.listChecks(req.id);
              if (checks.length > 0) {
                const latest = checks[0];
                const parsed = typeof latest.results_json === 'string' ? JSON.parse(latest.results_json) : (latest as any).results || [];
                setLeaseResults(parsed);
                setLeaseCheckCounts({ pass: latest.pass_count, fail: latest.fail_count, unclear: latest.unclear_count });
                // Show what was checked against
                if (latest.checked_against === 'certificate') {
                  setLeaseCheckedAgainst('certificate');
                } else if (latest.checked_against === 'policy') {
                  setLeaseCheckedAgainst(`${policy!.carrier ? policy!.carrier + ' ' : ''}${policy!.policy_type.replace(/_/g, ' ')} policy`);
                } else {
                  setLeaseCheckedAgainst('all policies');
                }
              }
            } catch {
              setLeaseResults([]);
              setLeaseCheckCounts({ pass: 0, fail: 0, unclear: 0 });
              setLeaseCheckedAgainst('');
            }
          } else {
            setLeaseResults([]);
            setLeaseCheckCounts({ pass: 0, fail: 0, unclear: 0 });
            setLeaseCheckedAgainst('');
          }
          setLeaseView('results');
        }

        async function handleLeaseBrokerEmail(reqId: number) {
          setLeaseLoadingBroker(true);
          setLeaseBrokerModal(true);
          try {
            const data = await leaseComplianceApi.brokerEmail(reqId);
            setLeaseBrokerEmail(data);
          } catch {
            toast('Failed to generate email', 'error');
            setLeaseBrokerModal(false);
          } finally {
            setLeaseLoadingBroker(false);
          }
        }

        function handleLeaseShare(req: LeaseRequirement) {
          setLeaseShareReq(req);
          setLeaseShareModal(true);
          setLeaseCopiedLink(false);
          setLeaseTenantEmail(req.counterparty_email || '');
          setLeaseTenantName(req.counterparty_name || '');
        }

        async function handleLeaseDelete(id: number) {
          try {
            await leaseComplianceApi.remove(id);
            toast('Lease check deleted');
            setLeaseDeleteConfirm(null);
            leaseComplianceApi.list(undefined, policyId).then(setLeaseReqs).catch(() => {});
          } catch {
            toast('Failed to delete', 'error');
          }
        }

        function resetLeaseCreate() {
          setLeaseView('list');
          setLeaseCreateStep(1);
          setLeaseClauseText('');
          setLeaseExtraction(null);
          setLeaseEditableReqs([]);
          setLeaseFormLabel('');
          setLeaseFormPropertyAddress('');
          setLeaseFormCounterpartyName('');
          setLeaseFormCounterpartyEmail('');
        }

        return (
          <div className="card" style={{ marginBottom: 32 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 12 }}>
              <div>
                <h2 className="section-title" style={{ margin: 0 }}>Lease Check</h2>
                <a href="/features/lease-check" target="_blank" rel="noopener noreferrer" style={{ fontSize: 12, color: 'var(--color-accent)', textDecoration: 'none' }}>See how it works</a>
              </div>
              {leaseView === 'list' && canEdit && (
                <button onClick={() => setLeaseView('create')} className="btn btn-primary">+ New Check</button>
              )}
              {leaseView !== 'list' && (
                <button onClick={resetLeaseCreate} style={{ background: 'none', border: 'none', color: 'var(--color-primary)', cursor: 'pointer', fontSize: 13, fontWeight: 600, padding: 0 }}>
                  &larr; Back to list
                </button>
              )}
            </div>

            {/* ── List View ── */}
            {leaseView === 'list' && (
              <>
                {leaseReqs.length === 0 ? (
                  <div style={{ textAlign: 'center', padding: '24px 16px', color: 'var(--color-text-secondary)' }}>
                    <p style={{ fontSize: 14, margin: '0 0 12px' }}>No lease requirements checked yet.</p>
                    {canEdit && (
                      <button onClick={() => setLeaseView('create')} className="btn btn-primary">
                        Check Against Lease Requirements
                      </button>
                    )}
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {leaseReqs.map(req => {
                      const reqs: LeaseRequirementItem[] = (() => { try { return JSON.parse(req.requirements_json); } catch { return []; } })();
                      return (
                        <div key={req.id} style={{ border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: 14, backgroundColor: '#fff' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 8 }}>
                            <div style={{ flex: 1 }}>
                              <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 4 }}>{req.label}</div>
                              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', fontSize: 12, color: 'var(--color-text-secondary)' }}>
                                {req.property_address && <span>{req.property_address}</span>}
                                {req.counterparty_name && <span>&middot; {req.counterparty_name}</span>}
                                <span>&middot; {reqs.length} req{reqs.length !== 1 ? 's' : ''}</span>
                              </div>
                              {req.latest_check && (
                                <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                                  {req.latest_check.pass_count > 0 && <span style={{ padding: '1px 8px', borderRadius: 10, fontSize: 11, fontWeight: 600, backgroundColor: '#dcfce7', color: '#166534' }}>{req.latest_check.pass_count} pass</span>}
                                  {req.latest_check.fail_count > 0 && <span style={{ padding: '1px 8px', borderRadius: 10, fontSize: 11, fontWeight: 600, backgroundColor: '#fee2e2', color: '#991b1b' }}>{req.latest_check.fail_count} fail</span>}
                                  {req.latest_check.unclear_count > 0 && <span style={{ padding: '1px 8px', borderRadius: 10, fontSize: 11, fontWeight: 600, backgroundColor: '#fef3c7', color: '#92400e' }}>{req.latest_check.unclear_count} unclear</span>}
                                </div>
                              )}
                            </div>
                            <div style={{ display: 'flex', gap: 4 }}>
                              <button onClick={() => handleLeaseViewResults(req)} style={{ padding: '4px 10px', fontSize: 12, border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', backgroundColor: '#fff', cursor: 'pointer' }}>Check</button>
                              <button onClick={() => handleLeaseShare(req)} style={{ padding: '4px 10px', fontSize: 12, border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', backgroundColor: '#fff', cursor: 'pointer' }}>Share</button>
                              <button onClick={() => { const url = getLeaseShareUrl(req.access_code) + '?print=1'; window.open(url, '_blank'); }} style={{ padding: '4px 10px', fontSize: 12, border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', backgroundColor: '#fff', cursor: 'pointer' }}>Print</button>
                              {canEdit && <button onClick={() => setLeaseDeleteConfirm(req.id)} style={{ padding: '4px 10px', fontSize: 12, border: '1px solid var(--color-danger-border)', borderRadius: 'var(--radius-sm)', backgroundColor: '#fff', color: 'var(--color-danger)', cursor: 'pointer' }}>Delete</button>}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Delete confirmation */}
                {leaseDeleteConfirm != null && (
                  <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.5)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
                    <div style={{ backgroundColor: '#fff', borderRadius: 'var(--radius-lg)', padding: 28, maxWidth: 400, width: '100%', textAlign: 'center' }}>
                      <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 8 }}>Delete Lease Check</h3>
                      <p style={{ fontSize: 13, color: 'var(--color-text-secondary)', marginBottom: 20 }}>This cannot be undone.</p>
                      <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
                        <button onClick={() => setLeaseDeleteConfirm(null)} style={{ padding: '8px 20px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', backgroundColor: '#fff', cursor: 'pointer', fontSize: 14 }}>Cancel</button>
                        <button onClick={() => handleLeaseDelete(leaseDeleteConfirm)} style={{ padding: '8px 20px', backgroundColor: 'var(--color-danger)', color: '#fff', border: 'none', borderRadius: 'var(--radius-sm)', cursor: 'pointer', fontSize: 14, fontWeight: 600 }}>Delete</button>
                      </div>
                    </div>
                  </div>
                )}
              </>
            )}

            {/* ── Create View ── */}
            {leaseView === 'create' && (
              <>
                {/* Role toggle */}
                <div style={{ display: 'flex', gap: 0, marginBottom: 16, borderRadius: 'var(--radius-sm)', overflow: 'hidden', border: '1px solid var(--color-border)', maxWidth: 260 }}>
                  {(['tenant', 'landlord'] as const).map(r => (
                    <button key={r} onClick={() => setLeaseFormRole(r)} style={{ flex: 1, padding: '6px 12px', border: 'none', fontSize: 12, fontWeight: 600, cursor: 'pointer', backgroundColor: leaseFormRole === r ? 'var(--color-primary)' : '#fff', color: leaseFormRole === r ? '#fff' : 'var(--color-text)' }}>
                      {r === 'tenant' ? 'As Tenant' : 'As Landlord'}
                    </button>
                  ))}
                </div>

                {leaseCreateStep === 1 && (
                  <>
                    <div style={{ marginBottom: 12 }}>
                      <label style={labelStyle}>Paste Lease Insurance Clause</label>
                      <textarea
                        style={{ ...inputStyle, minHeight: 140, lineHeight: 1.6 }}
                        value={leaseClauseText}
                        onChange={e => setLeaseClauseText(e.target.value)}
                        placeholder="Paste the insurance requirements section from your lease here..."
                      />
                    </div>
                    <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                      <button onClick={handleLeaseExtractText} disabled={leaseExtracting || !leaseClauseText.trim()} style={{ padding: '8px 20px', backgroundColor: 'var(--color-primary)', color: '#fff', border: 'none', borderRadius: 'var(--radius-sm)', fontWeight: 600, fontSize: 13, cursor: leaseExtracting ? 'wait' : 'pointer', opacity: leaseExtracting ? 0.7 : 1 }}>
                        {leaseExtracting ? 'Extracting...' : 'Extract Requirements'}
                      </button>
                      <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>or</span>
                      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                        <input ref={leasePdfRef} type="file" accept=".pdf" style={{ fontSize: 12 }} />
                        <button onClick={handleLeaseExtractPdf} disabled={leaseExtracting} style={{ padding: '8px 14px', backgroundColor: '#2563eb', color: '#fff', border: 'none', borderRadius: 'var(--radius-sm)', fontWeight: 600, fontSize: 12, cursor: leaseExtracting ? 'wait' : 'pointer', opacity: leaseExtracting ? 0.7 : 1, whiteSpace: 'nowrap' }}>
                          Upload PDF
                        </button>
                      </div>
                    </div>
                    {leaseExtracting && <p style={{ fontSize: 12, color: '#2563eb', marginTop: 8, fontStyle: 'italic' }}>Analyzing lease clause...</p>}
                  </>
                )}

                {leaseCreateStep === 2 && (
                  <>
                    {leaseExtraction?.raw_summary && (
                      <div style={{ padding: 12, backgroundColor: '#f0f9ff', border: '1px solid #bfdbfe', borderRadius: 'var(--radius-sm)', marginBottom: 14, fontSize: 12, lineHeight: 1.6, color: '#1e40af' }}>
                        {leaseExtraction.raw_summary}
                      </div>
                    )}
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 12 }}>
                      <div>
                        <label style={labelStyle}>Label *</label>
                        <input style={inputStyle} value={leaseFormLabel} onChange={e => setLeaseFormLabel(e.target.value)} placeholder="e.g. 123 Main St Lease" />
                      </div>
                      <div>
                        <label style={labelStyle}>Property Address</label>
                        <input style={inputStyle} value={leaseFormPropertyAddress} onChange={e => setLeaseFormPropertyAddress(e.target.value)} placeholder="Optional" />
                      </div>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 14 }}>
                      <div>
                        <label style={labelStyle}>{leaseFormRole === 'tenant' ? 'Landlord Name' : 'Tenant Name'}</label>
                        <input style={inputStyle} value={leaseFormCounterpartyName} onChange={e => setLeaseFormCounterpartyName(e.target.value)} placeholder="Optional" />
                      </div>
                      <div>
                        <label style={labelStyle}>{leaseFormRole === 'tenant' ? 'Landlord Email' : 'Tenant Email'}</label>
                        <input style={inputStyle} type="email" value={leaseFormCounterpartyEmail} onChange={e => setLeaseFormCounterpartyEmail(e.target.value)} placeholder="Optional" />
                      </div>
                    </div>

                    <div style={{ marginBottom: 14 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                        <label style={{ ...labelStyle, marginBottom: 0 }}>Requirements ({leaseEditableReqs.length})</label>
                        <button onClick={() => setLeaseEditableReqs(prev => [...prev, { category: 'other', requirement_type: 'other', required_value: null, label: '', notes: null }])} style={{ fontSize: 11, color: 'var(--color-primary)', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 600 }}>+ Add</button>
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                        {leaseEditableReqs.map((req, idx) => {
                          const cc = CATEGORY_COLORS[req.category] || CATEGORY_COLORS.other;
                          return (
                            <div key={idx} style={{ border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', padding: 10, backgroundColor: '#fff' }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                <span style={{ padding: '1px 6px', borderRadius: 10, fontSize: 10, fontWeight: 600, backgroundColor: cc.bg, color: cc.fg }}>{CATEGORY_LABELS[req.category] || req.category}</span>
                                <input
                                  style={{ ...inputStyle, flex: 1, padding: '4px 8px', fontSize: 12 }}
                                  value={req.label}
                                  onChange={e => { const u = [...leaseEditableReqs]; u[idx] = { ...u[idx], label: e.target.value }; setLeaseEditableReqs(u); }}
                                  placeholder="Requirement label"
                                />
                                <button onClick={() => setLeaseEditableReqs(prev => prev.filter((_, i) => i !== idx))} style={{ background: 'none', border: 'none', color: 'var(--color-danger)', cursor: 'pointer', fontSize: 14, padding: '0 4px' }}>&times;</button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>

                    <div style={{ display: 'flex', gap: 8 }}>
                      <button onClick={() => setLeaseCreateStep(1)} style={{ padding: '8px 16px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', backgroundColor: '#fff', cursor: 'pointer', fontSize: 13 }}>Back</button>
                      <button onClick={handleLeaseSaveAndCheck} disabled={leaseSaving} style={{ padding: '8px 20px', backgroundColor: 'var(--color-primary)', color: '#fff', border: 'none', borderRadius: 'var(--radius-sm)', fontWeight: 600, fontSize: 13, cursor: leaseSaving ? 'wait' : 'pointer', opacity: leaseSaving ? 0.7 : 1 }}>
                        {leaseSaving ? 'Saving...' : 'Save & Check'}
                      </button>
                    </div>
                  </>
                )}
              </>
            )}

            {/* ── Results View ── */}
            {leaseView === 'results' && leaseActiveReqId && (() => {
              const activeReq = leaseReqs.find(r => r.id === leaseActiveReqId);
              return (
                <>
                  <div style={{ marginBottom: 16 }}>
                    <h3 style={{ fontSize: 15, fontWeight: 700, margin: '0 0 4px' }}>{activeReq?.label || 'Results'}</h3>
                    {activeReq?.property_address && <p style={{ fontSize: 12, color: 'var(--color-text-secondary)', margin: '0 0 4px' }}>{activeReq.property_address}</p>}
                    {leaseCheckedAgainst && (
                      <p style={{ fontSize: 12, color: 'var(--color-text-muted)', margin: 0, fontStyle: 'italic' }}>
                        Checked against: {leaseCheckedAgainst}
                      </p>
                    )}
                  </div>

                  {/* Summary counts */}
                  <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
                    {[
                      { label: 'Pass', count: leaseCheckCounts.pass, color: '#166534', bg: '#dcfce7' },
                      { label: 'Fail', count: leaseCheckCounts.fail, color: '#991b1b', bg: '#fee2e2' },
                      { label: 'Unclear', count: leaseCheckCounts.unclear, color: '#92400e', bg: '#fef3c7' },
                    ].map(s => (
                      <div key={s.label} style={{ padding: '8px 16px', borderRadius: 'var(--radius-sm)', backgroundColor: s.bg, minWidth: 70, textAlign: 'center' }}>
                        <div style={{ fontSize: 20, fontWeight: 700, color: s.color }}>{s.count}</div>
                        <div style={{ fontSize: 11, fontWeight: 600, color: s.color }}>{s.label}</div>
                      </div>
                    ))}
                  </div>

                  {/* Results checklist */}
                  {leaseChecking ? (
                    <div style={{ padding: 24, textAlign: 'center', color: 'var(--color-text-secondary)', fontSize: 13 }}>Running compliance check...</div>
                  ) : leaseResults.length > 0 ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 16 }}>
                      {leaseResults.map((r, i) => {
                        const si = STATUS_ICONS[r.status] || STATUS_ICONS.unclear;
                        const cc = CATEGORY_COLORS[r.category] || CATEGORY_COLORS.other;
                        return (
                          <div key={i} style={{ border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', padding: 12, backgroundColor: '#fff' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                              <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 20, height: 20, borderRadius: '50%', backgroundColor: si.bg, color: si.color, fontSize: 11, fontWeight: 700 }}>{si.icon}</span>
                              <span style={{ padding: '1px 6px', borderRadius: 10, fontSize: 10, fontWeight: 600, backgroundColor: cc.bg, color: cc.fg }}>{CATEGORY_LABELS[r.category] || r.category}</span>
                              <span style={{ fontSize: 13, fontWeight: 600, flex: 1 }}>{r.requirement_label}</span>
                            </div>
                            {r.note && <p style={{ fontSize: 12, color: 'var(--color-text-secondary)', margin: '2px 0 0 28px', lineHeight: 1.5 }}>{r.note}</p>}
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div style={{ padding: 24, textAlign: 'center', color: 'var(--color-text-secondary)' }}>
                      <p style={{ fontSize: 13, margin: '0 0 10px' }}>No results yet.</p>
                      <button onClick={() => leaseActiveReqId && handleLeaseRecheck(leaseActiveReqId)} className="btn btn-primary">Run Check</button>
                    </div>
                  )}

                  {/* Action buttons */}
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: leaseResults.length > 0 ? 0 : 8 }}>
                    <button onClick={() => leaseActiveReqId && handleLeaseRecheck(leaseActiveReqId)} disabled={leaseChecking} style={{ padding: '6px 14px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', backgroundColor: '#fff', cursor: 'pointer', fontWeight: 600, fontSize: 12 }}>
                      {leaseResults.length > 0 ? 'Re-check Policy' : 'Check Policy'}
                    </button>
                    {/* Check against certificate(s) */}
                    {policyCertificates.map(cert => (
                      <button
                        key={cert.id}
                        onClick={async () => {
                          if (!leaseActiveReqId) return;
                          setLeaseChecking(true);
                          try {
                            const check = await leaseComplianceApi.runCheck(leaseActiveReqId, 'certificate', { certificateId: cert.id });
                            setLeaseResults(check.results || []);
                            setLeaseCheckCounts({ pass: check.pass_count, fail: check.fail_count, unclear: check.unclear_count });
                            setLeaseCheckedAgainst(`${cert.counterparty_name || 'Certificate'} (${cert.direction === 'issued' ? 'shared' : 'received'}${cert.coverage_types ? ' — ' + cert.coverage_types : ''})`);
                            toast(`Checked against ${cert.counterparty_name || 'certificate'}`);
                          } catch (err: any) {
                            toast(err.message || 'Certificate check failed', 'error');
                          } finally {
                            setLeaseChecking(false);
                          }
                        }}
                        disabled={leaseChecking}
                        style={{ padding: '6px 14px', backgroundColor: '#7c3aed', color: '#fff', border: 'none', borderRadius: 'var(--radius-sm)', cursor: 'pointer', fontWeight: 600, fontSize: 12 }}
                        title={`Check against ${cert.counterparty_name}'s certificate${cert.coverage_types ? ' (' + cert.coverage_types + ')' : ''}`}
                      >
                        Check vs {cert.counterparty_name || `Certificate #${cert.id}`}
                      </button>
                    ))}
                    {leaseResults.length > 0 && (
                      <button onClick={() => leaseActiveReqId && handleLeaseBrokerEmail(leaseActiveReqId)} style={{ padding: '6px 14px', backgroundColor: '#2563eb', color: '#fff', border: 'none', borderRadius: 'var(--radius-sm)', fontWeight: 600, cursor: 'pointer', fontSize: 12 }}>Send to Broker</button>
                    )}
                    {activeReq && <button onClick={() => handleLeaseShare(activeReq)} style={{ padding: '6px 14px', backgroundColor: 'var(--color-primary)', color: '#fff', border: 'none', borderRadius: 'var(--radius-sm)', fontWeight: 600, cursor: 'pointer', fontSize: 12 }}>Share / Send to Tenant</button>}
                    {activeReq && (
                      <button onClick={() => { const url = getLeaseShareUrl(activeReq.access_code); window.open(url + '?print=1', '_blank'); }} style={{ padding: '6px 14px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', backgroundColor: '#fff', cursor: 'pointer', fontWeight: 600, fontSize: 12 }}>Print</button>
                    )}
                  </div>
                </>
              );
            })()}

            {/* Broker Email Modal */}
            {leaseBrokerModal && (
              <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.5)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
                <div style={{ backgroundColor: '#fff', borderRadius: 'var(--radius-lg)', padding: 28, maxWidth: 600, width: '100%', maxHeight: '90vh', overflowY: 'auto' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
                    <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>Send to Broker</h2>
                    <button onClick={() => setLeaseBrokerModal(false)} style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: 'var(--color-text-muted)' }}>&times;</button>
                  </div>
                  {leaseLoadingBroker ? (
                    <p style={{ color: 'var(--color-text-secondary)', textAlign: 'center', padding: 20 }}>Generating email...</p>
                  ) : leaseBrokerEmail ? (
                    <>
                      {leaseBrokerEmail.broker_name ? (
                        <div style={{ marginBottom: 12 }}>
                          <label style={labelStyle}>Broker (from policy contacts)</label>
                          <p style={{ fontSize: 14, margin: 0 }}>{leaseBrokerEmail.broker_name} {leaseBrokerEmail.broker_email && `(${leaseBrokerEmail.broker_email})`}</p>
                        </div>
                      ) : (
                        <div style={{ marginBottom: 12, padding: 12, backgroundColor: '#fef3c7', borderRadius: 'var(--radius-sm)', fontSize: 13, color: '#92400e' }}>
                          No broker found on this policy. You can add a broker contact above in the Contacts section, or enter an email below.
                        </div>
                      )}

                      {/* Manual broker email entry when no broker on file */}
                      {!leaseBrokerEmail.broker_email && (
                        <div style={{ marginBottom: 12 }}>
                          <label style={labelStyle}>Broker Email</label>
                          <input
                            style={inputStyle}
                            type="email"
                            placeholder="broker@example.com"
                            id="lease-broker-email-input"
                          />
                        </div>
                      )}

                      <div style={{ marginBottom: 12 }}>
                        <label style={labelStyle}>Subject</label>
                        <input style={inputStyle} readOnly value={leaseBrokerEmail.subject} />
                      </div>
                      <div style={{ marginBottom: 20 }}>
                        <label style={labelStyle}>Email Body</label>
                        <textarea style={{ ...inputStyle, minHeight: 180, fontFamily: 'monospace', fontSize: 12, lineHeight: 1.6 }} readOnly value={leaseBrokerEmail.body} />
                      </div>
                      <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
                        <button onClick={() => { navigator.clipboard.writeText(leaseBrokerEmail!.body); toast('Copied to clipboard'); }} style={{ padding: '8px 20px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', backgroundColor: '#fff', cursor: 'pointer', fontSize: 14 }}>Copy</button>
                        <a
                          href="#"
                          onClick={(e) => {
                            e.preventDefault();
                            const emailTo = leaseBrokerEmail!.broker_email || (document.getElementById('lease-broker-email-input') as HTMLInputElement | null)?.value || '';
                            if (!emailTo) { toast('Enter a broker email address', 'error'); return; }
                            window.location.href = `mailto:${emailTo}?subject=${encodeURIComponent(leaseBrokerEmail!.subject)}&body=${encodeURIComponent(leaseBrokerEmail!.body)}`;
                          }}
                          style={{ display: 'inline-block', padding: '8px 20px', backgroundColor: 'var(--color-primary)', color: '#fff', borderRadius: 'var(--radius-sm)', fontWeight: 600, textDecoration: 'none', fontSize: 14, cursor: 'pointer' }}
                        >
                          Open in Email
                        </a>
                      </div>
                    </>
                  ) : null}
                </div>
              </div>
            )}

            {/* Share / Send to Tenant Modal */}
            {leaseShareModal && leaseShareReq && (
              <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.5)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
                <div style={{ backgroundColor: '#fff', borderRadius: 'var(--radius-lg)', padding: 28, maxWidth: 480, width: '100%' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
                    <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>Share Requirements</h2>
                    <button onClick={() => setLeaseShareModal(false)} style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: 'var(--color-text-muted)' }}>&times;</button>
                  </div>

                  {/* Copy link */}
                  <div style={{ marginBottom: 16 }}>
                    <label style={labelStyle}>Public Link</label>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <input style={{ ...inputStyle, flex: 1 }} readOnly value={getLeaseShareUrl(leaseShareReq.access_code)} />
                      <button onClick={() => { navigator.clipboard.writeText(getLeaseShareUrl(leaseShareReq!.access_code)); setLeaseCopiedLink(true); toast('Link copied'); }} style={{ padding: '8px 14px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', backgroundColor: leaseCopiedLink ? '#dcfce7' : '#fff', cursor: 'pointer', fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap' }}>
                        {leaseCopiedLink ? 'Copied!' : 'Copy'}
                      </button>
                    </div>
                  </div>

                  {/* Send to tenant by email (landlord flow) */}
                  {leaseShareReq.role === 'landlord' && (
                    <>
                      <div style={{ borderTop: '1px solid var(--color-border)', paddingTop: 16, marginBottom: 12 }}>
                        <label style={labelStyle}>Email to Tenant</label>
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
                        <div>
                          <label style={labelStyle}>Tenant Name</label>
                          <input style={inputStyle} value={leaseTenantName} onChange={e => setLeaseTenantName(e.target.value)} placeholder="Optional" />
                        </div>
                        <div>
                          <label style={labelStyle}>Tenant Email *</label>
                          <input style={inputStyle} type="email" value={leaseTenantEmail} onChange={e => setLeaseTenantEmail(e.target.value)} placeholder="tenant@example.com" />
                        </div>
                      </div>
                      <div style={{ marginBottom: 12 }}>
                        <label style={labelStyle}>Notes (included in email)</label>
                        <textarea
                          style={{ ...inputStyle, minHeight: 60, resize: 'vertical' }}
                          value={leaseTenantNotes}
                          onChange={e => setLeaseTenantNotes(e.target.value)}
                          placeholder="e.g., Please have this updated before March 15th"
                        />
                      </div>
                      <button
                        onClick={async () => {
                          if (!leaseTenantEmail.trim()) { toast('Email is required', 'error'); return; }
                          setLeaseSending(true);
                          try {
                            await leaseComplianceApi.sendToTenant(leaseShareReq!.id, leaseTenantEmail, leaseTenantName || undefined, leaseTenantNotes || undefined);
                            toast('Requirements sent to tenant');
                            setLeaseShareModal(false);
                            leaseComplianceApi.list(undefined, policyId).then(setLeaseReqs).catch(() => {});
                          } catch (err: any) {
                            toast(err.message || 'Failed to send', 'error');
                          } finally {
                            setLeaseSending(false);
                          }
                        }}
                        disabled={leaseSending || !leaseTenantEmail.trim()}
                        style={{ padding: '10px 20px', backgroundColor: 'var(--color-primary)', color: '#fff', border: 'none', borderRadius: 'var(--radius-md)', fontWeight: 600, cursor: leaseSending ? 'wait' : 'pointer', fontSize: 14, opacity: leaseSending ? 0.7 : 1 }}
                      >
                        {leaseSending ? 'Sending...' : 'Send to Tenant'}
                      </button>
                    </>
                  )}
                </div>
              </div>
            )}
          </div>
        );
      })()}

      {/* Contacts */}
      <div className="card" style={{ marginBottom: 32 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 12 }}>
          <h2 className="section-title" style={{ margin: 0 }}>Contacts</h2>
          {canEdit && (
            <button onClick={() => setShowContactForm(!showContactForm)} className="btn btn-primary">
              {showContactForm ? 'Cancel' : '+ Add Contact'}
            </button>
          )}
        </div>

        {showContactForm && (
          <form onSubmit={handleAddContact} style={{ padding: 16, marginBottom: 16, backgroundColor: 'var(--color-bg)', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)' }}>
            <div className="form-grid-2" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div>
                <label style={labelStyle}>Role</label>
                <select value={contactForm.role} onChange={e => setContactForm({ ...contactForm, role: e.target.value })} style={inputStyle}>
                  {['broker', 'agent', 'claims', 'underwriter', 'customer_service', 'named_insured', 'other'].map(r => <option key={r} value={r}>{r.replace(/_/g, ' ')}</option>)}
                </select>
              </div>
              <div>
                <label style={labelStyle}>Name</label>
                <input value={contactForm.name ?? ''} onChange={e => setContactForm({ ...contactForm, name: e.target.value })} style={inputStyle} />
              </div>
              <div>
                <label style={labelStyle}>Company</label>
                <input value={contactForm.company ?? ''} onChange={e => setContactForm({ ...contactForm, company: e.target.value })} style={inputStyle} />
              </div>
              <div>
                <label style={labelStyle}>Phone</label>
                <input value={contactForm.phone ?? ''} onChange={e => setContactForm({ ...contactForm, phone: e.target.value })} style={inputStyle} />
              </div>
              <div>
                <label style={labelStyle}>Email</label>
                <input type="email" value={contactForm.email ?? ''} onChange={e => setContactForm({ ...contactForm, email: e.target.value })} style={inputStyle} />
              </div>
              <div>
                <label style={labelStyle}>Notes</label>
                <input value={contactForm.notes ?? ''} onChange={e => setContactForm({ ...contactForm, notes: e.target.value })} style={inputStyle} />
              </div>
            </div>
            <button type="submit" className="btn btn-primary" style={{ marginTop: 12 }}>Save Contact</button>
          </form>
        )}

        {contacts.length === 0 ? (
          <p style={{ color: '#999', margin: 0 }}>No contacts yet.</p>
        ) : (
          <div style={{ display: 'grid', gap: 12 }}>
            {contacts.map(c => (
              <div key={c.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: 12, backgroundColor: '#fff', border: '1px solid #e5e7eb', borderRadius: 6 }}>
                <div>
                  <span style={{ display: 'inline-block', padding: '2px 8px', marginRight: 8, borderRadius: 4, fontSize: 11, fontWeight: 600, backgroundColor: '#e8e8e8', color: '#555', textTransform: 'uppercase' }}>{c.role}</span>
                  <strong>{c.name || c.company || 'Unnamed'}</strong>
                  {c.company && c.name && <span style={{ color: '#888' }}> - {c.company}</span>}
                  <div style={{ marginTop: 4, fontSize: 13, color: '#666' }}>
                    {c.phone && <span style={{ marginRight: 16 }}>Tel: <a href={`tel:${cleanPhone(c.phone)}`} style={{ color: 'var(--color-accent)', textDecoration: 'none' }}>{formatPhone(c.phone)}</a></span>}
                    {c.email && <span>Email: {c.email}</span>}
                  </div>
                  {c.notes && <div style={{ marginTop: 2, fontSize: 12, color: '#999' }}>{c.notes}</div>}
                </div>
                {canEdit && <button onClick={() => handleDeleteContact(c.id)} className="btn btn-danger">Delete</button>}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Coverage Items (Inclusions / Exclusions) */}
      <div className="card" style={{ marginBottom: 32 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 12 }}>
          <h2 className="section-title" style={{ margin: 0 }}>Inclusions &amp; Exclusions</h2>
          {canEdit && (
            <button onClick={() => setShowCoverageForm(!showCoverageForm)} className="btn btn-primary">
              {showCoverageForm ? 'Cancel' : '+ Add Item'}
            </button>
          )}
        </div>

        {showCoverageForm && (
          <form onSubmit={async (e) => { e.preventDefault(); try { await coverageApi.create(policyId, coverageForm); setShowCoverageForm(false); setCoverageForm({ item_type: 'inclusion', description: '', limit: '' }); setCoverageItems(await coverageApi.list(policyId)); } catch (err: any) { setError(err.message); } }} style={{ padding: 16, marginBottom: 16, backgroundColor: 'var(--color-bg)', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr 1fr', gap: 12 }}>
              <div>
                <label style={labelStyle}>Type</label>
                <select value={coverageForm.item_type} onChange={e => setCoverageForm({ ...coverageForm, item_type: e.target.value })} style={inputStyle}>
                  <option value="inclusion">Inclusion</option>
                  <option value="exclusion">Exclusion</option>
                </select>
              </div>
              <div>
                <label style={labelStyle}>Description</label>
                <input value={coverageForm.description} onChange={e => setCoverageForm({ ...coverageForm, description: e.target.value })} required style={inputStyle} />
              </div>
              <div>
                <label style={labelStyle}>Limit</label>
                <input value={coverageForm.limit ?? ''} onChange={e => setCoverageForm({ ...coverageForm, limit: e.target.value || null })} style={inputStyle} placeholder="e.g. $50,000" />
              </div>
            </div>
            <button type="submit" className="btn btn-primary" style={{ marginTop: 12 }}>Save</button>
          </form>
        )}

        {coverageItems.length === 0 ? (
          <p style={{ color: '#999', margin: 0 }}>No inclusions or exclusions yet.</p>
        ) : (
          <div style={{ display: 'grid', gap: 8 }}>
            {coverageItems.filter(ci => ci.item_type === 'inclusion').length > 0 && (
              <div>
                <h3 style={{ margin: '0 0 8px', fontSize: 14, color: '#166534' }}>Inclusions (Covered)</h3>
                {coverageItems.filter(ci => ci.item_type === 'inclusion').map(ci => (
                  <div key={ci.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: 10, marginBottom: 4, backgroundColor: '#f0fdf4', borderRadius: 4 }}>
                    <div>
                      <span style={{ fontSize: 14 }}>{ci.description}</span>
                      {ci.limit && <span style={{ marginLeft: 12, fontSize: 12, color: '#666' }}>Limit: {ci.limit}</span>}
                    </div>
                    {canEdit && <button onClick={async () => { await coverageApi.remove(policyId, ci.id); setCoverageItems(prev => prev.filter(x => x.id !== ci.id)); }} className="btn btn-danger">Delete</button>}
                  </div>
                ))}
              </div>
            )}
            {coverageItems.filter(ci => ci.item_type === 'exclusion').length > 0 && (
              <div style={{ marginTop: 8 }}>
                <h3 style={{ margin: '0 0 8px', fontSize: 14, color: '#991b1b' }}>Exclusions (Not Covered)</h3>
                {coverageItems.filter(ci => ci.item_type === 'exclusion').map(ci => (
                  <div key={ci.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: 10, marginBottom: 4, backgroundColor: '#fef2f2', borderRadius: 4 }}>
                    <span style={{ fontSize: 14 }}>{ci.description}</span>
                    {canEdit && <button onClick={async () => { await coverageApi.remove(policyId, ci.id); setCoverageItems(prev => prev.filter(x => x.id !== ci.id)); }} className="btn btn-danger">Delete</button>}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Score Contribution */}
      {policy && (() => {
        const TYPE_TO_CATEGORIES: Record<string, string[]> = {
          auto: ['Liability Protection', 'Property Protection'],
          home: ['Liability Protection', 'Property Protection', 'Catastrophic Protection'],
          renters: ['Liability Protection', 'Property Protection'],
          umbrella: ['Liability Protection', 'Catastrophic Protection'],
          liability: ['Liability Protection', 'Catastrophic Protection'],
          life: ['Income Protection'],
          disability: ['Income Protection'],
          flood: ['Catastrophic Protection'],
          earthquake: ['Catastrophic Protection'],
          general_liability: ['Liability Protection'],
          bop: ['Liability Protection', 'Property Protection'],
          professional_liability: ['Liability Protection'],
          commercial_property: ['Property Protection'],
        };
        const cats = TYPE_TO_CATEGORIES[(policy.policy_type || '').toLowerCase()] || [];
        if (cats.length === 0) return null;
        return (
          <div className="card" style={{ marginBottom: 32 }}>
            <h2 className="section-title" style={{ margin: '0 0 8px' }}>Score Contribution</h2>
            <div style={{ fontSize: 13, color: 'var(--color-text-secondary)', marginBottom: 12 }}>
              This policy contributes to your Coverage Health Score in:
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
              {cats.map(cat => (
                <span key={cat} style={{
                  padding: '4px 12px', fontSize: 12, fontWeight: 600,
                  backgroundColor: '#f0f9ff', color: '#0369a1',
                  borderRadius: 20, border: '1px solid #bae6fd',
                }}>
                  {cat}
                </span>
              ))}
            </div>
            <a
              href="/score"
              onClick={(e) => { e.preventDefault(); router.push('/score'); }}
              style={{ fontSize: 13, color: 'var(--color-primary)', fontWeight: 500, textDecoration: 'none' }}
            >
              View Full Score →
            </a>
          </div>
        );
      })()}

      {/* Policy Details (type-specific key-value fields) */}
      <div className="card" style={{ marginBottom: 32 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 12 }}>
          <h2 className="section-title" style={{ margin: 0 }}>Policy Details</h2>
          {canEdit && (
            <button onClick={toggleDetailForm} className="btn btn-primary">
              {showDetailForm ? 'Cancel' : '+ Add Detail'}
            </button>
          )}
        </div>

        {showDetailForm && (
          <form onSubmit={handleAddDetail} style={{ padding: 16, marginBottom: 16, backgroundColor: 'var(--color-bg)', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 12 }}>
              <div>
                <label style={labelStyle}>Field Name</label>
                {availableSuggestions.length > 0 ? (
                  <div>
                    <select
                      value={availableSuggestions.includes(detailForm.field_name) ? detailForm.field_name : '__custom'}
                      onChange={e => {
                        if (e.target.value === '__custom') {
                          setDetailForm({ ...detailForm, field_name: '' });
                        } else {
                          setDetailForm({ ...detailForm, field_name: e.target.value });
                        }
                      }}
                      style={inputStyle}
                    >
                      {availableSuggestions.map(f => <option key={f} value={f}>{f}</option>)}
                      <option value="__custom">Custom field...</option>
                    </select>
                    {!availableSuggestions.includes(detailForm.field_name) && (
                      <input value={detailForm.field_name} onChange={e => setDetailForm({ ...detailForm, field_name: e.target.value })} placeholder="Custom field name" style={{ ...inputStyle, marginTop: 8 }} required />
                    )}
                  </div>
                ) : (
                  <input value={detailForm.field_name} onChange={e => setDetailForm({ ...detailForm, field_name: e.target.value })} required style={inputStyle} />
                )}
              </div>
              <div>
                <label style={labelStyle}>Value</label>
                <input value={detailForm.field_value} onChange={e => setDetailForm({ ...detailForm, field_value: e.target.value })} required style={inputStyle} />
              </div>
            </div>
            <button type="submit" className="btn btn-primary" style={{ marginTop: 12 }}>Save Detail</button>
          </form>
        )}

        {details.length === 0 ? (
          <p style={{ color: '#999', margin: 0 }}>No details yet.</p>
        ) : (
          <div style={{ display: 'grid', gap: 8 }}>
            {details.map(d => (
              <div key={d.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: 10, backgroundColor: '#f5f3ff', borderRadius: 4 }}>
                <div>
                  <span style={{ fontSize: 13, fontWeight: 600, color: '#555', marginRight: 8 }}>{d.field_name}:</span>
                  <span style={{ fontSize: 14 }}>{d.field_value}</span>
                </div>
                {canEdit && <button onClick={() => handleDeleteDetail(d.id)} className="btn btn-danger">Delete</button>}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Claims */}
      <div className="card" style={{ marginBottom: 32 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 12 }}>
          <h2 className="section-title" style={{ margin: 0 }}>Track Claims</h2>
          {canEdit && (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <input
                type="file"
                ref={claimFileRef}
                accept=".pdf"
                style={{ display: 'none' }}
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  if (file.type !== 'application/pdf') {
                    toast('Only PDF files are accepted for claim extraction.', 'error');
                    return;
                  }
                  if (file.size > MAX_FILE_SIZE) {
                    toast('File size must be under 20 MB.', 'error');
                    return;
                  }
                  setClaimExtracting(true);
                  try {
                    const result = await claimsApi.extractFromPdf(policyId, file);
                    const ext = result.extraction;
                    setClaimForm({
                      claim_number: ext.claim_number || '',
                      status: ext.status || 'open',
                      date_filed: ext.date_filed || '',
                      description: ext.description || '',
                      date_resolved: ext.date_resolved || null,
                      amount_claimed: ext.amount_claimed || null,
                      amount_paid: ext.amount_paid || null,
                      notes: ext.notes || null,
                    });
                    setShowClaimForm(true);
                    toast('Claim data extracted — review and save', 'success');
                  } catch (err: any) {
                    toast(err.message || 'Extraction failed', 'error');
                  } finally {
                    setClaimExtracting(false);
                    if (claimFileRef.current) claimFileRef.current.value = '';
                  }
                }}
              />
              <button
                onClick={() => claimFileRef.current?.click()}
                className="btn btn-accent"
                disabled={claimExtracting}
                style={{ display: 'flex', alignItems: 'center', gap: 6 }}
              >
                {claimExtracting ? (
                  <><span className="spinner" style={{ width: 14, height: 14 }} /> Extracting...</>
                ) : (
                  '+ Upload & Extract'
                )}
              </button>
              <button onClick={() => { setShowClaimForm(!showClaimForm); if (showClaimForm) setClaimForm({ claim_number: '', status: 'open', date_filed: '', description: '' }); }} className="btn btn-primary">
                {showClaimForm ? 'Cancel' : '+ Add Manually'}
              </button>
            </div>
          )}
        </div>

        {showClaimForm && (
          <form onSubmit={async (e) => { e.preventDefault(); try { await claimsApi.create(policyId, claimForm); setShowClaimForm(false); setClaimForm({ claim_number: '', status: 'open', date_filed: '', description: '' }); setClaims(await claimsApi.list(policyId)); toast('Claim saved', 'success'); } catch (err: any) { setError(err.message); } }} style={{ padding: 16, marginBottom: 16, backgroundColor: 'var(--color-bg)', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)' }}>
            <div className="form-grid-2" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div>
                <label style={labelStyle}>Claim Number</label>
                <input value={claimForm.claim_number} onChange={e => setClaimForm({ ...claimForm, claim_number: e.target.value })} required style={inputStyle} />
              </div>
              <div>
                <label style={labelStyle}>Date Filed</label>
                <input type="date" value={claimForm.date_filed} onChange={e => setClaimForm({ ...claimForm, date_filed: e.target.value })} required style={inputStyle} />
              </div>
              <div>
                <label style={labelStyle}>Amount Claimed ($)</label>
                <input type="number" step="0.01" value={claimForm.amount_claimed ? claimForm.amount_claimed / 100 : ''} onChange={e => setClaimForm({ ...claimForm, amount_claimed: e.target.value ? Math.round(Number(e.target.value) * 100) : null })} style={inputStyle} />
              </div>
              <div>
                <label style={labelStyle}>Amount Paid ($)</label>
                <input type="number" step="0.01" value={claimForm.amount_paid ? claimForm.amount_paid / 100 : ''} onChange={e => setClaimForm({ ...claimForm, amount_paid: e.target.value ? Math.round(Number(e.target.value) * 100) : null })} style={inputStyle} />
              </div>
              <div>
                <label style={labelStyle}>Status</label>
                <select value={claimForm.status} onChange={e => setClaimForm({ ...claimForm, status: e.target.value })} style={inputStyle}>
                  {['open', 'in_progress', 'closed', 'denied'].map(s => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
                </select>
              </div>
              <div>
                <label style={labelStyle}>Date Resolved</label>
                <input type="date" value={claimForm.date_resolved || ''} onChange={e => setClaimForm({ ...claimForm, date_resolved: e.target.value || null })} style={inputStyle} />
              </div>
              <div style={{ gridColumn: 'span 2' }}>
                <label style={labelStyle}>Description</label>
                <input value={claimForm.description} onChange={e => setClaimForm({ ...claimForm, description: e.target.value })} required style={inputStyle} />
              </div>
              <div style={{ gridColumn: 'span 2' }}>
                <label style={labelStyle}>Notes</label>
                <input value={claimForm.notes || ''} onChange={e => setClaimForm({ ...claimForm, notes: e.target.value || null })} placeholder="Adjuster info, denial reason, etc." style={inputStyle} />
              </div>
            </div>
            <button type="submit" className="btn btn-primary" style={{ marginTop: 12 }}>Save Claim</button>
          </form>
        )}

        {claims.length === 0 ? (
          <p style={{ color: '#999', margin: 0 }}>No claims recorded yet. Upload a claim document or add one manually.</p>
        ) : (
          <div style={{ display: 'grid', gap: 8 }}>
            {claims.map(cl => {
              const statusColors: Record<string, { bg: string; fg: string }> = {
                open: { bg: '#dbeafe', fg: '#1e40af' },
                in_progress: { bg: '#ffedd5', fg: '#9a3412' },
                closed: { bg: '#d1fae5', fg: '#065f46' },
                denied: { bg: '#fee2e2', fg: '#991b1b' },
              };
              const sc = statusColors[cl.status] || { bg: '#f0f0f0', fg: '#555' };
              return (
                <div key={cl.id} style={{ padding: 12, backgroundColor: '#fafafa', borderRadius: 6, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                      <strong>#{cl.claim_number}</strong>
                      <span style={{ padding: '2px 8px', borderRadius: 4, fontSize: 11, fontWeight: 600, backgroundColor: sc.bg, color: sc.fg }}>{cl.status.replace('_', ' ')}</span>
                    </div>
                    <div style={{ fontSize: 13, color: '#666' }}>{cl.description}</div>
                    <div style={{ fontSize: 12, color: '#999', marginTop: 4 }}>
                      Filed: {cl.date_filed}
                      {cl.amount_claimed != null && <span style={{ marginLeft: 12 }}>Claimed: ${(cl.amount_claimed / 100).toFixed(2)}</span>}
                      {cl.amount_paid != null && <span style={{ marginLeft: 12 }}>Paid: ${(cl.amount_paid / 100).toFixed(2)}</span>}
                      {cl.date_resolved && <span style={{ marginLeft: 12 }}>Resolved: {cl.date_resolved}</span>}
                    </div>
                    {cl.notes && <div style={{ fontSize: 12, color: '#888', marginTop: 2, fontStyle: 'italic' }}>{cl.notes}</div>}
                  </div>
                  {canEdit && <button onClick={async () => { await claimsApi.remove(policyId, cl.id); setClaims(prev => prev.filter(x => x.id !== cl.id)); toast('Claim deleted', 'success'); }} className="btn btn-danger">Delete</button>}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Bottom back link */}
      <div style={{ marginTop: 32, paddingTop: 20, borderTop: '1px solid var(--color-border)', textAlign: 'center' }}>
        <button
          onClick={() => router.push('/policies')}
          style={{
            background: 'none', border: 'none', fontSize: 14, color: 'var(--color-text-secondary)',
            cursor: 'pointer', padding: '8px 16px',
          }}
        >
          &larr; Back to Policies
        </button>
      </div>

      {/* View Certificate Modal */}
      {viewingPolicyCert && (() => {
        const vc = viewingPolicyCert;
        const vcExpired = vc.status === 'expired';
        const vcExpiring = vc.status === 'expiring';
        const vcBadgeBg = vcExpired ? 'var(--color-danger-bg)' : vcExpiring ? 'var(--color-warning-bg)' : 'var(--color-success-bg)';
        const vcBadgeColor = vcExpired ? 'var(--color-danger)' : vcExpiring ? 'var(--color-warning)' : 'var(--color-success)';
        return (
          <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.5)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
            <div style={{ backgroundColor: '#fff', borderRadius: 'var(--radius-lg)', padding: 28, maxWidth: 560, width: '100%', maxHeight: '90vh', overflowY: 'auto' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
                <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>Certificate Details</h2>
                <button onClick={() => setViewingPolicyCert(null)} style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: 'var(--color-text-muted)', padding: 0, lineHeight: 1 }}>&times;</button>
              </div>

              <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
                <span style={{
                  padding: '3px 12px', borderRadius: 12, fontSize: 12, fontWeight: 600,
                  backgroundColor: vc.direction === 'issued' ? '#dbeafe' : '#fce7f3',
                  color: vc.direction === 'issued' ? '#1e40af' : '#9d174d',
                }}>
                  {vc.direction === 'issued' ? 'Shared (outgoing)' : 'Received (incoming)'}
                </span>
                <span style={{ padding: '3px 12px', borderRadius: 12, fontSize: 12, fontWeight: 600, backgroundColor: vcBadgeBg, color: vcBadgeColor }}>
                  {vc.status}
                </span>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 20 }}>
                <div>
                  <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text-secondary)', marginBottom: 4 }}>Counterparty</div>
                  <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--color-text)' }}>{vc.counterparty_name}</div>
                </div>
                <div>
                  <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text-secondary)', marginBottom: 4 }}>Type</div>
                  <div style={{ fontSize: 15, color: 'var(--color-text)' }}>{vc.counterparty_type}</div>
                </div>
              </div>

              {vc.counterparty_email && (
                <div style={{ marginBottom: 20 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text-secondary)', marginBottom: 4 }}>Email</div>
                  <div style={{ fontSize: 14, color: 'var(--color-text)' }}>{vc.counterparty_email}</div>
                </div>
              )}

              {(vc.carrier || vc.policy_number) && (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 20 }}>
                  {vc.carrier && <div>
                    <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text-secondary)', marginBottom: 4 }}>Carrier</div>
                    <div style={{ fontSize: 14, color: 'var(--color-text)' }}>{vc.carrier}</div>
                  </div>}
                  {vc.policy_number && <div>
                    <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text-secondary)', marginBottom: 4 }}>Policy #</div>
                    <div style={{ fontSize: 14, color: 'var(--color-text)' }}>{vc.policy_number}</div>
                  </div>}
                </div>
              )}

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

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16, marginBottom: 20 }}>
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

              <div style={{ display: 'flex', gap: 20, marginBottom: 20 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
                  <span style={{ color: vc.additional_insured ? '#166534' : 'var(--color-text-muted)', fontSize: 16 }}>{vc.additional_insured ? '\u2713' : '\u2717'}</span>
                  <span style={{ color: vc.additional_insured ? '#166534' : 'var(--color-text-muted)', fontWeight: vc.additional_insured ? 600 : 400 }}>Additional Insured</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
                  <span style={{ color: vc.waiver_of_subrogation ? '#166534' : 'var(--color-text-muted)', fontSize: 16 }}>{vc.waiver_of_subrogation ? '\u2713' : '\u2717'}</span>
                  <span style={{ color: vc.waiver_of_subrogation ? '#166534' : 'var(--color-text-muted)', fontWeight: vc.waiver_of_subrogation ? 600 : 400 }}>Waiver of Subrogation</span>
                </div>
              </div>

              {vc.notes && (
                <div style={{ marginBottom: 20 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text-secondary)', marginBottom: 4 }}>Notes</div>
                  <div style={{ fontSize: 14, color: 'var(--color-text)', lineHeight: 1.6, fontStyle: 'italic' }}>{vc.notes}</div>
                </div>
              )}

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, borderTop: '1px solid var(--color-border)', paddingTop: 16 }}>
                <button onClick={() => setViewingPolicyCert(null)} style={{ padding: '8px 20px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', backgroundColor: '#fff', cursor: 'pointer', fontSize: 14 }}>Close</button>
                <button onClick={() => { setViewingPolicyCert(null); router.push('/certificates'); }} style={{ padding: '8px 20px', backgroundColor: 'var(--color-primary)', color: '#fff', border: 'none', borderRadius: 'var(--radius-sm)', fontWeight: 600, cursor: 'pointer', fontSize: 14 }}>Edit</button>
              </div>
            </div>
          </div>
        );
      })()}

    </div>
  );
}

function docTypeBg(dt: string) {
  switch (dt) {
    case 'insurance_card': return '#e6f0ff';
    case 'endorsement': return '#f0e6ff';
    case 'policy': return '#e6ffe6';
    default: return '#f0f0f0';
  }
}
function docTypeFg(dt: string) {
  switch (dt) {
    case 'insurance_card': return '#0050b3';
    case 'endorsement': return '#6b21a8';
    case 'policy': return '#166534';
    default: return '#555';
  }
}
function statusBg(s: string) {
  switch (s) {
    case 'done': return '#d1fae5';
    case 'review': return '#dbeafe';
    case 'pending': return '#fef9c3';
    case 'failed': return '#fee2e2';
    default: return '#f0f0f0';
  }
}
function statusFg(s: string) {
  switch (s) {
    case 'done': return '#065f46';
    case 'review': return '#1e40af';
    case 'pending': return '#854d0e';
    case 'failed': return '#991b1b';
    default: return '#555';
  }
}

const labelStyle: React.CSSProperties = { display: 'block', marginBottom: 4, fontSize: 13, fontWeight: 500, color: 'var(--color-text-secondary)' };
const inputStyle: React.CSSProperties = { width: '100%', padding: '8px 12px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', fontSize: 14, boxSizing: 'border-box', fontFamily: 'var(--font-sans)', color: 'var(--color-text)' };
const inputStyleSm: React.CSSProperties = { width: '100%', padding: '6px 8px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', fontSize: 13, boxSizing: 'border-box', fontFamily: 'var(--font-sans)', color: 'var(--color-text)' };
