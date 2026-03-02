'use client';

import { useState, useEffect, useRef, Suspense } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '../../../lib/auth';
import {
  leaseComplianceApi,
  LeaseRequirement,
  LeaseRequirementItem,
  ComplianceResultItem,
  LeaseExtraction,
  BrokerEmail,
  checkFeatureAccess,
  API_BASE,
} from '../../../lib/api';
import { useToast } from '../components/Toast';
import ConfirmDialog from '../components/ConfirmDialog';
import BackButton from '../components/BackButton';
import UpgradePrompt from '../components/UpgradePrompt';

const CATEGORY_LABELS: Record<string, string> = {
  general_liability: 'General Liability',
  commercial_auto: 'Commercial Auto',
  umbrella: 'Umbrella / Excess',
  workers_comp: "Workers' Comp",
  property: 'Property',
  professional_liability: 'Professional Liability',
  cyber: 'Cyber',
  other: 'Other',
};

const CATEGORY_COLORS: Record<string, { bg: string; fg: string }> = {
  general_liability: { bg: '#dbeafe', fg: '#1e40af' },
  commercial_auto: { bg: '#fce7f3', fg: '#9d174d' },
  umbrella: { bg: '#ede9fe', fg: '#5b21b6' },
  workers_comp: { bg: '#fef3c7', fg: '#92400e' },
  property: { bg: '#dcfce7', fg: '#166534' },
  professional_liability: { bg: '#e0e7ff', fg: '#3730a3' },
  cyber: { bg: '#f0fdfa', fg: '#115e59' },
  other: { bg: '#f3f4f6', fg: '#374151' },
};

const STATUS_ICONS: Record<string, { icon: string; color: string; bg: string }> = {
  pass: { icon: '\u2713', color: '#166534', bg: '#dcfce7' },
  fail: { icon: '\u2717', color: '#991b1b', bg: '#fee2e2' },
  unclear: { icon: '?', color: '#92400e', bg: '#fef3c7' },
};

type View = 'list' | 'create' | 'results' | 'view';

export default function LeaseCompliancePage() {
  return <Suspense><LeaseComplianceContent /></Suspense>;
}

