'use client';

import { useState, useEffect, useRef } from 'react';
import { useParams } from 'next/navigation';
import {
  leaseComplianceApi,
  LeasePublicData,
  LeaseRequirementItem,
  ComplianceResultItem,
} from '../../../../lib/api';
import { trackClick } from '../../../../lib/track';

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

function ResultsSection({ results, counts }: { results: ComplianceResultItem[]; counts: { pass: number; fail: number; unclear: number } }) {
  const total = counts.pass + counts.fail + counts.unclear;
  const allPass = counts.fail === 0 && counts.unclear === 0;
  const hasFails = counts.fail > 0;
  const verdictLabel = allPass ? 'COMPLIANT' : hasFails ? (counts.pass > 0 ? 'PARTIALLY COMPLIANT' : 'NON-COMPLIANT') : 'NEEDS VERIFICATION';
  const verdictBg = allPass ? '#dcfce7' : hasFails ? '#fee2e2' : '#fef3c7';
  const verdictColor = allPass ? '#166534' : hasFails ? '#991b1b' : '#92400e';
  const verdictBorder = allPass ? '#bbf7d0' : hasFails ? '#fecaca' : '#fde68a';

  return (
    <div style={{ marginBottom: 32 }}>
      <h2 style={{ fontSize: 16, fontWeight: 700, color: '#1f2937', marginBottom: 14 }}>Compliance Results</h2>

      {/* Big Verdict Banner */}
      <div style={{ borderRadius: 10, border: `2px solid ${verdictBorder}`, backgroundColor: verdictBg, padding: '16px 20px', marginBottom: 20, textAlign: 'center' }}>
        <div style={{ fontSize: 18, fontWeight: 800, color: verdictColor, letterSpacing: '0.03em' }}>{verdictLabel}</div>
        <div style={{ fontSize: 13, color: verdictColor, marginTop: 4, fontWeight: 500 }}>
          {counts.pass} of {total} requirement{total !== 1 ? 's' : ''} met
          {counts.fail > 0 && <span> &middot; {counts.fail} failed</span>}
          {counts.unclear > 0 && <span> &middot; {counts.unclear} unclear</span>}
        </div>
      </div>

      {/* Structured results with required vs actual */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {results.map((r, i) => {
          const si = STATUS_ICONS[r.status] || STATUS_ICONS.unclear;
          const cc = CATEGORY_COLORS[r.category] || CATEGORY_COLORS.other;
          const resolutionText = r.status === 'fail'
            ? (r.required_value && r.actual_value
                ? `Request updated certificate with ${r.requirement_label} increased to ${r.required_value}`
                : r.required_value
                  ? `Request coverage for ${r.requirement_label} at ${r.required_value} minimum`
                  : `Request proof of ${r.requirement_label} from your insurer`)
            : r.status === 'unclear'
              ? `Verify ${r.requirement_label} with your carrier or agent`
              : null;
          return (
            <div key={i} style={{ border: `1px solid ${r.status === 'fail' ? '#fecaca' : r.status === 'unclear' ? '#fde68a' : '#e5e7eb'}`, borderRadius: 8, padding: 14, backgroundColor: '#fff' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: (r.required_value || r.actual_value || r.note) ? 8 : 0, flexWrap: 'wrap' }}>
                <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 22, height: 22, borderRadius: '50%', backgroundColor: si.bg, color: si.color, fontSize: 12, fontWeight: 700, flexShrink: 0 }}>{si.icon}</span>
                <span style={{ padding: '2px 8px', borderRadius: 12, fontSize: 11, fontWeight: 600, backgroundColor: cc.bg, color: cc.fg, flexShrink: 0 }}>{CATEGORY_LABELS[r.category] || r.category}</span>
                <span style={{ fontSize: 13, fontWeight: 600, color: '#1f2937', flex: 1, minWidth: 0 }}>{r.requirement_label}</span>
                <span style={{ fontSize: 11, fontWeight: 700, color: si.color, textTransform: 'uppercase', flexShrink: 0 }}>{r.status === 'pass' ? 'Met' : r.status === 'fail' ? 'Failed' : 'Unclear'}</span>
              </div>
              {(r.required_value || r.actual_value) && (
                <div className="form-grid-2" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginLeft: 30, marginBottom: r.note ? 6 : 0 }}>
                  {r.required_value && (
                    <div style={{ fontSize: 12, color: '#6b7280' }}>
                      <span style={{ fontWeight: 600 }}>Required:</span> {r.required_value}
                    </div>
                  )}
                  <div style={{ fontSize: 12, color: r.status === 'fail' ? '#991b1b' : r.status === 'pass' ? '#166534' : '#92400e' }}>
                    <span style={{ fontWeight: 600 }}>Found:</span> {r.actual_value || 'Not detected'}
                  </div>
                </div>
              )}
              {r.note && <p style={{ fontSize: 12, color: '#6b7280', margin: '0 0 0 30px', lineHeight: 1.5 }}>{r.note}</p>}
              {resolutionText && (
                <div style={{ marginTop: 8, marginLeft: 30, padding: '6px 10px', borderRadius: 6, backgroundColor: r.status === 'fail' ? '#fef2f2' : '#fffbeb', fontSize: 12, color: r.status === 'fail' ? '#991b1b' : '#92400e' }}>
                  <span style={{ fontWeight: 600 }}>How to resolve:</span> {resolutionText}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Next Steps summary */}
      {(counts.fail > 0 || counts.unclear > 0) && (
        <div style={{ border: '1px solid #e5e7eb', borderRadius: 10, padding: '14px 18px', marginTop: 16, backgroundColor: '#fafafa' }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#1f2937', marginBottom: 8 }}>Next Steps</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {results.filter(r => r.status === 'fail').map((r, i) => (
              <div key={`f${i}`} style={{ display: 'flex', alignItems: 'flex-start', gap: 6, fontSize: 12, color: '#991b1b' }}>
                <span style={{ flexShrink: 0, marginTop: 1 }}>&bull;</span>
                <span>
                  {r.required_value && r.actual_value
                    ? `Increase ${r.requirement_label} from ${r.actual_value} to ${r.required_value}`
                    : r.required_value
                      ? `Add ${r.requirement_label} coverage (${r.required_value} required)`
                      : `Obtain proof of ${r.requirement_label}`}
                </span>
              </div>
            ))}
            {results.filter(r => r.status === 'unclear').map((r, i) => (
              <div key={`u${i}`} style={{ display: 'flex', alignItems: 'flex-start', gap: 6, fontSize: 12, color: '#92400e' }}>
                <span style={{ flexShrink: 0, marginTop: 1 }}>&bull;</span>
                <span>Verify {r.requirement_label} with your carrier or agent</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

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
  const [showUploadAfterResults, setShowUploadAfterResults] = useState(false);
  const [reportText, setReportText] = useState('');

  useEffect(() => {
    if (!code) return;
    loadData();
  }, [code]);

  async function loadData() {
    try {
      const d = await leaseComplianceApi.getPublic(code);
      setData(d);
      // Pre-load existing results if available
      if (d.latest_check && d.latest_check.results.length > 0) {
        setResults(d.latest_check.results);
        setCounts({
          pass: d.latest_check.pass_count,
          fail: d.latest_check.fail_count,
          unclear: d.latest_check.unclear_count,
        });
        if (d.latest_check.report_text) setReportText(d.latest_check.report_text);
      }
    } catch (err: any) {
      setError(err.message || 'Requirements not found or link expired');
    } finally {
      setLoading(false);
    }
  }

  async function handleSubmitCoi() {
    const file = fileRef.current?.files?.[0];
    if (!file) { setError('Please select a PDF file to upload.'); return; }
    if (!file.name.toLowerCase().endsWith('.pdf')) { setError('Only PDF files are accepted.'); return; }
    setSubmitting(true);
    setError(null);
    try {
      const { id: checkId } = await leaseComplianceApi.submitCoiPublic(code, file, tenantName, tenantEmail, tenantNotes || undefined);

      for (let i = 0; i < 90; i++) {
        await new Promise(r => setTimeout(r, 2000));
        const status = await leaseComplianceApi.pollPublicCheckStatus(checkId);
        if (status.status === 'complete') {
          setResults(status.results || []);
          setCounts({ pass: status.pass_count || 0, fail: status.fail_count || 0, unclear: status.unclear_count || 0 });
          if (status.report_text) {
            setReportText(status.report_text);
          } else {
            // Report generates after pass/fail — poll for it
            const pollReport = async () => {
              for (let j = 0; j < 15; j++) {
                await new Promise(r => setTimeout(r, 3000));
                const s2 = await leaseComplianceApi.pollPublicCheckStatus(checkId);
                if (s2.report_text) { setReportText(s2.report_text); return; }
              }
            };
            pollReport();
          }
          setSubmitting(false);
          setShowUploadAfterResults(false);
          return;
        }
        if (status.status === 'error') {
          throw new Error(status.error || 'Document processing failed');
        }
      }
      throw new Error('Processing timed out — please try again');
    } catch (err: any) {
      setError(err.message || 'Submission failed');
    } finally {
      setSubmitting(false);
    }
  }

  const inputStyle: React.CSSProperties = { width: '100%', padding: '8px 10px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 14, boxSizing: 'border-box' };
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

  const isDocCheck = data.role === 'requester';
  const headerSubtitle = isDocCheck ? 'Insurance Compliance Requirements' : 'Lease Insurance Requirements';
  const requesterLabel = data.counterparty_name ? `Requested by ${data.counterparty_name}` : 'Compliance requirements have been shared with you';

  // Determine if we should show the upload form
  const showUpload = !results || showUploadAfterResults;

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
        <div style={{ maxWidth: 720, margin: '0 auto', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
          <div>
            <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 4 }}>Covrabl</div>
            <div style={{ fontSize: 13, opacity: 0.8 }}>{headerSubtitle}</div>
          </div>
          <button
            className="no-print"
            onClick={() => { trackClick('lease_public_print'); window.print(); }}
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
          <p style={{ fontSize: 14, color: '#374151', marginTop: 10, lineHeight: 1.6 }}>
            {requesterLabel}. Please review the requirements below and upload your Certificate of Insurance (COI) so it can be verified automatically.
          </p>
        </div>

        {/* Existing compliance results (from previous check or just-submitted) */}
        {results && <ResultsSection results={results} counts={counts} />}

        {/* Full Narrative Report */}
        {results && (
          <div style={{ marginBottom: 32 }}>
            <h2 style={{ fontSize: 16, fontWeight: 700, color: '#1f2937', marginBottom: 14 }}>Detailed Compliance Analysis</h2>
            {reportText ? (
              <div style={{ backgroundColor: '#fff', border: '1px solid #e5e7eb', borderRadius: 10, padding: '20px 24px', fontSize: 14, lineHeight: 1.8, color: '#1f2937', whiteSpace: 'pre-wrap' }}>
                {reportText}
              </div>
            ) : (
              <div style={{ padding: 20, textAlign: 'center', color: '#6b7280', fontSize: 13, border: '1px dashed #e5e7eb', borderRadius: 10 }}>
                Generating detailed analysis...
              </div>
            )}
          </div>
        )}

        {/* Post-results guidance */}
        {results && (
          <div className="no-print" style={{ marginBottom: 32 }}>
            {(() => {
              const allPass = counts.fail === 0 && counts.unclear === 0 && counts.pass > 0;
              const hasFail = counts.fail > 0;
              return (
                <div style={{
                  padding: 20, borderRadius: 10,
                  backgroundColor: allPass ? '#f0fdf4' : hasFail ? '#fef2f2' : '#fffbeb',
                  border: `1px solid ${allPass ? '#bbf7d0' : hasFail ? '#fecaca' : '#fde68a'}`,
                  marginBottom: 16,
                }}>
                  <h3 style={{ margin: '0 0 6px', fontSize: 15, fontWeight: 700, color: allPass ? '#166534' : hasFail ? '#991b1b' : '#92400e' }}>
                    {allPass ? 'Your insurance meets all requirements' : hasFail ? 'Action needed \u2014 some requirements were not met' : 'Some requirements need verification'}
                  </h3>
                  <p style={{ margin: 0, fontSize: 13, color: allPass ? '#15803d' : hasFail ? '#b91c1c' : '#a16207', lineHeight: 1.5 }}>
                    The requesting party has been notified automatically with these results.
                    {hasFail && ' Contact your insurance agent to update your coverage, then submit an updated certificate below.'}
                  </p>
                  {/* Resubmit button */}
                  {!showUploadAfterResults && (
                    <button
                      onClick={() => { trackClick('lease_public_resubmit'); setShowUploadAfterResults(true); }}
                      style={{
                        marginTop: 12, padding: '8px 18px', backgroundColor: hasFail ? '#991b1b' : '#1e3a5f',
                        color: '#fff', border: 'none', borderRadius: 6, fontWeight: 600, fontSize: 13, cursor: 'pointer',
                      }}
                    >
                      {hasFail ? 'Submit Updated Certificate' : 'Submit Another Certificate'}
                    </button>
                  )}
                </div>
              );
            })()}
          </div>
        )}

        {/* Requirements list */}
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

        {/* Submit COI section — always shown (for all roles) */}
        {showUpload && (
          <div className="no-print" style={{ backgroundColor: '#fff', border: '2px solid #bae6fd', borderRadius: 12, padding: 24, marginBottom: 32 }}>
            <h2 style={{ fontSize: 16, fontWeight: 700, color: '#1f2937', marginBottom: 4 }}>
              {results ? 'Submit Updated Certificate' : 'Submit Your Certificate of Insurance'}
            </h2>
            <p style={{ fontSize: 13, color: '#6b7280', marginBottom: 20 }}>
              Upload your COI (PDF) to automatically verify it against the requirements above. You'll see instant results.
            </p>

            <div className="form-grid-2" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
              <div>
                <label style={labelStyle}>Your Name</label>
                <input style={inputStyle} value={tenantName} onChange={e => setTenantName(e.target.value)} placeholder="Optional" />
              </div>
              <div>
                <label style={labelStyle}>Your Email</label>
                <input style={inputStyle} type="email" value={tenantEmail} onChange={e => setTenantEmail(e.target.value)} placeholder="Optional — for follow-up notifications" />
              </div>
            </div>

            <div style={{ marginBottom: 16 }}>
              <label style={labelStyle}>Notes (optional)</label>
              <textarea
                style={{ ...inputStyle, minHeight: 56, resize: 'vertical', fontFamily: 'inherit' }}
                value={tenantNotes}
                onChange={e => setTenantNotes(e.target.value)}
                placeholder="e.g., Updated policy attached — waiver of subrogation endorsement is on page 3"
              />
            </div>

            <div style={{ marginBottom: 16 }}>
              <label style={labelStyle}>Certificate of Insurance (PDF)</label>
              <input ref={fileRef} type="file" accept=".pdf" style={{ fontSize: 13, display: 'block', marginTop: 4 }} />
              <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 4 }}>&#128274; Your documents are encrypted and never shared.</div>
            </div>

            <button
              onClick={() => { trackClick('lease_public_submit_coi'); handleSubmitCoi(); }}
              disabled={submitting}
              style={{
                padding: '10px 24px', backgroundColor: '#1e3a5f', color: '#fff',
                border: 'none', borderRadius: 6, fontWeight: 600, fontSize: 14,
                cursor: submitting ? 'wait' : 'pointer', opacity: submitting ? 0.7 : 1,
              }}
            >
              {submitting ? 'Analyzing...' : 'Submit & Verify Certificate'}
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

        {/* Try Covrabl CTA — always visible */}
        <div className="no-print" style={{
          textAlign: 'center', padding: '28px 20px', marginBottom: 32,
          backgroundColor: '#fff', border: '1px solid #e5e7eb', borderRadius: 12,
        }}>
          <div style={{ fontSize: 22, marginBottom: 8 }}>&#128737;</div>
          <h3 style={{ fontSize: 16, fontWeight: 700, color: '#1f2937', marginBottom: 6 }}>
            Track your insurance with Covrabl
          </h3>
          <p style={{ fontSize: 13, color: '#6b7280', marginBottom: 16, maxWidth: 440, margin: '0 auto 16px', lineHeight: 1.6 }}>
            Manage all your policies in one place, get renewal reminders, run compliance checks, and share proof of insurance instantly.
          </p>
          <a
            href="https://covrabl.com/?ref=public-link"
            onClick={() => trackClick('lease_public_cta_try_covrabl')}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              display: 'inline-block', padding: '12px 28px', backgroundColor: '#1e3a5f', color: '#fff',
              borderRadius: 8, fontWeight: 700, fontSize: 15, textDecoration: 'none',
            }}
          >
            Try Covrabl Free
          </a>
          <p style={{ fontSize: 11, color: '#9ca3af', marginTop: 8 }}>No credit card required</p>
        </div>

        {/* Disclaimer */}
        <div style={{ marginTop: 40, padding: 16, backgroundColor: '#f3f4f6', borderRadius: 8, fontSize: 11, color: '#9ca3af', lineHeight: 1.6 }}>
          <strong>Disclaimer:</strong> This compliance check is provided for informational purposes only and does not constitute legal or insurance advice.
          Results indicate whether provided documentation appears to meet the stated requirements based on automated analysis.
          All results should be verified by a qualified insurance professional. &quot;Appears to meet&quot; indicates the documentation
          provided seems to satisfy the requirement but should be independently confirmed.
        </div>

        {/* Powered by */}
        <div style={{ textAlign: 'center', marginTop: 24, fontSize: 12, color: '#9ca3af' }}>
          Powered by <a href="https://covrabl.com" target="_blank" rel="noopener noreferrer" style={{ color: '#6b7280', textDecoration: 'underline' }}>Covrabl</a>
        </div>
      </div>
    </div>
  );
}
