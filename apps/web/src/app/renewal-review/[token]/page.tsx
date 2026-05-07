'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
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

export default function PublicRenewalReviewPage() {
  const params = useParams();
  const token = String(params.token || '');
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

  if (loading) {
    return <div style={{ padding: 40, textAlign: 'center', color: '#64748b' }}>Loading renewal review...</div>;
  }
  if (error || !data) {
    return (
      <div style={{ padding: 40, textAlign: 'center' }}>
        <p style={{ color: '#dc2626' }}>{error || 'Not found'}</p>
        <p style={{ fontSize: 13, color: '#64748b', marginTop: 12 }}>Reach out to your agent for an updated link.</p>
      </div>
    );
  }

  return (
    <div style={{ minHeight: '100vh', backgroundColor: '#f8fafc' }}>
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

        {/* Structured changes */}
        <h2 style={{ fontSize: 16, fontWeight: 600, color: '#0f172a', margin: '0 0 12px' }}>
          What changed
        </h2>
        {data.deltas.length === 0 ? (
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
            {data.deltas.map((d, i) => {
              const colors = severityColors[d.severity] || severityColors.info;
              return (
                <div
                  key={`${d.field_key}-${i}`}
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '160px 1fr 1fr 100px',
                    alignItems: 'center',
                    padding: '14px 16px',
                    borderBottom: i < data.deltas.length - 1 ? '1px solid #e2e8f0' : 'none',
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
                    {formatValue(d.field_key, d.new_value)}
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
