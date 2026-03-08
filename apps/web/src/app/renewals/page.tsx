'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '../../../lib/auth';
import { renewalsApi, RenewalSummaryResult, RenewalPolicySummary, RenewalChange, checkFeatureAccess } from '../../../lib/api';
import { formatDate, formatCurrency, formatPhone, cleanPhone } from '../../../lib/format';
import EmptyState from '../components/EmptyState';
import UpgradePrompt from '../components/UpgradePrompt';
import BackButton from '../components/BackButton';
import { getPolicyTypeDisplay, ALERT_SEVERITY_CONFIG } from '../constants';

const fieldLabels: Record<string, string> = {
  premium_amount: 'Premium',
  coverage_amount: 'Coverage',
  deductible: 'Deductible',
  carrier: 'Carrier',
  policy_number: 'Policy Number',
  policy_type: 'Policy Type',
  renewal_date: 'Renewal Date',
  scope: 'Scope',
};

function formatFieldValue(key: string, value: string | null): string {
  if (!value) return 'N/A';
  if (['premium_amount', 'coverage_amount', 'deductible'].includes(key)) {
    const num = parseInt(value, 10);
    if (!isNaN(num)) return `$${num.toLocaleString()}`;
  }
  return value;
}

function getDaysColor(days: number): { bg: string; fg: string } {
  if (days < 14) return { bg: 'var(--color-danger-light)', fg: 'var(--color-danger-dark)' };
  if (days < 30) return { bg: 'var(--color-warning-light)', fg: 'var(--color-warning-dark)' };
  return { bg: 'var(--color-info-light)', fg: 'var(--color-info-dark)' };
}

function ChangeRow({ change }: { change: RenewalChange }) {
  const sev = ALERT_SEVERITY_CONFIG[change.severity] || ALERT_SEVERITY_CONFIG.info;
  const label = fieldLabels[change.field_key] || change.field_key;

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: 10,
      padding: '8px 0',
      borderBottom: '1px solid var(--color-border)',
      fontSize: 14,
      flexWrap: 'wrap',
    }}>
      <span style={{
        display: 'inline-block',
        padding: '2px 8px',
        borderRadius: 'var(--radius-sm)',
        backgroundColor: sev.bg,
        color: sev.fg,
        fontSize: 11,
        fontWeight: 600,
      }}>
        {sev.icon} {sev.label}
      </span>
      <span style={{ fontWeight: 600, color: 'var(--color-text)' }}>{label}</span>
      <span style={{ color: 'var(--color-text-muted)' }}>
        {formatFieldValue(change.field_key, change.old_value)}
      </span>
      <span style={{ color: 'var(--color-text-muted)' }}>&rarr;</span>
      <span style={{ fontWeight: 600, color: 'var(--color-text)' }}>
        {formatFieldValue(change.field_key, change.new_value)}
      </span>
    </div>
  );
}

