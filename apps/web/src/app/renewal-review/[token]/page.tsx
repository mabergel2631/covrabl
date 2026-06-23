'use client';

import { useEffect, useState, Suspense } from 'react';
import { useParams, useSearchParams, useRouter } from 'next/navigation';
import { agentApi, PublicRenewalReviewData, RenewalDelta } from '../../../../lib/api';

const fieldLabels: Record<string, string> = {
  carrier: 'Carrier',
  policy_number: 'Policy number',
  policy_type: 'Policy type',
  scope: 'Scope',
  coverage_amount: 'Coverage limit',
  deductible: 'Deductible',
  premium_amount: 'Premium',
  renewal_date: 'Renewal date',
};

const severityColors: Record<string, { bg: string; fg: string }> = {
  critical: { bg: '#fee2e2', fg: '#991b1b' },
  warning: { bg: '#fef3c7', fg: '#92400e' },
  info: { bg: '#dbeafe', fg: '#1e40af' },
};

function formatValue(field: string, value: string | null): string {
  if (value === null || value === '') return '—';
  if (field === 'coverage_amount' || field === 'deductible' || field === 'premium_amount') {
    const n = Number(value);
    if (!Number.isNaN(n)) return `$${n.toLocaleString()}`;
  }
  return value;
}

function formatDelta(d: RenewalDelta): string {
  if (d.delta_type === 'added') return 'Added';
  if (d.delta_type === 'removed') return 'Removed';
  if (d.delta_type === 'increased') return 'Increased';
  if (d.delta_type === 'decreased') return 'Decreased';
  return 'Changed';
}

function changeIndicator(d: RenewalDelta): string | null {
  if (!['coverage_amount', 'deductible', 'premium_amount'].includes(d.field_key)) return null;
  const oldN = Number(d.old_value);
  const newN = Number(d.new_value);
  if (Number.isNaN(oldN) || Number.isNaN(newN) || oldN === 0) return null;
  const diff = newN - oldN;
  const pct = (diff / oldN) * 100;
  const sign = diff >= 0 ? '+' : '';
  if (Math.abs(pct) >= 1.0) return `${sign}${pct.toFixed(pct >= 100 ? 0 : 1)}%`;
  return `${sign}$${Math.abs(diff).toLocaleString()}`;
}

