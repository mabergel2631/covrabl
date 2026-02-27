'use client';

import { useState, useEffect } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { useAuth } from '../../../../lib/auth';
import { agentApi, AgentClientSummary, CoverageGap } from '../../../../lib/api';
import BackButton from '../../components/BackButton';

const severityColors: Record<string, { bg: string; fg: string }> = {
  high: { bg: '#fee2e2', fg: '#991b1b' },
  medium: { bg: '#fef3c7', fg: '#92400e' },
  low: { bg: '#dbeafe', fg: '#1e40af' },
  info: { bg: '#f3f4f6', fg: '#374151' },
};

function formatCurrency(cents: number | null | undefined): string {
  if (!cents) return '--';
  return `$${cents.toLocaleString()}`;
}

export default function ClientDetailPage() {
  const { token, role } = useAuth();
  const router = useRouter();
  const params = useParams();
  const clientId = Number(params.clientId);

  const [data, setData] = useState<AgentClientSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!token) { router.replace('/login'); return; }
    if (role && role !== 'agent') { router.replace('/policies'); return; }

    const load = async () => {
      try {
        setData(await agentApi.clientSummary(clientId));
      } catch (err: any) {
        if (err.status === 403) { router.replace('/agent'); return; }
        setError(err.message || 'Failed to load');
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [token, role, clientId]);

  if (!token || loading) {
    return <div style={{ padding: 40, textAlign: 'center', color: 'var(--color-text-muted)' }}>Loading...</div>;
  }

  if (error || !data) {
    return (
      <div style={{ padding: 40, textAlign: 'center' }}>
        <p style={{ color: 'var(--color-danger)' }}>{error || 'Not found'}</p>
        <button onClick={() => router.push('/agent')} style={{ marginTop: 16, padding: '8px 20px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', background: '#fff', cursor: 'pointer' }}>
          Back to Dashboard
        </button>
      </div>
    );
  }

  const scoreColor = (data.protection_score ?? 0) >= 70 ? 'var(--color-success)' : (data.protection_score ?? 0) >= 40 ? 'var(--color-warning)' : 'var(--color-danger)';

  return (
    <div style={{ padding: '32px 24px', maxWidth: 900, margin: '0 auto' }}>
      {/* Back link */}
      <BackButton href="/agent" label={data.client?.email || 'Client'} parentLabel="Advisor" />

      {/* Client Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 20, marginBottom: 32 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, margin: '0 0 4px', color: 'var(--color-text)' }}>
            {data.client.email}
          </h1>
          <p style={{ fontSize: 14, color: 'var(--color-text-secondary)', margin: 0 }}>
            {data.policies.length} {data.policies.length === 1 ? 'policy' : 'policies'}
          </p>
        </div>
        <div style={{
          marginLeft: 'auto',
          textAlign: 'center',
          padding: '12px 20px',
          borderRadius: 'var(--radius-md)',
          backgroundColor: `${scoreColor}10`,
          border: `1px solid ${scoreColor}30`,
        }}>
          <div style={{ fontSize: 28, fontWeight: 700, color: scoreColor }}>
            {data.protection_score ?? '--'}
          </div>
          <div style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>Protection Score</div>
        </div>
      </div>

      {/* Policies grouped by exposure */}
      <h2 style={{ fontSize: 18, fontWeight: 600, margin: '0 0 12px', color: 'var(--color-text)' }}>Policies</h2>
      {data.policies.length === 0 ? (
        <div className="card" style={{ padding: 24, color: 'var(--color-text-muted)', textAlign: 'center' }}>No policies</div>
      ) : (() => {
        // Group policies by exposure_id
        const groups: Record<string, typeof data.policies> = {};
        data.policies.forEach(p => {
          const key = p.exposure_id ? String(p.exposure_id) : '__none';
          if (!groups[key]) groups[key] = [];
          groups[key].push(p);
        });
        // Derive exposure names from policies
        const exposureNames: Record<string, string> = {};
        Object.keys(groups).forEach(key => {
          if (key === '__none') return;
          const first = groups[key].find(p => p.exposure_name);
          exposureNames[key] = first?.exposure_name || `Asset #${key}`;
        });
        const groupKeys = Object.keys(groups).filter(k => k !== '__none');
        const ungrouped = groups['__none'] || [];
        const hasGroups = groupKeys.length > 0;

        const renderPolicy = (p: typeof data.policies[0]) => (
          <div key={p.id} className="card" style={{
            padding: '14px 20px',
            display: 'grid',
            gridTemplateColumns: '1fr auto auto auto',
            alignItems: 'center',
            gap: 20,
          }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-text)' }}>
                  {p.carrier}
                </span>
                {p.status && p.status !== 'active' && (
                  <span style={{
                    padding: '1px 8px', borderRadius: 10, fontSize: 11, fontWeight: 600,
                    backgroundColor: p.status === 'expired' ? '#fef2f2' : '#f3f4f6',
                    color: p.status === 'expired' ? 'var(--color-danger)' : '#6b7280',
                  }}>
                    {p.status.charAt(0).toUpperCase() + p.status.slice(1)}
                  </span>
                )}
              </div>
              <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>
                {p.policy_type} &middot; {p.policy_number}
              </div>
            </div>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>Coverage</div>
              <div style={{ fontSize: 13, fontWeight: 600 }}>{formatCurrency(p.coverage_amount)}</div>
            </div>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>Deductible</div>
              <div style={{ fontSize: 13 }}>{formatCurrency(p.deductible)}</div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>Renewal</div>
              <div style={{ fontSize: 13 }}>{p.renewal_date || '--'}</div>
            </div>
          </div>
        );

        return (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 32 }}>
            {hasGroups && groupKeys.map(key => (
              <div key={key}>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-primary)', marginBottom: 6, marginTop: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ padding: '2px 10px', borderRadius: 12, fontSize: 12, fontWeight: 600, backgroundColor: '#ede9fe', color: '#6d28d9' }}>
                    {exposureNames[key]}
                  </span>
                  <span style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>{groups[key].length} {groups[key].length === 1 ? 'policy' : 'policies'}</span>
                </div>
                {groups[key].map(renderPolicy)}
              </div>
            ))}
            {ungrouped.length > 0 && (
              <div>
                {hasGroups && (
                  <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-text-muted)', marginBottom: 6, marginTop: 8 }}>
                    Ungrouped
                  </div>
                )}
                {ungrouped.map(renderPolicy)}
              </div>
            )}
          </div>
        );
      })()}

      {/* Coverage Gaps */}
      {data.gaps.length > 0 && (
        <>
          <h2 style={{ fontSize: 18, fontWeight: 600, margin: '0 0 12px', color: 'var(--color-text)' }}>Coverage Gaps</h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 32 }}>
            {data.gaps.map((gap: CoverageGap, i: number) => {
              const colors = severityColors[gap.severity] || severityColors.info;
              return (
                <div key={gap.id || i} style={{
                  padding: '14px 20px',
                  borderRadius: 'var(--radius-md)',
                  backgroundColor: colors.bg,
                  border: `1px solid ${colors.fg}20`,
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
                    <span style={{
                      fontSize: 11,
                      fontWeight: 600,
                      textTransform: 'uppercase' as const,
                      color: colors.fg,
                      padding: '1px 8px',
                      borderRadius: 8,
                      backgroundColor: `${colors.fg}18`,
                    }}>
                      {gap.severity}
                    </span>
                    <span style={{ fontSize: 14, fontWeight: 600, color: colors.fg }}>{gap.name}</span>
                  </div>
                  <p style={{ fontSize: 13, color: colors.fg, margin: '4px 0 0', opacity: 0.85, lineHeight: 1.5 }}>
                    {gap.description}
                  </p>
                  <p style={{ fontSize: 12, color: colors.fg, margin: '6px 0 0', opacity: 0.7, lineHeight: 1.5 }}>
                    {gap.recommendation}
                  </p>
                </div>
              );
            })}
          </div>
        </>
      )}

      {/* Upcoming Renewals */}
      {data.upcoming_renewals.length > 0 && (
        <>
          <h2 style={{ fontSize: 18, fontWeight: 600, margin: '0 0 12px', color: 'var(--color-text)' }}>Upcoming Renewals</h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {data.upcoming_renewals.map(r => (
              <div key={r.policy_id} className="card" style={{
                padding: '12px 20px',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}>
                <div>
                  <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-text)' }}>{r.carrier}</span>
                  <span style={{ fontSize: 13, color: 'var(--color-text-muted)', marginLeft: 8 }}>{r.policy_type}</span>
                </div>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-primary)' }}>
                  {r.renewal_date}
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