function PolicyCard({ policy }: { policy: RenewalPolicySummary }) {
  const router = useRouter();
  const ptDisplay = getPolicyTypeDisplay(policy.policy_type);
  const daysColor = getDaysColor(policy.days_until_renewal);
  const hasChanges = policy.changes.length > 0;

  return (
    <div style={{
      backgroundColor: 'var(--color-surface)',
      border: '1px solid var(--color-border)',
      borderRadius: 'var(--radius-lg)',
      padding: 20,
      marginBottom: 16,
    }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 22 }}>{ptDisplay.icon}</span>
          <div>
            <button
              onClick={() => router.push(`/policies/${policy.id}`)}
              style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, fontSize: 16, fontWeight: 600, color: 'var(--color-text)', textAlign: 'left' }}
            >
              {policy.carrier}
              {policy.nickname && <span style={{ color: 'var(--color-text-muted)', fontWeight: 400 }}> &middot; {policy.nickname}</span>}
            </button>
            <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>
              {ptDisplay.label} &middot; {policy.policy_number}
            </div>
          </div>
        </div>
        <span style={{
          display: 'inline-block',
          padding: '4px 12px',
          borderRadius: 'var(--radius-sm)',
          backgroundColor: daysColor.bg,
          color: daysColor.fg,
          fontSize: 13,
          fontWeight: 600,
          whiteSpace: 'nowrap',
        }}>
          Renews in {policy.days_until_renewal} day{policy.days_until_renewal !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Key figures */}
      <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', marginBottom: 16, fontSize: 13 }}>
        <div>
          <div style={{ color: 'var(--color-text-muted)', marginBottom: 2 }}>Renewal Date</div>
          <div style={{ fontWeight: 600 }}>{formatDate(policy.renewal_date)}</div>
        </div>
        {policy.coverage_amount != null && (
          <div>
            <div style={{ color: 'var(--color-text-muted)', marginBottom: 2 }}>Coverage</div>
            <div style={{ fontWeight: 600 }}>{formatCurrency(policy.coverage_amount)}</div>
          </div>
        )}
        {policy.deductible != null && (
          <div>
            <div style={{ color: 'var(--color-text-muted)', marginBottom: 2 }}>Deductible</div>
            <div style={{ fontWeight: 600 }}>{formatCurrency(policy.deductible)}</div>
          </div>
        )}
        {policy.premium_amount != null && (
          <div>
            <div style={{ color: 'var(--color-text-muted)', marginBottom: 2 }}>Premium</div>
            <div style={{ fontWeight: 600 }}>{formatCurrency(policy.premium_amount)}</div>
          </div>
        )}
      </div>

      {/* Changes section */}
      {hasChanges ? (
        <div>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-text-muted)', marginBottom: 6 }}>
            What changed ({policy.changes.length})
          </div>
          {policy.changes.map((ch) => (
            <ChangeRow key={ch.id} change={ch} />
          ))}
        </div>
      ) : (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--color-success-dark)', fontSize: 14 }}>
          <span style={{ fontSize: 16 }}>&#10003;</span>
          No changes detected
        </div>
      )}

      {/* Agent contact */}
      {policy.agent_name && (
        <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--color-border)', fontSize: 13, color: 'var(--color-text-muted)', display: 'flex', alignItems: 'center', gap: 8 }}>
          <span>Agent: <strong style={{ color: 'var(--color-text)' }}>{policy.agent_name}</strong></span>
          {policy.agent_phone && (
            <a href={`tel:${cleanPhone(policy.agent_phone)}`} style={{ color: 'var(--color-accent)', textDecoration: 'none' }}>
              {formatPhone(policy.agent_phone)}
            </a>
          )}
        </div>
      )}
    </div>
  );
}

// ── Renewal Summary helpers ──────────────────────────

function generateQuestions(policies: RenewalPolicySummary[]): string[] {
  const questions: string[] = [];
  let hasAnyChanges = false;

  for (const policy of policies) {
    const typeLabel = getPolicyTypeDisplay(policy.policy_type).label;
    for (const ch of policy.changes) {
      hasAnyChanges = true;
      const label = fieldLabels[ch.field_key] || ch.field_key;
      const oldVal = formatFieldValue(ch.field_key, ch.old_value);
      const newVal = formatFieldValue(ch.field_key, ch.new_value);

      if (ch.field_key === 'premium_amount') {
        questions.push(`Why did my ${typeLabel} premium change from ${oldVal} to ${newVal}?`);
      } else if (ch.field_key === 'deductible') {
        questions.push(`My ${typeLabel} deductible changed from ${oldVal} to ${newVal} — can we keep the original?`);
      } else if (ch.field_key === 'coverage_amount') {
        questions.push(`My ${typeLabel} coverage changed from ${oldVal} to ${newVal} — is this sufficient?`);
      } else {
        questions.push(`Can you explain the ${label} change on my ${typeLabel} policy?`);
      }
    }
  }

  questions.push('Are there any discounts or bundling options available?');

  if (!hasAnyChanges) {
    questions.push('No changes were detected — are there any updates I should know about for this renewal?');
  }

  return questions;
}

