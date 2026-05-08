'use client';

import { useState, useEffect } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { useAuth } from '../../../../../../lib/auth';
import { agentApi, QuoteComparisonData, RenewalDelta } from '../../../../../../lib/api';
import { trackClick, trackFeatureUse } from '../../../../../../lib/track';
import BackButton from '../../../../components/BackButton';

const fieldLabels: Record<string, string> = {
  carrier: 'Carrier',
  policy_number: 'Policy number',
  policy_type: 'Policy type',
  scope: 'Scope',
  coverage_amount: 'Coverage limit',
  deductible: 'Deductible',
  premium_amount: 'Premium',
  renewal_date: 'Effective date',
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

function formatDeltaLabel(d: RenewalDelta): string {
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

export default function QuoteComparisonPage() {
  const { token, role } = useAuth();
  const router = useRouter();
  const params = useParams();
  const clientId = Number(params.clientId);
  const comparisonId = Number(params.id);

  const [data, setData] = useState<QuoteComparisonData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [summaryDraft, setSummaryDraft] = useState('');
  const [savingSummary, setSavingSummary] = useState(false);
  const [summarySavedAt, setSummarySavedAt] = useState<number | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!token) { router.replace('/login'); return; }
    if (role && role !== 'agent' && role !== 'admin') { router.replace('/policies'); return; }
    let cancelled = false;
    (async () => {
      try {
        const r = await agentApi.getQuoteComparison(comparisonId);
        if (cancelled) return;
        setData(r);
        setSummaryDraft(r.summary_text || '');
      } catch (err: any) {
        if (cancelled) return;
        setError(err?.message || 'Failed to load quote comparison');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [token, role, comparisonId, router]);

  const saveSummary = async () => {
    if (!data) return;
    setSavingSummary(true);
    trackClick('agent_quote_save_summary', { comparison_id: comparisonId });
    try {
      const updated = await agentApi.updateQuoteComparison(comparisonId, summaryDraft);
      setData(updated);
      setSummarySavedAt(Date.now());
      trackFeatureUse('agent_quote_summary_saved', { comparison_id: comparisonId, length: summaryDraft.length });
    } catch (err: any) {
      alert(err?.message || 'Failed to save summary');
    } finally {
      setSavingSummary(false);
    }
  };

  const generateShareLink = async () => {
    if (!data) return;
    trackClick('agent_quote_share_generate', { comparison_id: comparisonId });
    try {
      const r = await agentApi.shareQuoteComparison(comparisonId);
      setData({ ...data, share_token: r.share_token, shared_at: r.shared_at });
      trackFeatureUse('agent_quote_share_link_created', { comparison_id: comparisonId });
    } catch (err: any) {
      alert(err?.message || 'Failed to create share link');
    }
  };

  const revokeShare = async () => {
    if (!data) return;
    if (!confirm('Revoke this share link? Anyone holding the URL will lose access.')) return;
    trackClick('agent_quote_share_revoke', { comparison_id: comparisonId });
    try {
      await agentApi.revokeQuoteShare(comparisonId);
      setData({ ...data, share_token: null, shared_at: null });
    } catch (err: any) {
      alert(err?.message || 'Failed to revoke link');
    }
  };

  const deleteComparison = async () => {
    if (!data) return;
    if (!confirm('Delete this quote comparison? This does not delete either policy.')) return;
    try {
      await agentApi.deleteQuoteComparison(comparisonId);
      router.push(`/agent/${clientId}`);
    } catch (err: any) {
      alert(err?.message || 'Failed to delete comparison');
    }
  };

  if (!token || loading) {
    return <div style={{ padding: 40, textAlign: 'center', color: 'var(--color-text-muted)' }}>Loading...</div>;
  }
  if (error || !data) {
    return (
      <div style={{ padding: 40, textAlign: 'center' }}>
        <p style={{ color: 'var(--color-danger)' }}>{error || 'Not found'}</p>
        <button
          onClick={() => router.push(`/agent/${clientId}`)}
          style={{ marginTop: 16, padding: '8px 20px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', background: 'var(--color-surface)', cursor: 'pointer', color: 'var(--color-text)' }}
        >
          Back to client
        </button>
      </div>
    );
  }

  const visibleDeltas = data.deltas.filter(d => d.field_key !== 'policy_number');
  const shareUrl = data.share_token
    ? (typeof window !== 'undefined' ? `${window.location.origin}/quote-comparison/${data.share_token}` : '')
    : '';

  return (
    <div style={{ padding: '32px 24px', maxWidth: 900, margin: '0 auto' }}>
      <BackButton href={`/agent/${clientId}`} label="Quote comparison" parentLabel="Client" />

      <div style={{ marginBottom: 8 }}>
        <h1 style={{ fontSize: 24, fontWeight: 700, margin: '0 0 4px', color: 'var(--color-text)' }}>
          Quote Comparison
        </h1>
        <p style={{ fontSize: 14, color: 'var(--color-text-secondary)', margin: 0 }}>
          {data.incumbent_policy.policy_type} &middot; {data.incumbent_policy.carrier} vs. {data.quote_policy.carrier}
        </p>
      </div>

      <div style={{
        padding: '10px 14px',
        marginTop: 16,
        marginBottom: 24,
        backgroundColor: '#f0f9ff',
        border: '1px solid #bae6fd',
        borderRadius: 'var(--radius-md)',
        fontSize: 12,
        lineHeight: 1.5,
        color: '#0c4a6e',
      }}>
        <strong>Structured differences only.</strong> Field-level differences are pulled from the two policies.
        Add your own commentary below before sharing &mdash; the agent stays the authority on whether a quote
        is the right fit.
      </div>

      {/* Two-policy header: Incumbent → Quote */}
      <div className="card" style={{ padding: 16, marginBottom: 24 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', alignItems: 'center', gap: 16 }}>
          <div>
            <div style={{ fontSize: 11, color: 'var(--color-text-muted)', fontWeight: 600, textTransform: 'uppercase', marginBottom: 4 }}>Current</div>
            <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-text)' }}>
              {data.incumbent_policy.carrier}
            </div>
            <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>
              {data.incumbent_policy.policy_number || '--'}
            </div>
          </div>
          <div style={{ fontSize: 18, color: 'var(--color-text-muted)' }}>vs.</div>
          <div>
            <div style={{ fontSize: 11, color: 'var(--color-text-muted)', fontWeight: 600, textTransform: 'uppercase', marginBottom: 4 }}>Quote</div>
            <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-text)' }}>
              {data.quote_policy.carrier}
            </div>
            <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>
              {data.quote_policy.policy_number || '--'}
            </div>
          </div>
        </div>
        <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--color-border)', display: 'flex', justifyContent: 'flex-end' }}>
          <button
            onClick={deleteComparison}
            style={{
              padding: '4px 12px',
              border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius-sm)',
              background: 'transparent',
              fontSize: 12,
              color: 'var(--color-text-muted)',
              cursor: 'pointer',
            }}
          >
            Delete comparison
          </button>
        </div>
      </div>

      <h2 style={{ fontSize: 16, fontWeight: 600, margin: '0 0 12px', color: 'var(--color-text)' }}>
        Structured differences
      </h2>
      {visibleDeltas.length === 0 ? (
        <div className="card" style={{ padding: 24, textAlign: 'center', color: 'var(--color-text-muted)', fontSize: 13, marginBottom: 24 }}>
          No tracked fields differ between the current policy and this quote.
        </div>
      ) : (
        <div className="card" style={{ padding: 0, marginBottom: 24, overflow: 'hidden' }}>
          {visibleDeltas.map((d, i) => {
            const colors = severityColors[d.severity] || severityColors.info;
            return (
              <div
                key={`${d.field_key}-${i}`}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '180px 1fr 1fr 110px',
                  alignItems: 'center',
                  padding: '12px 16px',
                  borderBottom: i < visibleDeltas.length - 1 ? '1px solid var(--color-border)' : 'none',
                  gap: 12,
                }}
              >
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-text)' }}>
                  {fieldLabels[d.field_key] || d.field_key}
                </div>
                <div style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>
                  {formatValue(d.field_key, d.old_value)}
                </div>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-text)' }}>
                  <div>{formatValue(d.field_key, d.new_value)}</div>
                  {changeIndicator(d) && (
                    <div style={{ fontSize: 11, color: 'var(--color-text-muted)', fontWeight: 500, marginTop: 2 }}>
                      {changeIndicator(d)}
                    </div>
                  )}
                </div>
                <div style={{ textAlign: 'right' }}>
                  <span style={{
                    padding: '2px 10px', borderRadius: 12, fontSize: 11, fontWeight: 600,
                    backgroundColor: colors.bg, color: colors.fg,
                  }}>
                    {formatDeltaLabel(d)}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {data.discussion_items && data.discussion_items.length > 0 && (
        <>
          <h2 style={{ fontSize: 16, fontWeight: 600, margin: '0 0 4px', color: 'var(--color-text)' }}>
            Items to discuss
          </h2>
          <p style={{ fontSize: 12, color: 'var(--color-text-muted)', margin: '0 0 12px' }}>
            Observational prompts based on the differences above. Click <span style={{ fontWeight: 600 }}>×</span> on any item to exclude it from the client-facing share page.
          </p>
          <div className="card" style={{ padding: 0, marginBottom: 24, overflow: 'hidden' }}>
            {data.discussion_items.map((item, i) => (
              <div
                key={item.hash}
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: 12,
                  padding: '12px 16px',
                  borderBottom: i < (data.discussion_items?.length ?? 0) - 1 ? '1px solid var(--color-border)' : 'none',
                  backgroundColor: item.dismissed ? '#fafafa' : 'transparent',
                }}
              >
                <div
                  style={{
                    flex: 1,
                    fontSize: 13,
                    lineHeight: 1.55,
                    color: item.dismissed ? 'var(--color-text-muted)' : 'var(--color-text)',
                    textDecoration: item.dismissed ? 'line-through' : 'none',
                  }}
                >
                  {item.text}
                </div>
                <button
                  onClick={async () => {
                    try {
                      trackClick('agent_quote_dismiss_item', { comparison_id: comparisonId, hash: item.hash, dismiss: !item.dismissed });
                      const updated = await agentApi.dismissQuoteItem(comparisonId, item.hash, !item.dismissed);
                      setData(updated);
                    } catch (err: any) {
                      alert(err?.message || 'Failed to update item');
                    }
                  }}
                  title={item.dismissed ? 'Restore this item to the client share' : 'Hide this item from the client share'}
                  style={{
                    padding: '2px 10px',
                    fontSize: 11,
                    fontWeight: 600,
                    backgroundColor: item.dismissed ? 'var(--color-surface)' : 'transparent',
                    color: item.dismissed ? 'var(--color-primary)' : 'var(--color-text-muted)',
                    border: '1px solid var(--color-border)',
                    borderRadius: 'var(--radius-sm)',
                    cursor: 'pointer',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {item.dismissed ? 'Restore' : '× Hide'}
                </button>
              </div>
            ))}
          </div>
        </>
      )}

      <h2 style={{ fontSize: 16, fontWeight: 600, margin: '0 0 4px', color: 'var(--color-text)' }}>
        Your summary for the client
      </h2>
      <p style={{ fontSize: 12, color: 'var(--color-text-muted)', margin: '0 0 12px' }}>
        Plain-language context only you can provide &mdash; this is what the client will read.
      </p>
      <textarea
        value={summaryDraft}
        onChange={e => setSummaryDraft(e.target.value)}
        rows={6}
        placeholder="Example: This quote drops the liability limit from $300K to $250K and raises the deductible by $500. Premium is ~17% lower. Discuss whether the savings justify the reduced limit before binding."
        style={{
          width: '100%',
          padding: '12px 14px',
          border: '1px solid var(--color-border)',
          borderRadius: 'var(--radius-md)',
          fontSize: 14,
          lineHeight: 1.55,
          outline: 'none',
          backgroundColor: 'var(--color-surface)',
          color: 'var(--color-text)',
          resize: 'vertical',
          fontFamily: 'inherit',
          boxSizing: 'border-box',
        }}
      />
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 8, marginBottom: 24 }}>
        <button
          onClick={saveSummary}
          disabled={savingSummary || summaryDraft === (data.summary_text || '')}
          style={{
            padding: '8px 18px',
            backgroundColor: 'var(--color-primary)',
            color: '#fff',
            border: 'none',
            borderRadius: 'var(--radius-md)',
            fontSize: 13,
            fontWeight: 600,
            cursor: savingSummary ? 'wait' : 'pointer',
            opacity: (savingSummary || summaryDraft === (data.summary_text || '')) ? 0.6 : 1,
          }}
        >
          {savingSummary ? 'Saving...' : 'Save summary'}
        </button>
        {summarySavedAt && Date.now() - summarySavedAt < 4000 && (
          <span style={{ fontSize: 12, color: 'var(--color-success)' }}>Saved.</span>
        )}
      </div>

      <h2 style={{ fontSize: 16, fontWeight: 600, margin: '0 0 4px', color: 'var(--color-text)' }}>
        Share with client
      </h2>
      <p style={{ fontSize: 12, color: 'var(--color-text-muted)', margin: '0 0 12px' }}>
        Generates a public read-only link &mdash; no login required.
      </p>
      <div className="card" style={{ padding: 16 }}>
        {data.share_token ? (
          <>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12, flexWrap: 'wrap' }}>
              <input
                readOnly
                value={shareUrl}
                onClick={e => (e.target as HTMLInputElement).select()}
                style={{
                  flex: 1,
                  minWidth: 240,
                  padding: '8px 12px',
                  border: '1px solid var(--color-border)',
                  borderRadius: 'var(--radius-md)',
                  fontSize: 13,
                  fontFamily: 'monospace',
                  backgroundColor: 'var(--color-bg)',
                  color: 'var(--color-text)',
                }}
              />
              <button
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(shareUrl);
                    setCopied(true);
                    setTimeout(() => setCopied(false), 1500);
                    trackClick('agent_quote_share_copy', { comparison_id: comparisonId });
                  } catch {
                    alert('Could not copy. Select the URL and copy manually.');
                  }
                }}
                style={{
                  padding: '8px 14px',
                  backgroundColor: 'var(--color-primary)',
                  color: '#fff',
                  border: 'none',
                  borderRadius: 'var(--radius-md)',
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                {copied ? 'Copied' : 'Copy link'}
              </button>
              <a
                href={`/quote-comparison/${data.share_token}`}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  padding: '8px 14px',
                  border: '1px solid var(--color-border)',
                  borderRadius: 'var(--radius-md)',
                  fontSize: 13,
                  textDecoration: 'none',
                  color: 'var(--color-text)',
                }}
              >
                Open
              </a>
            </div>
            <button
              onClick={revokeShare}
              style={{
                padding: '4px 12px',
                border: '1px solid var(--color-border)',
                borderRadius: 'var(--radius-sm)',
                background: 'transparent',
                fontSize: 12,
                color: 'var(--color-text-muted)',
                cursor: 'pointer',
              }}
            >
              Revoke link
            </button>
          </>
        ) : (
          <button
            onClick={generateShareLink}
            style={{
              padding: '8px 18px',
              backgroundColor: 'var(--color-primary)',
              color: '#fff',
              border: 'none',
              borderRadius: 'var(--radius-md)',
              fontSize: 13,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Generate share link
          </button>
        )}
      </div>
    </div>
  );
}
