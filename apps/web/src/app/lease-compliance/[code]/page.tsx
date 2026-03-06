'use client';

import { useState, useEffect, useRef } from 'react';
import { useParams } from 'next/navigation';
import {
  leaseComplianceApi,
  LeasePublicData,
  LeaseRequirementItem,
  ComplianceResultItem,
} from '../../../../lib/api';

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

export default function LeaseCompliancePublicPage() {
  const params = useParams();
  const code = params.code as string;
  const fileRef = useRef<HTMLInputElement>(null);

  const [data, setData] = useState<LeasePublicData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // COI submission
  const [tenantName, setTenantName] = useState('');
  const [tenantEmail, setTenantEmail] = useState('');
  const [tenantNotes, setTenantNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [results, setResults] = useState<ComplianceResultItem[] | null>(null);
  const [counts, setCounts] = useState({ pass: 0, fail: 0, unclear: 0 });

  useEffect(() => {
    if (!code) return;
    loadData();
  }, [code]);

  async function loadData() {
    try {
      const d = await leaseComplianceApi.getPublic(code);
      setData(d);
    } catch (err: any) {
      setError(err.message || 'Requirements not found or link expired');
    } finally {
      setLoading(false);
    }
  }

  async function handleSubmitCoi() {
    const file = fileRef.current?.files?.[0];
    if (!file) { return; }
    if (!file.name.toLowerCase().endsWith('.pdf')) { return; }
    setSubmitting(true);
    try {
      const result = await leaseComplianceApi.submitCoiPublic(code, file, tenantName, tenantEmail, tenantNotes || undefined);
      setResults(result.results);
      setCounts({ pass: result.pass_count, fail: result.fail_count, unclear: result.unclear_count });
    } catch (err: any) {
      setError(err.message || 'Submission failed');
    } finally {
      setSubmitting(false);
    }
  }

  const inputStyle: React.CSSProperties = { width: '100%', padding: '8px 10px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 14 };
  const labelStyle: React.CSSProperties = { display: 'block', fontSize: 12, fontWeight: 600, color: '#6b7280', marginBottom: 4 };

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', backgroundColor: '#f9fafb', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ textAlign: 'center', color: '#6b7280' }}>
          <p style={{ fontSize: 15 }}>Loading requirements...</p>
        </div>
      </div>
    );
  }

  if (error && !data) {
    return (
      <div style={{ minHeight: '100vh', backgroundColor: '#f9fafb', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ textAlign: 'center', maxWidth: 400, padding: 20 }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>&#128274;</div>
          <h1 style={{ fontSize: 20, fontWeight: 700, color: '#1f2937', marginBottom: 8 }}>Link Not Found</h1>
          <p style={{ fontSize: 14, color: '#6b7280' }}>{error}</p>
        </div>
      </div>
    );
  }

  if (!data) return null;

  return (
    <div style={{ minHeight: '100vh', backgroundColor: '#f9fafb' }}>
      {/* Print CSS */}
      <style>{`
        @media print {
          .no-print { display: none !important; }
          body { background: #fff !important; }
          div { break-inside: avoid; }
        }
      `}</style>

      {/* Header */}
      <div style={{ backgroundColor: '#1e3a5f', padding: '20px 24px', color: '#fff' }}>
        <div style={{ maxWidth: 720, margin: '0 auto', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 4 }}>Covrabl</div>
            <div style={{ fontSize: 13, opacity: 0.8 }}>Lease Insurance Requirements</div>
          </div>
          <button
            className="no-print"
            onClick={() => window.print()}
            style={{
              padding: '8px 18px', backgroundColor: 'rgba(255,255,255,0.15)', color: '#fff',
              border: '1px solid rgba(255,255,255,0.3)', borderRadius: 6, fontWeight: 600,
              fontSize: 13, cursor: 'pointer',
            }}
          >
            Print / Save PDF
          </button>
        </div>
      </div>

      <div style={{ maxWidth: 720, margin: '0 auto', padding: '32px 20px' }}>
        {/* Info */}
        <div style={{ marginBottom: 28 }}>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: '#1f2937', marginBottom: 8 }}>{data.label}</h1>
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', fontSize: 13, color: '#6b7280' }}>
            {data.property_address && <span>Property: {data.property_address}</span>}
            {data.counterparty_name && <span>From: {data.counterparty_name}</span>}
          </div>
        </div>

        {/* Requirements */}
        <div style={{ marginBottom: 32 }}>
          <h2 style={{ fontSize: 16, fontWeight: 700, color: '#1f2937', marginBottom: 14 }}>
            Insurance Requirements ({data.requirements.length})
          </h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {data.requirements.map((req, idx) => {
              const cc = CATEGORY_COLORS[req.category] || CATEGORY_COLORS.other;
              return (
                <div key={idx} style={{ border: '1px solid #e5e7eb', borderRadius: 8, padding: 14, backgroundColor: '#fff' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4, flexWrap: 'wrap' }}>
                    <span style={{ padding: '2px 8px', borderRadius: 12, fontSize: 11, fontWeight: 600, backgroundColor: cc.bg, color: cc.fg }}>
                      {CATEGORY_LABELS[req.category] || req.category}
                    </span>
                    <span style={{ fontSize: 14, fontWeight: 600, color: '#1f2937' }}>{req.label}</span>
                  </div>
                  {req.notes && <p style={{ fontSize: 12, color: '#9ca3af', margin: '4px 0 0', fontStyle: 'italic' }}>{req.notes}</p>}
                </div>
              );
            })}
          </div>
        </div>

        {/* Results (after submission) */}
        {results && (
          <div style={{ marginBottom: 32 }}>
            <h2 style={{ fontSize: 16, fontWeight: 700, color: '#1f2937', marginBottom: 14 }}>Compliance Results</h2>

            <div style={{ display: 'flex', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
              {[
                { label: 'Pass', count: counts.pass, color: '#166534', bg: '#dcfce7' },
                { label: 'Fail', count: counts.fail, color: '#991b1b', bg: '#fee2e2' },
                { label: 'Unclear', count: counts.unclear, color: '#92400e', bg: '#fef3c7' },
              ].map(s => (
                <div key={s.label} style={{ padding: '10px 18px', borderRadius: 8, backgroundColor: s.bg, minWidth: 80, textAlign: 'center' }}>
                  <div style={{ fontSize: 20, fontWeight: 700, color: s.color }}>{s.count}</div>
                  <div style={{ fontSize: 11, fontWeight: 600, color: s.color }}>{s.label}</div>
                </div>
              ))}
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {results.map((r, i) => {
                const si = STATUS_ICONS[r.status] || STATUS_ICONS.unclear;
                const cc = CATEGORY_COLORS[r.category] || CATEGORY_COLORS.other;
                return (
                  <div key={i} style={{ border: '1px solid #e5e7eb', borderRadius: 8, padding: 14, backgroundColor: '#fff' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                      <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 22, height: 22, borderRadius: '50%', backgroundColor: si.bg, color: si.color, fontSize: 12, fontWeight: 700 }}>{si.icon}</span>
                      <span style={{ padding: '2px 8px', borderRadius: 12, fontSize: 11, fontWeight: 600, backgroundColor: cc.bg, color: cc.fg }}>{CATEGORY_LABELS[r.category] || r.category}</span>
                      <span style={{ fontSize: 13, fontWeight: 600, color: '#1f2937' }}>{r.requirement_label}</span>
                    </div>
                    {r.note && <p style={{ fontSize: 12, color: '#6b7280', margin: '4px 0 0 30px', lineHeight: 1.5 }}>{r.note}</p>}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Post-submission next steps */}
        {results && (() => {
          const allPass = counts.fail === 0 && counts.unclear === 0 && counts.pass > 0;
          const hasFail = counts.fail > 0;
          return (
            <div className="no-print" style={{ marginBottom: 32 }}>
              <div style={{
                padding: 20, borderRadius: 10,
                backgroundColor: allPass ? '#f0fdf4' : hasFail ? '#fef2f2' : '#fffbeb',
                border: `1px solid ${allPass ? '#bbf7d0' : hasFail ? '#fecaca' : '#fde68a'}`,
                marginBottom: 16,
              }}>
                <h3 style={{ margin: '0 0 6px', fontSize: 15, fontWeight: 700, color: allPass ? '#166534' : hasFail ? '#991b1b' : '#92400e' }}>
                  {allPass ? 'Your insurance meets all requirements' : hasFail ? 'Some requirements were not met' : 'Some requirements need review'}
                </h3>
                <p style={{ margin: 0, fontSize: 13, color: allPass ? '#15803d' : hasFail ? '#b91c1c' : '#a16207', lineHeight: 1.5 }}>
                  Your landlord has been notified automatically with these results.
                  {hasFail && ' They may reach out with next steps. You can resubmit an updated certificate using this same link.'}
                </p>
              </div>
              <div style={{ textAlign: 'center', padding: '16px 0' }}>
                <p style={{ fontSize: 13, color: '#6b7280', marginBottom: 12 }}>Want to track your own insurance policies and stay on top of renewals?</p>
                <a
                  href="/"
                  style={{
                    display: 'inline-block', padding: '10px 24px', backgroundColor: '#1e3a5f', color: '#fff',
                    borderRadius: 6, fontWeight: 600, fontSize: 14, textDecoration: 'none',
                  }}
                >
                  Try Covrabl Free
                </a>
              </div>
            </div>
          );
        })()}

        {/* Submit COI section (only if no results yet) */}
        {!results && data.role === 'landlord' && (
          <div className="no-print" style={{ backgroundColor: '#fff', border: '1px solid #e5e7eb', borderRadius: 12, padding: 24 }}>
            <h2 style={{ fontSize: 16, fontWeight: 700, color: '#1f2937', marginBottom: 4 }}>
              Submit Your Certificate of Insurance
            </h2>
            <p style={{ fontSize: 13, color: '#6b7280', marginBottom: 20 }}>
              Upload your COI to automatically check it against the requirements above.
            </p>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
              <div>
                <label style={labelStyle}>Your Name</label>
                <input style={inputStyle} value={tenantName} onChange={e => setTenantName(e.target.value)} placeholder="Optional" />
              </div>
              <div>
                <label style={labelStyle}>Your Email</label>
                <input style={inputStyle} type="email" value={tenantEmail} onChange={e => setTenantEmail(e.target.value)} placeholder="Optional" />
              </div>
            </div>

            <div style={{ marginBottom: 16 }}>
              <label style={labelStyle}>Notes (optional)</label>
              <textarea
                style={{ ...inputStyle, minHeight: 56, resize: 'vertical' }}
                value={tenantNotes}
                onChange={e => setTenantNotes(e.target.value)}
                placeholder="e.g., Updated policy attached — waiver of subrogation endorsement is on page 3"
              />
            </div>

            <div style={{ marginBottom: 16 }}>
              <label style={labelStyle}>Certificate of Insurance (PDF)</label>
              <input ref={fileRef} type="file" accept=".pdf" style={{ fontSize: 13, display: 'block', marginTop: 4 }} />
            </div>

            <button
              onClick={handleSubmitCoi}
              disabled={submitting}
              style={{
                padding: '10px 24px', backgroundColor: '#1e3a5f', color: '#fff',
                border: 'none', borderRadius: 6, fontWeight: 600, fontSize: 14,
                cursor: submitting ? 'wait' : 'pointer', opacity: submitting ? 0.7 : 1,
              }}
            >
              {submitting ? 'Analyzing...' : 'Submit Certificate'}
            </button>

            {submitting && (
              <p style={{ fontSize: 13, color: '#2563eb', marginTop: 10, fontStyle: 'italic' }}>
                Extracting certificate data and running compliance check... This may take a moment.
              </p>
            )}

            {error && (
              <p style={{ fontSize: 13, color: '#991b1b', marginTop: 10 }}>{error}</p>
            )}
          </div>
        )}

        {/* Disclaimer */}
        <div style={{ marginTop: 40, padding: 16, backgroundColor: '#f3f4f6', borderRadius: 8, fontSize: 11, color: '#9ca3af', lineHeight: 1.6 }}>
          <strong>Disclaimer:</strong> This compliance check is provided for informational purposes only and does not constitute legal or insurance advice.
          Results indicate whether provided documentation appears to meet the stated requirements based on automated analysis.
          All results should be verified by a qualified insurance professional. "Appears to meet" indicates the documentation
          provided seems to satisfy the requirement but should be independently confirmed.
        </div>

        {/* Powered by */}
        <div style={{ textAlign: 'center', marginTop: 24, fontSize: 12, color: '#9ca3af' }}>
          Powered by <a href="https://covrabl.com" style={{ color: '#6b7280', textDecoration: 'underline' }}>Covrabl</a>
        </div>
      </div>
    </div>
  );
}