function generatePlainText(data: RenewalSummaryResult): string {
  const now = new Date();
  const dateStr = now.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  const lines: string[] = [];

  lines.push('RENEWAL SUMMARY');
  lines.push(`Prepared ${dateStr}`);
  lines.push('');
  lines.push(`${data.total_renewing} ${data.total_renewing === 1 ? 'policy' : 'policies'} renewing in the next 90 days`);
  lines.push(`${data.total_with_changes} with detected changes`);

  for (const policy of data.policies) {
    const typeLabel = getPolicyTypeDisplay(policy.policy_type).label;
    lines.push('');
    lines.push('\u2500'.repeat(40));
    lines.push(`${policy.carrier.toUpperCase()} \u2014 ${typeLabel}`);
    lines.push(`Policy #: ${policy.policy_number}`);
    lines.push(`Renews: ${formatDate(policy.renewal_date)} (in ${policy.days_until_renewal} days)`);

    const parts: string[] = [];
    if (policy.coverage_amount != null) parts.push(`Coverage: ${formatCurrency(policy.coverage_amount)}`);
    if (policy.deductible != null) parts.push(`Deductible: ${formatCurrency(policy.deductible)}`);
    if (policy.premium_amount != null) parts.push(`Premium: ${formatCurrency(policy.premium_amount)}/yr`);
    if (parts.length > 0) lines.push(parts.join(' | '));

    if (policy.changes.length > 0) {
      lines.push('');
      lines.push('Changes:');
      for (const ch of policy.changes) {
        const label = fieldLabels[ch.field_key] || ch.field_key;
        lines.push(`  \u2022 ${label}: ${formatFieldValue(ch.field_key, ch.old_value)} \u2192 ${formatFieldValue(ch.field_key, ch.new_value)}`);
      }
    }

    if (policy.agent_name) {
      lines.push('');
      lines.push(`Agent: ${policy.agent_name}${policy.agent_phone ? ' \u00b7 ' + formatPhone(policy.agent_phone) : ''}`);
    }
  }

  const questions = generateQuestions(data.policies);
  lines.push('');
  lines.push('\u2500'.repeat(40));
  lines.push('QUESTIONS FOR YOUR ADVISOR');
  for (const q of questions) {
    lines.push(`\u2022 ${q}`);
  }

  lines.push('');
  lines.push('Prepared using Covrabl \u00b7 covrabl.com');

  return lines.join('\n');
}

// ── Renewal Summary Overlay ──────────────────────────

