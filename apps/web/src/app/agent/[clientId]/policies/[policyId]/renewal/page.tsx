'use client';

import { useState, useEffect } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { useAuth } from '../../../../../../../lib/auth';
import { agentApi, RenewalReviewData, RenewalDelta } from '../../../../../../../lib/api';
import { trackClick, trackFeatureUse } from '../../../../../../../lib/track';
import BackButton from '../../../../../components/BackButton';

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
  // Only meaningful for numeric fields. Returns "+11.7%" or "-$500".
  if (!['coverage_amount', 'deductible', 'premium_amount'].includes(d.field_key)) return null;
  const oldN = Number(d.old_value);
  const newN = Number(d.new_value);
  if (Number.isNaN(oldN) || Number.isNaN(newN) || oldN === 0) return null;
  const diff = newN - oldN;
  const pct = (diff / oldN) * 100;
  const sign = diff >= 0 ? '+' : '';
  // Show % when the absolute change is small relative to base; show $ when large.
  if (Math.abs(pct) >= 1.0) return `${sign}${pct.toFixed(pct >= 100 ? 0 : 1)}%`;
  return `${sign}$${Math.abs(diff).toLocaleString()}`;
}

export default function RenewalReviewPage() {
  const { token, role } = useAuth();
  const router = useRouter();
  const params = useParams();
  const clientId = Number(params.clientId);
  const policyId = Number(params.policyId);

  const [data, setData] = useState<RenewalReviewData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [summaryDraft, setSummaryDraft] = useState('');
  const [savingSummary, setSavingSummary] = useState(false);
  const [summarySavedAt, setSummarySavedAt] = useState<number | null>(null);
  const [sharing, setSharing] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!token) { router.replace('/login'); return; }
    if (role && role !== 'agent' && role !== 'admin') { router.replace('/policies'); return; }
    let cancelled = false;
    (async () => {
      try {
        const r = await agentApi.renewalReview(policyId);
        if (cancelled) return;
        setData(r);
        setSummaryDraft(r.summary_text || '');
      } catch (err: any) {
        if (cancelled) return;
        setError(err?.message || 'Failed to load renewal review');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [token, role, policyId, router]);

  const saveSummary = async () => {
    if (!data) return;
    setSavingSummary(true);
    trackClick('agent_renewal_save_summary', { policy_id: policyId });
    try {
      const updated = await agentApi.updateRenewalReview(policyId, summaryDraft);
      setData(updated);
      setSummarySavedAt(Date.now());
      trackFeatureUse('agent_renewal_summary_saved', { policy_id: policyId, length: summaryDraft.length });
    } catch (err: any) {
      alert(err?.message || 'Failed to save summary');
    } finally {
      setSavingSummary(false);
    }
  };

  const generateShareLink = async () => {
    if (!data) return;
    setSharing(true);
    trackClick('agent_renewal_share_generate', { policy_id: policyId });
    try {
      const r = await agentApi.shareRenewalReview(policyId);
      setData({ ...data, share_token: r.share_token, shared_at: r.shared_at });
      trackFeatureUse('agent_renewal_share_link_created', { policy_id: policyId });
    } catch (err: any) {
      alert(err?.message || 'Failed to create share link');
    } finally {
      setSharing(false);
    }
  };

  const revokeShare = async () => {
    if (!data) return;
    if (!confirm('Revoke this share link? Anyone holding the URL will lose access.')) return;
    trackClick('agent_renewal_share_revoke', { policy_id: policyId });
    try {
      await agentApi.revokeRenewalShare(policyId);
      setData({ ...data, share_token: null, shared_at: null });
    } catch (err: any) {
      alert(err?.message || 'Failed to revoke link');
    }
  };

  const unlinkRenewal = async () => {
    if (!data) return;
    if (!confirm('Remove the renewal link? The change history for this policy will be cleared.')) return;
    trackClick('agent_renewal_unlink', { policy_id: policyId });
    try {
      await agentApi.unlinkRenewal(clientId, policyId);
      router.push(`/agent/${clientId}`);
    } catch (err: any) {
      alert(err?.message || 'Failed to unlink');
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

  const isLinked = !!data.previous_policy;
  const shareUrl = data.share_token
    ? (typeof window !== 'undefined' ? `${window.location.origin}/renewal-review/${data.share_token}` : '')
    : '';

  return (
    <div style={{ padding: '32px 24px', maxWidth: 900, margin: '0 auto' }}>
      <BackButton href={`/agent/${clientId}`} label="Renewal review" parentLabel="Client" />

      <div style={{ marginBottom: 8 }}>
        <h1 style={{ fontSize: 24, fontWeight: 700, margin: '0 0 4px', color: 'var(--color-text)' }}>
          Renewal Review
        </h1>
        <p style={{ fontSize: 14, color: 'var(--color-text-secondary)', margin: 0 }}>
          {data.policy.carrier} &middot; {data.policy.policy_type}
          {data.policy.policy_number && <> &middot; {data.policy.policy_number}</>}
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
        <strong>Structured differences only.</strong> Field-level changes are pulled from the two policies.
        Add your own commentary below before sharing &mdash; the agent stays the authority on whether a change
        is favorable or not.
      </div>

      {!isLinked ? (
        <div className="card" style={{ padding: 24 }}>
          <p style={{ fontSize: 14, color: 'var(--color-text)', margin: '0 0 8px' }}>
            This policy isn&rsquo;t linked to a previous version yet.
          </p>
          <p style={{ fontSize: 13, color: 'var(--color-text-muted)', margin: '0 0 16px' }}>
            Open the client page and use the &ldquo;Mark as renewal of...&rdquo; option on this policy to
            link it. Once linked, you&rsquo;ll see the structured changes and a place to write your summary
            here.
          </p>
          <button
            onClick={() => router.push(`/agent/${clientId}`)}
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
            Back to client
          </button>
        </div>
      ) : (
        <>
          {/* Two-policy header */}
          <div className="card" style={{ padding: 16, marginBottom: 24 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', alignItems: 'center', gap: 16 }}>
              <div>
                <div style={{ fontSize: 11, color: 'var(--color-text-muted)', fontWeight: 600, textTransform: 'uppercase', marginBottom: 4 }}>Previous</div>
                <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-text)' }}>
                  {data.previous_policy!.carrier}
                </div>
                <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>
                  {data.previous_policy!.policy_number || '--'}
                  {data.previous_policy!.renewal_date && <> &middot; renewed {data.previous_policy!.renewal_date}</>}
                </div>
              </div>
              <div style={{ fontSize: 18, color: 'var(--color-text-muted)' }}>→</div>
              <div>
                <div style={{ fontSize: 11, color: 'var(--color-text-muted)', fontWeight: 600, textTransform: 'uppercase', marginBottom: 4 }}>Current</div>
                <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-text)' }}>
                  {data.policy.carrier}
                </div>
                <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>
                  {data.policy.policy_number || '--'}
                  {data.policy.renewal_date && <> &middot; renews {data.policy.renewal_date}</>}
                </div>
              </div>
            </div>
            <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--color-border)', display: 'flex', justifyContent: 'flex-end' }}>
              <button
                onClick={unlinkRenewal}
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
                Remove renewal link
              </button>
            </div>
          </div>

          {/* Structured changes — hide policy_number (routine renewal mechanic, not actionable) */}
          {(() => {
            const visibleDeltas = data.deltas.filter(d => d.field_key !== 'policy_number');
            return (
          <>
          <h2 style={{ fontSize: 16, fontWeight: 600, margin: '0 0 12px', color: 'var(--color-text)' }}>
            Structured changes
          </h2>
          {visibleDeltas.length === 0 ? (
            <div className="card" style={{ padding: 24, textAlign: 'center', color: 'var(--color-text-muted)', fontSize: 13, marginBottom: 24 }}>
              No tracked fields differ between these two policies.
            </div>
          ) : (
            <div className="card" style={{ padding: 0, marginBottom: 24, overflow: 'hidden' }}>
              {visibleDeltas.map((d, i) => {
                const colors = severityColors[d.severity] || severityColors.info;
                return (
                  <div
                    key={d.id ?? `${d.field_key}-${i}`}
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
                    <div style={{ fontSize: 13, color: 'var(--color-text-muted)', textDecoration: d.delta_type === 'removed' ? 'line-through' : 'none' }}>
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

          {/* Items to Discuss — observational, rule-based, agent-curatable */}
          {data.discussion_items && data.discussion_items.length > 0 && (
            <>
              <h2 style={{ fontSize: 16, fontWeight: 600, margin: '0 0 4px', color: 'var(--color-text)' }}>
                Items to discuss
              </h2>
              <p style={{ fontSize: 12, color: 'var(--color-text-muted)', margin: '0 0 12px' }}>
                Observational prompts based on the changes above. Click <span style={{ fontWeight: 600 }}>×</span> on any item to exclude it from the client-facing share page — it stays here struck-through so you can restore it.
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
                          trackClick('agent_renewal_dismiss_item', { policy_id: policyId, hash: item.hash, dismiss: !item.dismissed });
                          const updated = await agentApi.dismissDiscussionItem(policyId, item.hash, !item.dismissed);
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

          {/* Agent summary */}
          <h2 style={{ fontSize: 16, fontWeight: 600, margin: '0 0 4px', color: 'var(--color-text)' }}>
            Your summary for the client
          </h2>
          <p style={{ fontSize: 12, color: 'var(--color-text-muted)', margin: '0 0 12px' }}>
            Plain-language context only you can provide. Keep it factual &mdash; this is what the client will read.
          </p>
          <textarea
            value={summaryDraft}
            onChange={e => setSummaryDraft(e.target.value)}
            rows={6}
            placeholder="Example: Premium increased ~9% driven by carrier base-rate adjustment. Wind deductible moved to a percentage from a flat amount. We held the umbrella limit at $5M as discussed."
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

          {/* Share */}
          <h2 style={{ fontSize: 16, fontWeight: 600, margin: '0 0 4px', color: 'var(--color-text)' }}>
            Share with client
          </h2>
          <p style={{ fontSize: 12, color: 'var(--color-text-muted)', margin: '0 0 12px' }}>
            Generates a public read-only link. Anyone with the link can view the changes and your summary &mdash;
            no login required.
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
                        trackClick('agent_renewal_share_copy', { policy_id: policyId });
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
                    href={`/renewal-review/${data.share_token}?preview=1&return=${encodeURIComponent(`/agent/${clientId}/policies/${policyId}/renewal`)}`}
                    onClick={() => trackClick('agent_renewal_preview', { policy_id: policyId })}
                    style={{
                      padding: '8px 14px',
                      border: '1px solid var(--color-border)',
                      borderRadius: 'var(--radius-md)',
                      fontSize: 13,
                      fontWeight: 600,
                      cursor: 'pointer',
                      textDecoration: 'none',
                      color: 'var(--color-text)',
                      backgroundColor: 'var(--color-surface)',
                    }}
                  >
                    Preview
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
                {data.shared_at && (
                  <span style={{ fontSize: 11, color: 'var(--color-text-muted)', marginLeft: 12 }}>
                    Created {new Date(data.shared_at).toLocaleString()}
                  </span>
                )}
              </>
            ) : (
              <button
                onClick={generateShareLink}
                disabled={sharing}
                style={{
                  padding: '8px 18px',
                  backgroundColor: 'var(--color-primary)',
                  color: '#fff',
                  border: 'none',
                  borderRadius: 'var(--radius-md)',
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: sharing ? 'wait' : 'pointer',
                  opacity: sharing ? 0.6 : 1,
                }}
              >
                {sharing ? 'Creating link...' : 'Create share link'}
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