function LeaseComplianceContent() {
  const { token, plan } = useAuth();
  const router = useRouter();
  const { toast } = useToast();
  const pdfInputRef = useRef<HTMLInputElement>(null);

  // View state
  const [view, setView] = useState<View>('list');
  const [roleFilter, setRoleFilter] = useState<'tenant' | 'landlord'>('tenant');

  // List state
  const [requirements, setRequirements] = useState<LeaseRequirement[]>([]);
  const [loading, setLoading] = useState(true);
  const [deleteConfirm, setDeleteConfirm] = useState<number | null>(null);

  // Create state
  const [createStep, setCreateStep] = useState(1);
  const [clauseText, setClauseText] = useState('');
  const [extracting, setExtracting] = useState(false);
  const [extraction, setExtraction] = useState<LeaseExtraction | null>(null);
  const [editableReqs, setEditableReqs] = useState<LeaseRequirementItem[]>([]);
  const [formLabel, setFormLabel] = useState('');
  const [formPropertyAddress, setFormPropertyAddress] = useState('');
  const [formCounterpartyName, setFormCounterpartyName] = useState('');
  const [formCounterpartyEmail, setFormCounterpartyEmail] = useState('');
  const [saving, setSaving] = useState(false);

  // Results state
  const [activeReqId, setActiveReqId] = useState<number | null>(null);
  const [results, setResults] = useState<ComplianceResultItem[]>([]);
  const [checkCounts, setCheckCounts] = useState({ pass: 0, fail: 0, unclear: 0 });
  const [checking, setChecking] = useState(false);

  // Broker email state
  const [brokerModal, setBrokerModal] = useState(false);
  const [brokerEmail, setBrokerEmail] = useState<BrokerEmail | null>(null);
  const [loadingBroker, setLoadingBroker] = useState(false);

  // Share state
  const [shareModal, setShareModal] = useState(false);
  const [shareReq, setShareReq] = useState<LeaseRequirement | null>(null);
  const [tenantEmail, setTenantEmail] = useState('');
  const [tenantName, setTenantName] = useState('');
  const [sending, setSending] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);

  // Viewing state
  const [viewingReq, setViewingReq] = useState<LeaseRequirement | null>(null);

  useEffect(() => {
    if (!token) { router.replace('/login'); return; }
    load();
  }, [token]);

  async function load() {
    try {
      const data = await leaseComplianceApi.list();
      setRequirements(data);
    } catch {
      toast('Failed to load lease checks', 'error');
    } finally {
      setLoading(false);
    }
  }

  const filtered = requirements.filter(r => r.role === roleFilter);

  // ── Handlers ────────────────────────────────────

  async function handleExtractText() {
    if (!clauseText.trim()) { toast('Please paste a lease clause', 'error'); return; }
    setExtracting(true);
    try {
      const { extraction: ext } = await leaseComplianceApi.extract(clauseText);
      setExtraction(ext);
      setEditableReqs(ext.requirements || []);
      if (ext.property_address) setFormPropertyAddress(ext.property_address);
      if (ext.landlord_name && roleFilter === 'tenant') setFormCounterpartyName(ext.landlord_name);
      if (ext.tenant_name && roleFilter === 'landlord') setFormCounterpartyName(ext.tenant_name);
      if (!formLabel && ext.property_address) setFormLabel(`${ext.property_address} Lease`);
      setCreateStep(2);
      toast('Requirements extracted successfully');
    } catch (err: any) {
      toast(err.message || 'Extraction failed', 'error');
    } finally {
      setExtracting(false);
    }
  }

  async function handleExtractPdf() {
    const file = pdfInputRef.current?.files?.[0];
    if (!file) { toast('Please select a PDF file', 'error'); return; }
    setExtracting(true);
    try {
      const { extraction: ext } = await leaseComplianceApi.extractPdf(file);
      setExtraction(ext);
      setEditableReqs(ext.requirements || []);
      if (ext.property_address) setFormPropertyAddress(ext.property_address);
      if (ext.landlord_name && roleFilter === 'tenant') setFormCounterpartyName(ext.landlord_name);
      if (ext.tenant_name && roleFilter === 'landlord') setFormCounterpartyName(ext.tenant_name);
      if (!formLabel && ext.property_address) setFormLabel(`${ext.property_address} Lease`);
      setCreateStep(2);
      toast('Requirements extracted from PDF');
      if (pdfInputRef.current) pdfInputRef.current.value = '';
    } catch (err: any) {
      toast(err.message || 'PDF extraction failed', 'error');
    } finally {
      setExtracting(false);
    }
  }

  function removeReqItem(idx: number) {
    setEditableReqs(prev => prev.filter((_, i) => i !== idx));
  }

  function addReqItem() {
    setEditableReqs(prev => [...prev, { category: 'other', requirement_type: 'other', required_value: null, label: '', notes: null }]);
  }

  async function handleSaveAndCheck() {
    if (!formLabel.trim()) { toast('Please enter a label', 'error'); return; }
    if (editableReqs.length === 0) { toast('Add at least one requirement', 'error'); return; }
    setSaving(true);
    try {
      const created = await leaseComplianceApi.create({
        label: formLabel,
        role: roleFilter,
        counterparty_name: formCounterpartyName || null,
        counterparty_email: formCounterpartyEmail || null,
        property_address: formPropertyAddress || null,
        lease_clause_text: clauseText || null,
        requirements_json: JSON.stringify(editableReqs),
      });
      toast('Requirements saved');

      // Run compliance check
      setActiveReqId(created.id);
      setChecking(true);
      try {
        const check = await leaseComplianceApi.runCheck(created.id, 'policies');
        setResults(check.results);
        setCheckCounts({ pass: check.pass_count, fail: check.fail_count, unclear: check.unclear_count });
      } catch {
        toast('Compliance check failed — you can re-check later', 'error');
      } finally {
        setChecking(false);
      }

      setView('results');
      load();
    } catch (err: any) {
      toast(err.message || 'Failed to save', 'error');
    } finally {
      setSaving(false);
    }
  }

  async function handleRecheck(reqId: number) {
    setChecking(true);
    try {
      const check = await leaseComplianceApi.runCheck(reqId, 'policies');
      setResults(check.results);
      setCheckCounts({ pass: check.pass_count, fail: check.fail_count, unclear: check.unclear_count });
      setActiveReqId(reqId);
      toast('Compliance check updated');
      load();
    } catch (err: any) {
      toast(err.message || 'Check failed', 'error');
    } finally {
      setChecking(false);
    }
  }

  async function handleViewResults(req: LeaseRequirement) {
    setActiveReqId(req.id);
    if (req.latest_check) {
      // Load full check data
      try {
        const checks = await leaseComplianceApi.listChecks(req.id);
        if (checks.length > 0) {
          const latest = checks[0];
          const parsed = typeof latest.results_json === 'string' ? JSON.parse(latest.results_json) : (latest as any).results || [];
          setResults(parsed);
          setCheckCounts({ pass: latest.pass_count, fail: latest.fail_count, unclear: latest.unclear_count });
        }
      } catch {
        setResults([]);
        setCheckCounts({ pass: 0, fail: 0, unclear: 0 });
      }
    } else {
      setResults([]);
      setCheckCounts({ pass: 0, fail: 0, unclear: 0 });
    }
    setView('results');
  }

  async function handleBrokerEmail(reqId: number) {
    setLoadingBroker(true);
    setBrokerModal(true);
    try {
      const data = await leaseComplianceApi.brokerEmail(reqId);
      setBrokerEmail(data);
    } catch {
      toast('Failed to generate email', 'error');
      setBrokerModal(false);
    } finally {
      setLoadingBroker(false);
    }
  }

  function handleShare(req: LeaseRequirement) {
    setShareReq(req);
    setShareModal(true);
    setTenantEmail(req.counterparty_email || '');
    setTenantName(req.counterparty_name || '');
    setCopiedLink(false);
  }

  async function handleSendToTenant() {
    if (!shareReq || !tenantEmail.trim()) { toast('Email is required', 'error'); return; }
    setSending(true);
    try {
      await leaseComplianceApi.sendToTenant(shareReq.id, tenantEmail, tenantName || undefined);
      toast('Requirements sent to tenant');
      setShareModal(false);
      load();
    } catch (err: any) {
      toast(err.message || 'Failed to send', 'error');
    } finally {
      setSending(false);
    }
  }

  async function handleDelete(id: number) {
    try {
      await leaseComplianceApi.remove(id);
      toast('Lease check deleted');
      setDeleteConfirm(null);
      load();
    } catch {
      toast('Failed to delete', 'error');
    }
  }

  function resetCreate() {
    setView('list');
    setCreateStep(1);
    setClauseText('');
    setExtraction(null);
    setEditableReqs([]);
    setFormLabel('');
    setFormPropertyAddress('');
    setFormCounterpartyName('');
    setFormCounterpartyEmail('');
  }

  function getShareUrl(code: string) {
    if (typeof window === 'undefined') return '';
    return `${window.location.origin}/lease-compliance/${code}`;
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

  const featureGate = checkFeatureAccess(plan || 'free', 'lease_compliance');
  if (!featureGate.allowed) {
    return <UpgradePrompt feature="lease_compliance" requiredPlan={featureGate.requiredPlan} />;
  }

  // ── Results View ────────────────────────────────

  if (view === 'results' && activeReqId) {
    const activeReq = requirements.find(r => r.id === activeReqId);
    return (
      <div style={{ padding: 32, maxWidth: 960, margin: '0 auto' }}>
        <button onClick={() => { setView('list'); setResults([]); }} style={{ background: 'none', border: 'none', color: 'var(--color-primary)', cursor: 'pointer', fontSize: 13, fontWeight: 600, marginBottom: 16, padding: 0 }}>
          &larr; Back to Lease Checks
        </button>

        <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 8 }}>
          {activeReq?.label || 'Compliance Results'}
        </h1>
        {activeReq?.property_address && (
          <p style={{ fontSize: 13, color: 'var(--color-text-secondary)', marginBottom: 20 }}>{activeReq.property_address}</p>
        )}

        {/* Summary counts */}
        <div style={{ display: 'flex', gap: 12, marginBottom: 24, flexWrap: 'wrap' }}>
          {[
            { label: 'Pass', count: checkCounts.pass, color: '#166534', bg: '#dcfce7' },
            { label: 'Fail', count: checkCounts.fail, color: '#991b1b', bg: '#fee2e2' },
            { label: 'Unclear', count: checkCounts.unclear, color: '#92400e', bg: '#fef3c7' },
          ].map(s => (
            <div key={s.label} style={{ padding: '12px 20px', borderRadius: 'var(--radius-md)', backgroundColor: s.bg, minWidth: 100, textAlign: 'center' }}>
              <div style={{ fontSize: 24, fontWeight: 700, color: s.color }}>{s.count}</div>
              <div style={{ fontSize: 12, fontWeight: 600, color: s.color }}>{s.label}</div>
            </div>
          ))}
        </div>

        {/* Results checklist */}
        {checking ? (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--color-text-secondary)' }}>
            <p style={{ fontSize: 15 }}>Running compliance check...</p>
          </div>
        ) : results.length > 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 24 }}>
            {results.map((r, i) => {
              const si = STATUS_ICONS[r.status] || STATUS_ICONS.unclear;
              const cc = CATEGORY_COLORS[r.category] || CATEGORY_COLORS.other;
              return (
                <div key={i} style={{ border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: 16, backgroundColor: '#fff' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 24, height: 24, borderRadius: '50%', backgroundColor: si.bg, color: si.color, fontSize: 13, fontWeight: 700 }}>{si.icon}</span>
                    <span style={{ padding: '2px 8px', borderRadius: 12, fontSize: 11, fontWeight: 600, backgroundColor: cc.bg, color: cc.fg }}>{CATEGORY_LABELS[r.category] || r.category}</span>
                    <span style={{ fontSize: 14, fontWeight: 600, flex: 1 }}>{r.requirement_label}</span>
                  </div>
                  {r.note && <p style={{ fontSize: 13, color: 'var(--color-text-secondary)', margin: '4px 0 0 34px', lineHeight: 1.5 }}>{r.note}</p>}
                </div>
              );
            })}
          </div>
        ) : (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--color-text-secondary)' }}>
            <p>No compliance check results yet.</p>
            <button onClick={() => activeReqId && handleRecheck(activeReqId)} style={{ marginTop: 12, padding: '8px 20px', backgroundColor: 'var(--color-primary)', color: '#fff', border: 'none', borderRadius: 'var(--radius-sm)', fontWeight: 600, cursor: 'pointer', fontSize: 14 }}>
              Run Compliance Check
            </button>
          </div>
        )}

        {/* Action buttons */}
        {results.length > 0 && (
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <button onClick={() => activeReqId && handleRecheck(activeReqId)} disabled={checking} style={{ padding: '10px 20px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', backgroundColor: '#fff', cursor: 'pointer', fontWeight: 600, fontSize: 14 }}>
              Re-check
            </button>
            <button onClick={() => activeReqId && handleBrokerEmail(activeReqId)} style={{ padding: '10px 20px', backgroundColor: '#2563eb', color: '#fff', border: 'none', borderRadius: 'var(--radius-md)', fontWeight: 600, cursor: 'pointer', fontSize: 14 }}>
              Send to Broker
            </button>
            {activeReq && (
              <button onClick={() => handleShare(activeReq)} style={{ padding: '10px 20px', backgroundColor: 'var(--color-primary)', color: '#fff', border: 'none', borderRadius: 'var(--radius-md)', fontWeight: 600, cursor: 'pointer', fontSize: 14 }}>
                Share Link
              </button>
            )}
          </div>
        )}

        {/* Broker Email Modal */}
        {brokerModal && (
          <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.5)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
            <div style={{ backgroundColor: '#fff', borderRadius: 'var(--radius-lg)', padding: 28, maxWidth: 600, width: '100%', maxHeight: '90vh', overflowY: 'auto' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
                <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>Send to Broker</h2>
                <button onClick={() => setBrokerModal(false)} style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: 'var(--color-text-muted)' }}>&times;</button>
              </div>

              {loadingBroker ? (
                <p style={{ color: 'var(--color-text-secondary)', textAlign: 'center', padding: 20 }}>Generating email...</p>
              ) : brokerEmail ? (
                <>
                  {brokerEmail.broker_name && (
                    <div style={{ marginBottom: 12 }}>
                      <label style={labelStyle}>Broker</label>
                      <p style={{ fontSize: 14, margin: 0 }}>{brokerEmail.broker_name} {brokerEmail.broker_email && `(${brokerEmail.broker_email})`}</p>
                    </div>
                  )}
                  <div style={{ marginBottom: 12 }}>
                    <label style={labelStyle}>Subject</label>
                    <input style={inputStyle} readOnly value={brokerEmail.subject} />
                  </div>
                  <div style={{ marginBottom: 20 }}>
                    <label style={labelStyle}>Email Body</label>
                    <textarea style={{ ...inputStyle, minHeight: 200, fontFamily: 'monospace', fontSize: 13, lineHeight: 1.6 }} readOnly value={brokerEmail.body} />
                  </div>
                  <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
                    <button
                      onClick={() => { navigator.clipboard.writeText(brokerEmail.body); toast('Copied to clipboard'); }}
                      style={{ padding: '8px 20px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', backgroundColor: '#fff', cursor: 'pointer', fontSize: 14 }}
                    >
                      Copy to Clipboard
                    </button>
                    {brokerEmail.broker_email && (
                      <a
                        href={`mailto:${brokerEmail.broker_email}?subject=${encodeURIComponent(brokerEmail.subject)}&body=${encodeURIComponent(brokerEmail.body)}`}
                        style={{ display: 'inline-block', padding: '8px 20px', backgroundColor: 'var(--color-primary)', color: '#fff', borderRadius: 'var(--radius-sm)', fontWeight: 600, textDecoration: 'none', fontSize: 14 }}
                      >
                        Open in Email App
                      </a>
                    )}
                  </div>
                </>
              ) : null}
            </div>
          </div>
        )}

        {/* Share Modal */}
        {shareModal && shareReq && (
          <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.5)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
            <div style={{ backgroundColor: '#fff', borderRadius: 'var(--radius-lg)', padding: 28, maxWidth: 480, width: '100%' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
                <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>Share Requirements</h2>
                <button onClick={() => setShareModal(false)} style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: 'var(--color-text-muted)' }}>&times;</button>
              </div>

              {/* Copy link */}
              <div style={{ marginBottom: 20 }}>
                <label style={labelStyle}>Public Link</label>
                <div style={{ display: 'flex', gap: 8 }}>
                  <input style={{ ...inputStyle, flex: 1 }} readOnly value={getShareUrl(shareReq.access_code)} />
                  <button
                    onClick={() => { navigator.clipboard.writeText(getShareUrl(shareReq.access_code)); setCopiedLink(true); toast('Link copied'); }}
                    style={{ padding: '8px 16px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', backgroundColor: copiedLink ? '#dcfce7' : '#fff', cursor: 'pointer', fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap' }}
                  >
                    {copiedLink ? 'Copied!' : 'Copy'}
                  </button>
                </div>
              </div>

              {/* Send by email */}
              {shareReq.role === 'landlord' && (
                <>
                  <div style={{ borderTop: '1px solid var(--color-border)', paddingTop: 16, marginBottom: 12 }}>
                    <label style={labelStyle}>Send by Email</label>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
                    <div>
                      <label style={labelStyle}>Tenant Name</label>
                      <input style={inputStyle} value={tenantName} onChange={e => setTenantName(e.target.value)} placeholder="Optional" />
                    </div>
                    <div>
                      <label style={labelStyle}>Tenant Email *</label>
                      <input style={inputStyle} type="email" value={tenantEmail} onChange={e => setTenantEmail(e.target.value)} placeholder="tenant@example.com" />
                    </div>
                  </div>
                  <button
                    onClick={handleSendToTenant}
                    disabled={sending || !tenantEmail.trim()}
                    style={{ padding: '10px 20px', backgroundColor: 'var(--color-primary)', color: '#fff', border: 'none', borderRadius: 'var(--radius-md)', fontWeight: 600, cursor: sending ? 'wait' : 'pointer', fontSize: 14, opacity: sending ? 0.7 : 1 }}
                  >
                    {sending ? 'Sending...' : 'Send to Tenant'}
                  </button>
                </>
              )}
            </div>
          </div>
        )}
      </div>
    );
  }

  // ── Create View ─────────────────────────────────

  if (view === 'create') {
    return (
      <div style={{ padding: 32, maxWidth: 960, margin: '0 auto' }}>
        <button onClick={resetCreate} style={{ background: 'none', border: 'none', color: 'var(--color-primary)', cursor: 'pointer', fontSize: 13, fontWeight: 600, marginBottom: 16, padding: 0 }}>
          &larr; Back to Lease Checks
        </button>

        <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 4 }}>New Lease Check</h1>
        <p style={{ fontSize: 13, color: 'var(--color-text-secondary)', marginBottom: 24 }}>
          {roleFilter === 'tenant' ? 'Paste your lease clause to check your coverage' : 'Set requirements for your tenant'}
        </p>

        {/* Step indicators */}
        <div style={{ display: 'flex', gap: 24, marginBottom: 28 }}>
          {[
            { n: 1, label: 'Input' },
            { n: 2, label: 'Review' },
          ].map(s => (
            <div key={s.n} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                width: 28, height: 28, borderRadius: '50%', fontSize: 13, fontWeight: 700,
                backgroundColor: createStep >= s.n ? 'var(--color-primary)' : '#e5e7eb',
                color: createStep >= s.n ? '#fff' : '#9ca3af',
              }}>{s.n}</span>
              <span style={{ fontSize: 13, fontWeight: 600, color: createStep >= s.n ? 'var(--color-text)' : 'var(--color-text-muted)' }}>{s.label}</span>
            </div>
          ))}
        </div>

        {/* Step 1: Input */}
        {createStep === 1 && (
          <>
            <div style={{ marginBottom: 16 }}>
              <label style={labelStyle}>Paste Lease Insurance Clause</label>
              <textarea
                style={{ ...inputStyle, minHeight: 180, lineHeight: 1.6 }}
                value={clauseText}
                onChange={e => setClauseText(e.target.value)}
                placeholder="Paste the insurance requirements section from your lease here..."
              />
            </div>

            <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 20, flexWrap: 'wrap' }}>
              <button
                onClick={handleExtractText}
                disabled={extracting || !clauseText.trim()}
                style={{
                  padding: '10px 24px', backgroundColor: 'var(--color-primary)', color: '#fff',
                  border: 'none', borderRadius: 'var(--radius-md)', fontWeight: 600, fontSize: 14,
                  cursor: extracting ? 'wait' : 'pointer', opacity: extracting ? 0.7 : 1,
                }}
              >
                {extracting ? 'Extracting...' : 'Extract Requirements'}
              </button>

              <span style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>or</span>

              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <input ref={pdfInputRef} type="file" accept=".pdf" style={{ fontSize: 13 }} />
                <button
                  onClick={handleExtractPdf}
                  disabled={extracting}
                  style={{
                    padding: '10px 16px', backgroundColor: '#2563eb', color: '#fff',
                    border: 'none', borderRadius: 'var(--radius-sm)', fontWeight: 600, fontSize: 13,
                    cursor: extracting ? 'wait' : 'pointer', opacity: extracting ? 0.7 : 1, whiteSpace: 'nowrap',
                  }}
                >
                  Upload PDF
                </button>
              </div>
            </div>

            {extracting && (
              <p style={{ fontSize: 13, color: '#2563eb', fontStyle: 'italic' }}>
                Analyzing lease clause and extracting requirements... This may take a few seconds.
              </p>
            )}
          </>
        )}

        {/* Step 2: Review */}
        {createStep === 2 && (
          <>
            {extraction?.raw_summary && (
              <div style={{ padding: 14, backgroundColor: '#f0f9ff', border: '1px solid #bfdbfe', borderRadius: 'var(--radius-md)', marginBottom: 20, fontSize: 13, lineHeight: 1.6, color: '#1e40af' }}>
                {extraction.raw_summary}
              </div>
            )}

            {/* Form fields */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
              <div>
                <label style={labelStyle}>Label *</label>
                <input style={inputStyle} value={formLabel} onChange={e => setFormLabel(e.target.value)} placeholder="e.g. 123 Main St Lease" />
              </div>
              <div>
                <label style={labelStyle}>Property Address</label>
                <input style={inputStyle} value={formPropertyAddress} onChange={e => setFormPropertyAddress(e.target.value)} placeholder="Optional" />
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 20 }}>
              <div>
                <label style={labelStyle}>{roleFilter === 'tenant' ? 'Landlord Name' : 'Tenant Name'}</label>
                <input style={inputStyle} value={formCounterpartyName} onChange={e => setFormCounterpartyName(e.target.value)} placeholder="Optional" />
              </div>
              <div>
                <label style={labelStyle}>{roleFilter === 'tenant' ? 'Landlord Email' : 'Tenant Email'}</label>
                <input style={inputStyle} type="email" value={formCounterpartyEmail} onChange={e => setFormCounterpartyEmail(e.target.value)} placeholder="Optional" />
              </div>
            </div>

            {/* Requirements checklist */}
            <div style={{ marginBottom: 20 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <label style={{ ...labelStyle, marginBottom: 0 }}>Requirements ({editableReqs.length})</label>
                <button onClick={addReqItem} style={{ fontSize: 12, color: 'var(--color-primary)', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 600 }}>+ Add Requirement</button>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {editableReqs.map((req, idx) => {
                  const cc = CATEGORY_COLORS[req.category] || CATEGORY_COLORS.other;
                  return (
                    <div key={idx} style={{ border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: 12, backgroundColor: '#fff' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                        <span style={{ padding: '2px 8px', borderRadius: 12, fontSize: 11, fontWeight: 600, backgroundColor: cc.bg, color: cc.fg }}>
                          {CATEGORY_LABELS[req.category] || req.category}
                        </span>
                        <input
                          style={{ ...inputStyle, flex: 1, padding: '4px 8px', fontSize: 13 }}
                          value={req.label}
                          onChange={e => {
                            const updated = [...editableReqs];
                            updated[idx] = { ...updated[idx], label: e.target.value };
                            setEditableReqs(updated);
                          }}
                          placeholder="Requirement label"
                        />
                        <button onClick={() => removeReqItem(idx)} style={{ background: 'none', border: 'none', color: 'var(--color-danger)', cursor: 'pointer', fontSize: 16, padding: '0 4px' }}>&times;</button>
                      </div>
                      {req.notes && (
                        <p style={{ fontSize: 12, color: 'var(--color-text-muted)', margin: '0 0 0 8px', fontStyle: 'italic' }}>{req.notes}</p>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={() => setCreateStep(1)} style={{ padding: '10px 20px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', backgroundColor: '#fff', cursor: 'pointer', fontSize: 14 }}>
                Back
              </button>
              <button
                onClick={handleSaveAndCheck}
                disabled={saving}
                style={{
                  padding: '10px 24px', backgroundColor: 'var(--color-primary)', color: '#fff',
                  border: 'none', borderRadius: 'var(--radius-md)', fontWeight: 600, fontSize: 14,
                  cursor: saving ? 'wait' : 'pointer', opacity: saving ? 0.7 : 1,
                }}
              >
                {saving ? 'Saving...' : 'Save & Check My Coverage'}
              </button>
            </div>
          </>
        )}
      </div>
    );
  }

  // ── List View (default) ─────────────────────────

  return (
    <div style={{ padding: 32, maxWidth: 960, margin: '0 auto' }}>
      <BackButton href="/" label="Lease Check" parentLabel="Home" />

      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24, flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700 }}>Lease Check</h1>
          <p style={{ fontSize: 13, color: 'var(--color-text-secondary)', marginTop: 4 }}>
            Verify your insurance meets lease requirements
          </p>
        </div>
        <button
          onClick={() => setView('create')}
          style={{
            padding: '10px 20px', backgroundColor: 'var(--color-primary)', color: '#fff',
            border: 'none', borderRadius: 'var(--radius-md)', fontWeight: 600, fontSize: 14, cursor: 'pointer',
          }}
        >
          + New Lease Check
        </button>
      </div>

      {/* Role toggle */}
      <div style={{ display: 'flex', gap: 0, marginBottom: 24, borderRadius: 'var(--radius-sm)', overflow: 'hidden', border: '1px solid var(--color-border)', maxWidth: 300 }}>
        {(['tenant', 'landlord'] as const).map(r => (
          <button
            key={r}
            onClick={() => setRoleFilter(r)}
            style={{
              flex: 1, padding: '8px 16px', border: 'none', fontSize: 13, fontWeight: 600, cursor: 'pointer',
              backgroundColor: roleFilter === r ? 'var(--color-primary)' : '#fff',
              color: roleFilter === r ? '#fff' : 'var(--color-text)',
            }}
          >
            {r === 'tenant' ? 'As Tenant' : 'As Landlord'}
          </button>
        ))}
      </div>

      {/* Empty state */}
      {filtered.length === 0 && (
        <div style={{ textAlign: 'center', padding: '60px 20px', color: 'var(--color-text-secondary)' }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>
            {roleFilter === 'tenant' ? '\uD83D\uDCCB' : '\uD83C\uDFE2'}
          </div>
          <p style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>
            {roleFilter === 'tenant' ? 'No lease checks yet' : 'No tenant requirements yet'}
          </p>
          <p style={{ fontSize: 13 }}>
            {roleFilter === 'tenant'
              ? 'Paste your lease clause to check if your insurance meets the requirements.'
              : 'Set up insurance requirements for your tenants.'}
          </p>
        </div>
      )}

      {/* Cards */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {filtered.map(req => {
          const reqs: LeaseRequirementItem[] = (() => {
            try { return JSON.parse(req.requirements_json); } catch { return []; }
          })();

          return (
            <div
              key={req.id}
              style={{
                border: '1px solid var(--color-border)', borderRadius: 'var(--radius-lg)',
                padding: 20, backgroundColor: '#fff',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10, flexWrap: 'wrap', gap: 8 }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 4 }}>{req.label}</div>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', fontSize: 12, color: 'var(--color-text-secondary)' }}>
                    {req.property_address && <span>{req.property_address}</span>}
                    {req.counterparty_name && <span>&middot; {req.counterparty_name}</span>}
                    <span>&middot; {reqs.length} requirement{reqs.length !== 1 ? 's' : ''}</span>
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button onClick={() => handleViewResults(req)} style={{ padding: '4px 10px', fontSize: 12, border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', backgroundColor: '#fff', cursor: 'pointer' }}>View</button>
                  <button onClick={() => handleShare(req)} style={{ padding: '4px 10px', fontSize: 12, border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', backgroundColor: '#fff', cursor: 'pointer' }}>Share</button>
                  <button onClick={() => setDeleteConfirm(req.id)} style={{ padding: '4px 10px', fontSize: 12, border: '1px solid var(--color-danger-border)', borderRadius: 'var(--radius-sm)', backgroundColor: '#fff', color: 'var(--color-danger)', cursor: 'pointer' }}>Delete</button>
                </div>
              </div>

              {/* Latest check badge */}
              {req.latest_check && (
                <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                  {req.latest_check.pass_count > 0 && (
                    <span style={{ padding: '2px 10px', borderRadius: 12, fontSize: 12, fontWeight: 600, backgroundColor: '#dcfce7', color: '#166534' }}>
                      {req.latest_check.pass_count} pass
                    </span>
                  )}
                  {req.latest_check.fail_count > 0 && (
                    <span style={{ padding: '2px 10px', borderRadius: 12, fontSize: 12, fontWeight: 600, backgroundColor: '#fee2e2', color: '#991b1b' }}>
                      {req.latest_check.fail_count} fail
                    </span>
                  )}
                  {req.latest_check.unclear_count > 0 && (
                    <span style={{ padding: '2px 10px', borderRadius: 12, fontSize: 12, fontWeight: 600, backgroundColor: '#fef3c7', color: '#92400e' }}>
                      {req.latest_check.unclear_count} unclear
                    </span>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Share Modal (reusable from list) */}
      {shareModal && shareReq && (
        <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.5)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
          <div style={{ backgroundColor: '#fff', borderRadius: 'var(--radius-lg)', padding: 28, maxWidth: 480, width: '100%' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>Share Requirements</h2>
              <button onClick={() => setShareModal(false)} style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: 'var(--color-text-muted)' }}>&times;</button>
            </div>

            <div style={{ marginBottom: 20 }}>
              <label style={labelStyle}>Public Link</label>
              <div style={{ display: 'flex', gap: 8 }}>
                <input style={{ ...inputStyle, flex: 1 }} readOnly value={getShareUrl(shareReq.access_code)} />
                <button
                  onClick={() => { navigator.clipboard.writeText(getShareUrl(shareReq.access_code)); setCopiedLink(true); toast('Link copied'); }}
                  style={{ padding: '8px 16px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', backgroundColor: copiedLink ? '#dcfce7' : '#fff', cursor: 'pointer', fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap' }}
                >
                  {copiedLink ? 'Copied!' : 'Copy'}
                </button>
              </div>
            </div>

            {shareReq.role === 'landlord' && (
              <>
                <div style={{ borderTop: '1px solid var(--color-border)', paddingTop: 16, marginBottom: 12 }}>
                  <label style={labelStyle}>Email to Tenant</label>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
                  <div>
                    <label style={labelStyle}>Tenant Name</label>
                    <input style={inputStyle} value={tenantName} onChange={e => setTenantName(e.target.value)} placeholder="Optional" />
                  </div>
                  <div>
                    <label style={labelStyle}>Tenant Email *</label>
                    <input style={inputStyle} type="email" value={tenantEmail} onChange={e => setTenantEmail(e.target.value)} placeholder="tenant@example.com" />
                  </div>
                </div>
                <button
                  onClick={handleSendToTenant}
                  disabled={sending || !tenantEmail.trim()}
                  style={{ padding: '10px 20px', backgroundColor: 'var(--color-primary)', color: '#fff', border: 'none', borderRadius: 'var(--radius-md)', fontWeight: 600, cursor: sending ? 'wait' : 'pointer', fontSize: 14, opacity: sending ? 0.7 : 1 }}
                >
                  {sending ? 'Sending...' : 'Send to Tenant'}
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {/* Delete confirmation */}
      {deleteConfirm != null && (
        <ConfirmDialog
          open={true}
          title="Delete Lease Check"
          message="Are you sure you want to delete this lease check? This cannot be undone."
          confirmLabel="Delete"
          danger
          onConfirm={() => handleDelete(deleteConfirm)}
          onCancel={() => setDeleteConfirm(null)}
        />
      )}
    </div>
  );
}
