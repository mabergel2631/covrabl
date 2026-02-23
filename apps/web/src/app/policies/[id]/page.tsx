'use client';

import { useState, useEffect, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useAuth } from '../../../../lib/auth';
import { policiesApi, contactsApi, documentsApi, coverageApi, policyDetailsApi, claimsApi, sharingApi, exportApi, premiumHistoryApi, exposuresApi, gapsApi, certificatesApi, Policy, Contact, DocMeta, ContactCreate, ExtractionData, CoverageItem, CoverageItemCreate, PolicyDetail, PolicyDetailCreate, PolicyUpdate, Claim, ClaimCreate, PolicyShareType, ShareCreate, PremiumHistoryEntry, Exposure, CoverageGap, Certificate } from '../../../../lib/api';
import { useToast } from '../../components/Toast';
import { Skeleton } from '../../components/Skeleton';
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
};

export default function PolicyDetailPage() {
  const { id } = useParams();
  const policyId = Number(id);
  const { token, logout } = useAuth();
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

  // Claims quick-start
  const [copiedPolicyNumber, setCopiedPolicyNumber] = useState(false);

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
      const [p, c, d, cv, det, cl, sh, ph, exp, gapsResult, certs] = await Promise.all([
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

  const handleUpload = async () => {
    const file = fileRef.current?.files?.[0];
    if (!file) return;
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
        xhr.open('POST', '/api/files/direct-upload');
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
      if (err.message?.includes('authentication') || err.message?.includes('api_key')) {
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
    <div style={{ maxWidth: 960, margin: '0 auto', padding: 24 }}>
      {/* Back Navigation */}
      <button
        onClick={() => { if (window.history.length > 1) router.back(); else router.push('/policies'); }}
        className="btn btn-ghost"
        style={{ padding: '4px 0', fontSize: 14, color: 'var(--color-text-secondary)', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 6 }}
      >
        <span style={{ fontSize: 18, lineHeight: 1 }}>&larr;</span> Back
      </button>

      {error && <div className="alert alert-error">{error}</div>}

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
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 }}>
              <div style={{ minWidth: 0, flex: 1 }}>
                <h1 style={{ margin: '0 0 4px', fontSize: 22, fontWeight: 700, color: 'var(--color-primary)', wordBreak: 'break-word' }}>
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
                  <button
                    onClick={() => setShowShareForm(!showShareForm)}
                    className="btn btn-outline"
                    style={{ padding: '4px 12px', fontSize: 12 }}
                  >
                    {showShareForm ? 'Cancel' : shares.length > 0 ? 'Manage Access' : 'Share'}
                  </button>
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <span className={`badge badge-${policy.scope}`}>{policy.scope}</span>
                <button onClick={() => setShowIdCard(!showIdCard)} className="btn btn-outline">{showIdCard ? 'Hide Card' : 'ID Card'}</button>
                <button onClick={() => exportApi.singlePolicy(policyId)} className="btn btn-outline">Export CSV</button>
                <button onClick={startEdit} className="btn btn-primary">Edit Policy</button>
              </div>
            </div>

            {/* Inline Share Form - appears below header when toggled */}
            {showShareForm && (
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

      {/* ID Card */}
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
          <div className="card" style={{ marginBottom: 24, padding: 0, overflow: 'hidden', maxWidth: 420 }}>
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
                  <span style={{ color: 'var(--color-accent)', fontWeight: 500 }}>{claimsPhone}</span>
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

      {/* Deductible Tracking - Only show if policy has a deductible */}
      {policy.deductible && policy.deductible > 0 && (
        <div className="card" style={{ marginBottom: 32 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <h2 className="section-title" style={{ margin: 0 }}>Deductible Tracking</h2>
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
              href={`tel:${claimsContact.phone.replace(/[^\d+]/g, '')}`}
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
              📞 Call Claims: {claimsContact.phone}
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
      {(premiumHistory.length > 0 || policy.premium_amount) && (
        <div className="card" style={{ marginBottom: 32 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <div>
              <h2 className="section-title" style={{ margin: 0 }}>Premium History</h2>
              {premiumHistoryChange !== 0 && (
                <p style={{ margin: '4px 0 0', fontSize: 13, color: premiumHistoryChange > 0 ? 'var(--color-danger)' : 'var(--color-success)' }}>
                  {premiumHistoryChange > 0 ? '↑' : '↓'} {Math.abs(premiumHistoryChange)}% total change
                </p>
              )}
            </div>
            <button
              onClick={() => setShowAddPremiumHistory(!showAddPremiumHistory)}
              className="btn btn-outline"
              style={{ padding: '6px 12px', fontSize: 13 }}
            >
              {showAddPremiumHistory ? 'Cancel' : '+ Add Entry'}
            </button>
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
        <div style={{ display: 'flex', gap: 8, marginBottom: 16, alignItems: 'center', flexWrap: 'wrap' }}>
          <select value={docType} onChange={e => setDocType(e.target.value)} style={{ padding: '8px 10px', border: '1px solid #ddd', borderRadius: 4, fontSize: 13 }}>
            {DOC_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
          <input ref={fileRef} type="file" style={{ fontSize: 14, minWidth: 0 }} />
          <button onClick={handleUpload} disabled={uploading} className="btn btn-accent">
            {uploading ? 'Uploading...' : 'Upload'}
          </button>
        </div>

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
                  {d.content_type === 'application/pdf' && d.extraction_status !== 'pending' && (
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
                      {d.content_type === 'application/pdf' && d.extraction_status !== 'pending' && (
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
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h2 className="section-title" style={{ margin: 0 }}>Certificates of Insurance</h2>
          <button onClick={() => router.push('/certificates')} className="btn btn-primary">+ Issue COI</button>
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
                <div key={cert.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: 14, backgroundColor: '#fff', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)' }}>
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                      <span style={{ fontSize: 14, fontWeight: 600 }}>{cert.counterparty_name || 'Unnamed'}</span>
                      <span style={{ padding: '1px 8px', borderRadius: 10, fontSize: 11, fontWeight: 600, backgroundColor: '#e8e8e8', color: '#555', textTransform: 'uppercase' }}>
                        {cert.direction === 'issued' ? 'Issued' : 'Received'}
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
                  <button onClick={() => router.push(`/certificates`)} className="btn btn-outline" style={{ fontSize: 12, padding: '4px 12px' }}>View</button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Contacts */}
      <div className="card" style={{ marginBottom: 32 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h2 className="section-title" style={{ margin: 0 }}>Contacts</h2>
          <button onClick={() => setShowContactForm(!showContactForm)} className="btn btn-primary">
            {showContactForm ? 'Cancel' : '+ Add Contact'}
          </button>
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
                    {c.phone && <span style={{ marginRight: 16 }}>Tel: {c.phone}</span>}
                    {c.email && <span>Email: {c.email}</span>}
                  </div>
                  {c.notes && <div style={{ marginTop: 2, fontSize: 12, color: '#999' }}>{c.notes}</div>}
                </div>
                <button onClick={() => handleDeleteContact(c.id)} className="btn btn-danger">Delete</button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Coverage Items (Inclusions / Exclusions) */}
      <div className="card" style={{ marginBottom: 32 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h2 className="section-title" style={{ margin: 0 }}>Inclusions &amp; Exclusions</h2>
          <button onClick={() => setShowCoverageForm(!showCoverageForm)} className="btn btn-primary">
            {showCoverageForm ? 'Cancel' : '+ Add Item'}
          </button>
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
                    <button onClick={async () => { await coverageApi.remove(policyId, ci.id); setCoverageItems(prev => prev.filter(x => x.id !== ci.id)); }} className="btn btn-danger">Delete</button>
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
                    <button onClick={async () => { await coverageApi.remove(policyId, ci.id); setCoverageItems(prev => prev.filter(x => x.id !== ci.id)); }} className="btn btn-danger">Delete</button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Policy Details (type-specific key-value fields) */}
      <div className="card" style={{ marginBottom: 32 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h2 className="section-title" style={{ margin: 0 }}>Policy Details</h2>
          <button onClick={toggleDetailForm} className="btn btn-primary">
            {showDetailForm ? 'Cancel' : '+ Add Detail'}
          </button>
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
                <button onClick={() => handleDeleteDetail(d.id)} className="btn btn-danger">Delete</button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Claims */}
      <div className="card" style={{ marginBottom: 32 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h2 className="section-title" style={{ margin: 0 }}>Track Claims</h2>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              type="file"
              ref={claimFileRef}
              accept=".pdf"
              style={{ display: 'none' }}
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (!file) return;
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
                  <button onClick={async () => { await claimsApi.remove(policyId, cl.id); setClaims(prev => prev.filter(x => x.id !== cl.id)); toast('Claim deleted', 'success'); }} className="btn btn-danger">Delete</button>
                </div>
              );
            })}
          </div>
        )}
      </div>

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