function PublicRenewalReviewContent() {
  const params = useParams();
  const searchParams = useSearchParams();
  const router = useRouter();
  const token = String(params.token || '');
  // Preview mode: the agent opened this via the "Preview" button. We show an
  // exit bar that returns to the exact agent screen. `return` is only honored
  // when it's an internal /agent/ path (guards against open-redirect).
  const rawReturn = searchParams.get('return') || '';
  const returnUrl = rawReturn.startsWith('/agent/') ? rawReturn : '';
  const isPreview = searchParams.get('preview') === '1';
  const exitPreview = () => {
    if (returnUrl) router.push(returnUrl);
    else router.back();
  };
  const [data, setData] = useState<PublicRenewalReviewData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await agentApi.publicRenewalReview(token);
        if (!cancelled) setData(r);
      } catch (err: any) {
        if (!cancelled) setError(err?.status === 404 ? 'This renewal review link is no longer valid.' : (err?.message || 'Could not load renewal review.'));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [token]);

  const previewBar = isPreview ? (
    <div style={{
      position: 'sticky', top: 0, zIndex: 50,
      display: 'flex', alignItems: 'center', gap: 12,
      padding: '10px 20px',
      backgroundColor: '#0f172a', color: '#fff',
      boxShadow: '0 1px 4px rgba(0,0,0,0.15)',
    }}>
      <button
        onClick={exitPreview}
        aria-label="Exit preview"
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 6,
          padding: '6px 12px',
          backgroundColor: 'rgba(255,255,255,0.12)', color: '#fff',
          border: '1px solid rgba(255,255,255,0.25)', borderRadius: 8,
          fontSize: 13, fontWeight: 600, cursor: 'pointer',
        }}
      >
        <span style={{ fontSize: 16, lineHeight: 1 }}>&larr;</span> Exit preview
      </button>
      <span style={{ fontSize: 13, color: 'rgba(255,255,255,0.8)' }}>
        Preview &mdash; this is what your client sees. They won&rsquo;t see this bar.
      </span>
    </div>
  ) : null;

  if (loading) {
    return (
      <>
        {previewBar}
        <div style={{ padding: 40, textAlign: 'center', color: '#64748b' }}>Loading renewal review...</div>
      </>
    );
  }
  if (error || !data) {
    return (
      <>
        {previewBar}
        <div style={{ padding: 40, textAlign: 'center' }}>
          <p style={{ color: '#dc2626' }}>{error || 'Not found'}</p>
          <p style={{ fontSize: 13, color: '#64748b', marginTop: 12 }}>Reach out to your agent for an updated link.</p>
        </div>
      </>
    );
  }

  return (
    <div style={{ minHeight: '100vh', backgroundColor: '#f8fafc' }}>
      {previewBar}
      <div style={{ maxWidth: 800, margin: '0 auto', padding: '40px 24px' }}>
        <div style={{ marginBottom: 32 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>
            Renewal Review
          </div>
          <h1 style={{ fontSize: 28, fontWeight: 700, color: '#0f172a', margin: '0 0 6px' }}>
            {data.policy.carrier} &middot; {data.policy.policy_type}
          </h1>
          <p style={{ fontSize: 14, color: '#64748b', margin: 0 }}>
            Prepared by {data.agent.name || data.agent.email || 'your agent'}
            {data.shared_at && (
              <> &middot; {new Date(data.shared_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}</>
            )}
          </p>
        </div>

        {/* Agent summary first — most valuable */}
        {data.summary_text && (
          <div style={{
            padding: '20px 24px',
            backgroundColor: '#fff',
            border: '1px solid #e2e8f0',
            borderRadius: 12,
            marginBottom: 24,
            boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
          }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', marginBottom: 10 }}>
              Notes from your agent
            </div>
            <div style={{ fontSize: 15, color: '#0f172a', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>
              {data.summary_text}
            </div>
          </div>
        )}

        {/* Two-policy header */}
        {data.previous_policy && (
          <div style={{
            padding: 20,
            backgroundColor: '#fff',
            border: '1px solid #e2e8f0',
            borderRadius: 12,
            marginBottom: 24,
            boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
          }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', alignItems: 'center', gap: 16 }}>
              <div>
                <div style={{ fontSize: 11, color: '#64748b', fontWeight: 700, textTransform: 'uppercase', marginBottom: 4 }}>Previous term</div>
                <div style={{ fontSize: 15, fontWeight: 600, color: '#0f172a' }}>
                  {data.previous_policy.carrier}
                </div>
                <div style={{ fontSize: 12, color: '#64748b' }}>
                  {data.previous_policy.policy_number || '--'}
                  {data.previous_policy.renewal_date && <> &middot; renewed {data.previous_policy.renewal_date}</>}
                </div>
              </div>
              <div style={{ fontSize: 18, color: '#94a3b8' }}>→</div>
              <div>
                <div style={{ fontSize: 11, color: '#64748b', fontWeight: 700, textTransform: 'uppercase', marginBottom: 4 }}>This term</div>
                <div style={{ fontSize: 15, fontWeight: 600, color: '#0f172a' }}>
                  {data.policy.carrier}
                </div>
                <div style={{ fontSize: 12, color: '#64748b' }}>
                  {data.policy.policy_number || '--'}
                  {data.policy.renewal_date && <> &middot; renews {data.policy.renewal_date}</>}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Structured changes — hide policy_number (routine renewal mechanic, not actionable) */}
        {(() => {
          const visibleDeltas = data.deltas.filter(d => d.field_key !== 'policy_number');
          return (
        <>
        <h2 style={{ fontSize: 16, fontWeight: 600, color: '#0f172a', margin: '0 0 12px' }}>
          What changed
        </h2>
        {visibleDeltas.length === 0 ? (
          <div style={{
            padding: 24,
            backgroundColor: '#fff',
            border: '1px solid #e2e8f0',
            borderRadius: 12,
            textAlign: 'center',
            color: '#64748b',
            fontSize: 14,
            marginBottom: 24,
          }}>
            No tracked field changes between these two policies.
          </div>
        ) : (
          <div style={{
            backgroundColor: '#fff',
            border: '1px solid #e2e8f0',
            borderRadius: 12,
            marginBottom: 24,
            overflow: 'hidden',
            boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
          }}>
            {visibleDeltas.map((d, i) => {
              const colors = severityColors[d.severity] || severityColors.info;
              return (
                <div
                  key={`${d.field_key}-${i}`}
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '160px 1fr 1fr 100px',
                    alignItems: 'center',
                    padding: '14px 16px',
                    borderBottom: i < visibleDeltas.length - 1 ? '1px solid #e2e8f0' : 'none',
                    gap: 12,
                  }}
                >
                  <div style={{ fontSize: 13, fontWeight: 600, color: '#0f172a' }}>
                    {fieldLabels[d.field_key] || d.field_key}
                  </div>
                  <div style={{ fontSize: 13, color: '#64748b', textDecoration: d.delta_type === 'removed' ? 'line-through' : 'none' }}>
                    {formatValue(d.field_key, d.old_value)}
                  </div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: '#0f172a' }}>
                    <div>{formatValue(d.field_key, d.new_value)}</div>
                    {changeIndicator(d) && (
                      <div style={{ fontSize: 11, color: '#64748b', fontWeight: 500, marginTop: 2 }}>
                        {changeIndicator(d)}
                      </div>
                    )}
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <span style={{
                      padding: '2px 10px', borderRadius: 12, fontSize: 11, fontWeight: 600,
                      backgroundColor: colors.bg, color: colors.fg,
                    }}>
                      {formatDelta(d)}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
        </>
          );
        })()}

        {/* Items to Discuss — observational prompts (dismissed items already filtered server-side) */}
        {data.discussion_items && data.discussion_items.length > 0 && (
          <>
            <h2 style={{ fontSize: 16, fontWeight: 600, color: '#0f172a', margin: '24px 0 12px' }}>
              Items to discuss with your agent
            </h2>
            <div style={{
              backgroundColor: '#fff',
              border: '1px solid #e2e8f0',
              borderRadius: 12,
              marginBottom: 24,
              overflow: 'hidden',
              boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
            }}>
              {data.discussion_items.map((item, i) => (
                <div
                  key={item.hash}
                  style={{
                    padding: '14px 18px',
                    borderBottom: i < (data.discussion_items?.length ?? 0) - 1 ? '1px solid #e2e8f0' : 'none',
                    fontSize: 14,
                    lineHeight: 1.6,
                    color: '#0f172a',
                  }}
                >
                  {item.text}
                </div>
              ))}
            </div>
          </>
        )}

        {/* Disclaimer */}
        <div style={{
          padding: '14px 18px',
          backgroundColor: '#f0f9ff',
          border: '1px solid #bae6fd',
          borderRadius: 12,
          fontSize: 12,
          lineHeight: 1.5,
          color: '#0c4a6e',
          marginBottom: 24,
        }}>
          This summary highlights structured differences between the two policies based on documents your
          agent has on file. It may miss exclusions, endorsements, or recent changes &mdash; confirm details
          directly with your agent or carrier before relying on it.
        </div>

        <div style={{ textAlign: 'center', fontSize: 11, color: '#94a3b8' }}>
          Powered by <a href="https://covrabl.com" target="_blank" rel="noopener noreferrer" style={{ color: '#64748b', textDecoration: 'underline' }}>Covrabl</a>
        </div>
      </div>
    </div>
  );
}

export default function PublicRenewalReviewPage() {
  return (
    <Suspense fallback={<div style={{ padding: 40, textAlign: 'center', color: '#64748b' }}>Loading renewal review...</div>}>
      <PublicRenewalReviewContent />
    </Suspense>
  );
}