function RenewalSummaryOverlay({
  data,
  onClose,
}: {
  data: RenewalSummaryResult;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const now = new Date();
  const dateStr = now.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  const questions = generateQuestions(data.policies);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(generatePlainText(data));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = generatePlainText(data);
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handlePrint = () => {
    window.print();
  };

  return (
    <div
      className="renewal-summary-overlay"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1000,
        backgroundColor: '#fff',
        overflow: 'auto',
      }}
    >
      {/* Action bar */}
      <div
        className="print-hide"
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '16px 24px',
          borderBottom: '1px solid var(--color-border)',
          position: 'sticky',
          top: 0,
          backgroundColor: '#fff',
          zIndex: 10,
          flexWrap: 'wrap',
          gap: 8,
        }}
      >
        <button
          onClick={onClose}
          style={{
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            fontSize: 20,
            color: 'var(--color-text-muted)',
            padding: '4px 8px',
          }}
          aria-label="Close summary"
        >
          &#10005;
        </button>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-outline" onClick={handleCopy}>
            {copied ? 'Copied!' : 'Copy to Clipboard'}
          </button>
          <button className="btn btn-accent" onClick={handlePrint}>
            Print
          </button>
        </div>
      </div>

      {/* Summary content */}
      <div
        className="renewal-summary-content"
        style={{ maxWidth: 700, margin: '0 auto', padding: '32px 24px 64px' }}
      >
        {/* Title block */}
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <h1 style={{ margin: '0 0 4px', fontSize: 22, fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase' }}>
            Renewal Summary
          </h1>
          <p style={{ margin: 0, fontSize: 14, color: 'var(--color-text-muted)' }}>
            Prepared {dateStr}
          </p>
        </div>

        {/* Stats line */}
        <div style={{ textAlign: 'center', marginBottom: 32, fontSize: 15 }}>
          <p style={{ margin: '0 0 4px' }}>
            <strong>{data.total_renewing}</strong> {data.total_renewing === 1 ? 'policy' : 'policies'} renewing in the next 90 days
          </p>
          <p style={{ margin: 0, color: data.total_with_changes > 0 ? 'var(--color-warning-dark)' : 'var(--color-text-muted)' }}>
            <strong>{data.total_with_changes}</strong> with detected changes
          </p>
        </div>

        {/* Policy sections */}
        {data.policies.map((policy) => {
          const typeLabel = getPolicyTypeDisplay(policy.policy_type).label;
          return (
            <div key={policy.id} style={{ marginBottom: 28 }}>
              {/* Policy heading */}
              <div style={{
                borderBottom: '2px solid var(--color-border)',
                paddingBottom: 6,
                marginBottom: 12,
                fontSize: 15,
                fontWeight: 700,
              }}>
                {policy.carrier} — {typeLabel}
              </div>

              {/* Details grid */}
              <div style={{ fontSize: 14, lineHeight: 1.8 }}>
                <div>
                  <span style={{ color: 'var(--color-text-muted)' }}>Type:</span>{' '}
                  {typeLabel}
                  <span style={{ margin: '0 8px', color: 'var(--color-text-muted)' }}>|</span>
                  <span style={{ color: 'var(--color-text-muted)' }}>Policy #:</span>{' '}
                  {policy.policy_number}
                </div>
                <div>
                  <span style={{ color: 'var(--color-text-muted)' }}>Renews:</span>{' '}
                  {formatDate(policy.renewal_date)} (in {policy.days_until_renewal} day{policy.days_until_renewal !== 1 ? 's' : ''})
                </div>
                <div>
                  {policy.coverage_amount != null && (
                    <>
                      <span style={{ color: 'var(--color-text-muted)' }}>Coverage:</span>{' '}
                      {formatCurrency(policy.coverage_amount)}
                    </>
                  )}
                  {policy.deductible != null && (
                    <>
                      <span style={{ margin: '0 8px', color: 'var(--color-text-muted)' }}>|</span>
                      <span style={{ color: 'var(--color-text-muted)' }}>Deductible:</span>{' '}
                      {formatCurrency(policy.deductible)}
                    </>
                  )}
                  {policy.premium_amount != null && (
                    <>
                      <span style={{ margin: '0 8px', color: 'var(--color-text-muted)' }}>|</span>
                      <span style={{ color: 'var(--color-text-muted)' }}>Premium:</span>{' '}
                      {formatCurrency(policy.premium_amount)}
                    </>
                  )}
                </div>
              </div>

              {/* Changes */}
              {policy.changes.length > 0 && (
                <div style={{ marginTop: 12 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-text-muted)', marginBottom: 4 }}>
                    Changes detected:
                  </div>
                  {policy.changes.map((ch) => {
                    const sev = ALERT_SEVERITY_CONFIG[ch.severity] || ALERT_SEVERITY_CONFIG.info;
                    const label = fieldLabels[ch.field_key] || ch.field_key;
                    return (
                      <div key={ch.id} style={{ fontSize: 14, padding: '2px 0' }}>
                        &bull; {label}: {formatFieldValue(ch.field_key, ch.old_value)} &rarr; {formatFieldValue(ch.field_key, ch.new_value)}
                        <span style={{
                          marginLeft: 8,
                          fontSize: 11,
                          padding: '1px 6px',
                          borderRadius: 'var(--radius-sm)',
                          backgroundColor: sev.bg,
                          color: sev.fg,
                          fontWeight: 600,
                        }}>
                          {sev.label}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Agent */}
              {policy.agent_name && (
                <div style={{ marginTop: 10, fontSize: 14, color: 'var(--color-text-muted)' }}>
                  Agent: <strong style={{ color: 'var(--color-text)' }}>{policy.agent_name}</strong>
                  {policy.agent_phone && <> &middot; {formatPhone(policy.agent_phone)}</>}
                </div>
              )}
            </div>
          );
        })}

        {/* Questions section */}
        <div style={{ marginTop: 32 }}>
          <div style={{
            borderBottom: '2px solid var(--color-border)',
            paddingBottom: 6,
            marginBottom: 12,
            fontSize: 15,
            fontWeight: 700,
          }}>
            Questions for Your Advisor
          </div>
          <div style={{ fontSize: 14, lineHeight: 1.9 }}>
            {questions.map((q, i) => (
              <div key={i}>&bull; {q}</div>
            ))}
          </div>
        </div>

        {/* Footer */}
        <div style={{
          marginTop: 40,
          paddingTop: 16,
          borderTop: '1px solid var(--color-border)',
          textAlign: 'center',
          fontSize: 13,
          color: 'var(--color-text-muted)',
        }}>
          Prepared using <strong>Covrabl</strong> &middot; covrabl.com
        </div>
      </div>
    </div>
  );
}

// ── Main Page ────────────────────────────────────────

export default function RenewalsPage() {
  const { token, plan, logout } = useAuth();
  const router = useRouter();
  const [data, setData] = useState<RenewalSummaryResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showSummary, setShowSummary] = useState(false);

  useEffect(() => {
    if (!token) { router.replace('/login'); return; }
    load();
  }, [token]);

  const load = async () => {
    try {
      setLoading(true);
      setData(await renewalsApi.summary());
    } catch (err: any) {
      if (err.status === 401) { logout(); router.replace('/login'); return; }
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  if (!token) return null;

  const featureGate = checkFeatureAccess(plan || 'free', 'deltas');
  if (!featureGate.allowed) {
    return <UpgradePrompt feature="deltas" requiredPlan={featureGate.requiredPlan} />;
  }

  return (
    <div style={{ padding: '24px 24px 48px', maxWidth: 900, margin: '0 auto' }}>
      <BackButton href="/" label="Renewals" parentLabel="Home" />
      {/* Header */}
      <div style={{ marginBottom: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
          <h1 style={{ margin: '0', fontSize: 24, fontWeight: 700 }}>Nothing changes without you knowing</h1>
          {data && data.total_renewing > 0 && (
            <button
              className="btn btn-outline"
              onClick={() => setShowSummary(true)}
              style={{ borderColor: 'var(--color-accent)', color: 'var(--color-accent)' }}
            >
              Prepare for Advisor
            </button>
          )}
        </div>
        {data && (
          <p style={{ margin: '4px 0 0', fontSize: 14, color: 'var(--color-text-muted)' }}>
            {data.total_renewing} {data.total_renewing === 1 ? 'policy' : 'policies'} renewing in the next 90 days — every change explained
          </p>
        )}
      </div>

      {error && (
        <div style={{ padding: 12, backgroundColor: 'var(--color-danger-light)', color: 'var(--color-danger-dark)', borderRadius: 'var(--radius-md)', marginBottom: 16, fontSize: 14 }}>
          {error}
        </div>
      )}

      {loading && (
        <div style={{ textAlign: 'center', padding: 48, color: 'var(--color-text-muted)' }}>Loading...</div>
      )}

      {!loading && data && data.total_renewing === 0 && (
        <EmptyState
          icon="&#10003;"
          title="No upcoming renewals"
          subtitle="When your policies renew, Covrabl will show you exactly what changed."
        />
      )}

      {!loading && data && data.total_renewing > 0 && (
        <>
          {/* Stats bar */}
          <div style={{
            display: 'flex',
            gap: 16,
            marginBottom: 24,
            flexWrap: 'wrap',
          }}>
            <div className="mobile-no-minw" style={{ flex: 1, minWidth: 140, padding: 16, backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-lg)', textAlign: 'center' }}>
              <div style={{ fontSize: 28, fontWeight: 700, color: 'var(--color-text)' }}>{data.total_renewing}</div>
              <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>Total Renewing</div>
            </div>
            <div className="mobile-no-minw" style={{ flex: 1, minWidth: 140, padding: 16, backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-lg)', textAlign: 'center' }}>
              <div style={{ fontSize: 28, fontWeight: 700, color: data.total_with_changes > 0 ? 'var(--color-warning-dark)' : 'var(--color-success-dark)' }}>
                {data.total_with_changes}
              </div>
              <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>With Changes</div>
            </div>
            <div className="mobile-no-minw" style={{ flex: 1, minWidth: 140, padding: 16, backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-lg)', textAlign: 'center' }}>
              <div style={{ fontSize: 28, fontWeight: 700, color: 'var(--color-text)' }}>
                {data.policies[0]?.days_until_renewal ?? '—'}
              </div>
              <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>Days to Next Renewal</div>
            </div>
          </div>

          {/* Policy cards */}
          {data.policies.map((p) => (
            <PolicyCard key={p.id} policy={p} />
          ))}
        </>
      )}

      {/* Renewal Summary Overlay */}
      {showSummary && data && (
        <RenewalSummaryOverlay data={data} onClose={() => setShowSummary(false)} />
      )}
    </div>
  );
}
