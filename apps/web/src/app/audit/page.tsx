'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '../../../lib/auth';
import { deltasApi, PolicyDelta, DeltaListResponse } from '../../../lib/api';
import { formatDate } from '../../../lib/format';
import BackButton from '../components/BackButton';
import EmptyState from '../components/EmptyState';
import TabNav from '../components/TabNav';
import { ALERT_SEVERITY_CONFIG } from '../constants';
import { Skeleton } from '../components/Skeleton';

const deltaTypeLabels: Record<string, string> = {
  increased: 'increased',
  decreased: 'decreased',
  added: 'added',
  removed: 'removed',
  changed: 'changed',
};

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

function formatValue(key: string, value: string | null | undefined): string {
  if (!value) return 'N/A';
  if (['premium_amount', 'coverage_amount', 'deductible'].includes(key)) {
    const num = parseInt(value, 10);
    if (!isNaN(num)) return `$${num.toLocaleString()}`;
  }
  return value;
}

export default function AlertsPage() {
  const { token, logout } = useAuth();
  const router = useRouter();
  const [data, setData] = useState<DeltaListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState<'all' | 'unacknowledged'>('unacknowledged');
  const [explaining, setExplaining] = useState<number | null>(null);
  const [explanations, setExplanations] = useState<Record<number, { explanation: string; reasons: string[] }>>({});

  useEffect(() => {
    if (!token) { router.replace('/login'); return; }
    load();
  }, [token, filter]);

  const load = async () => {
    try {
      setLoading(true);
      const params = filter === 'unacknowledged' ? { acknowledged: false } : {};
      setData(await deltasApi.list(params));
    } catch (err: any) {
      if (err.status === 401) { logout(); router.replace('/login'); return; }
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleAcknowledge = async (deltaId: number) => {
    try {
      await deltasApi.acknowledge(deltaId);
      load();
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleAcknowledgeAll = async () => {
    try {
      await deltasApi.acknowledgeAll();
      load();
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleDelete = async (deltaId: number) => {
    try {
      await deltasApi.delete(deltaId);
      load();
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleDeleteAcknowledged = async () => {
    try {
      await deltasApi.deleteAcknowledged();
      load();
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleExplain = async (delta: PolicyDelta) => {
    if (explanations[delta.id]) return;
    setExplaining(delta.id);
    try {
      const result = await deltasApi.explain(delta.id);
      setExplanations(prev => ({
        ...prev,
        [delta.id]: { explanation: result.explanation, reasons: result.possible_reasons },
      }));
    } catch (err: any) {
      setError(err.message);
    } finally {
      setExplaining(null);
    }
  };

  if (!token) return null;

  const unacknowledgedCount = data?.unacknowledged_count || 0;

  return (
    <div style={{ maxWidth: 800, margin: '0 auto', padding: 24 }}>
      <BackButton href="/" label="Alerts" parentLabel="Dashboard" />

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24, flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 style={{ margin: '0 0 4px', fontSize: 22 }}>Policy Alerts</h1>
          <p style={{ margin: 0, fontSize: 14, color: 'var(--color-text-muted)' }}>
            Changes detected in your policies
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {unacknowledgedCount > 0 && (
            <button
              onClick={handleAcknowledgeAll}
              className="btn btn-outline"
              style={{ padding: '8px 16px', fontSize: 13 }}
            >
              Acknowledge All
            </button>
          )}
          {data && data.total > unacknowledgedCount && (
            <button
              onClick={handleDeleteAcknowledged}
              style={{ padding: '8px 16px', fontSize: 13, border: '1px solid #fecaca', borderRadius: 'var(--radius-sm)', backgroundColor: '#fff', color: '#dc2626', cursor: 'pointer', fontWeight: 600 }}
            >
              Delete Acknowledged
            </button>
          )}
        </div>
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      {/* Filter tabs */}
      <div style={{ marginBottom: 20 }}>
        <TabNav
          variant="pill"
          activeKey={filter}
          onSelect={(key) => setFilter(key as 'all' | 'unacknowledged')}
          tabs={[
            { key: 'unacknowledged', label: `New${unacknowledgedCount > 0 ? ` (${unacknowledgedCount})` : ''}` },
            { key: 'all', label: 'All' },
          ]}
        />
      </div>

      {loading ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <Skeleton width="100%" height={80} />
          <Skeleton width="100%" height={80} />
          <Skeleton width="100%" height={80} />
        </div>
      ) : !data || data.items.length === 0 ? (
        <EmptyState
          icon="✓"
          title={filter === 'unacknowledged' ? 'All caught up!' : 'No policy changes detected yet'}
          subtitle={filter === 'unacknowledged'
            ? 'No new policy change alerts.'
            : 'Changes to your policies will appear here when detected.'}
        />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {data.items.map((delta: PolicyDelta) => {
            const config = ALERT_SEVERITY_CONFIG[delta.severity] || ALERT_SEVERITY_CONFIG.info;
            const explanation = explanations[delta.id] || (delta.explanation ? { explanation: delta.explanation, reasons: [] } : null);

            return (
              <div
                key={delta.id}
                style={{
                  padding: 0,
                  backgroundColor: '#fff',
                  borderRadius: 'var(--radius-md)',
                  border: `1px solid ${delta.is_acknowledged ? '#e5e7eb' : config.bg}`,
                  overflow: 'hidden',
                  opacity: delta.is_acknowledged ? 0.7 : 1,
                }}
              >
                {/* Header */}
                <div style={{
                  padding: '12px 16px',
                  backgroundColor: config.bg,
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 16 }}>{config.icon}</span>
                    <span style={{ fontSize: 12, fontWeight: 600, color: config.fg, textTransform: 'uppercase' }}>
                      {config.label}
                    </span>
                    <span style={{ fontSize: 13, color: 'var(--color-text)' }}>
                      {delta.policy_carrier || 'Policy'} - {delta.policy_type}
                    </span>
                  </div>
                  <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>
                    {formatDate(delta.created_at)}
                  </span>
                </div>

                {/* Content */}
                <div style={{ padding: 16 }}>
                  <div style={{ marginBottom: 12 }}>
                    <span style={{ fontSize: 15, fontWeight: 600, color: 'var(--color-text)' }}>
                      {fieldLabels[delta.field_key] || delta.field_key} {deltaTypeLabels[delta.delta_type] || delta.delta_type}
                    </span>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
                    <div style={{ padding: '8px 12px', backgroundColor: '#f3f4f6', borderRadius: 'var(--radius-sm)' }}>
                      <div style={{ fontSize: 10, color: 'var(--color-text-muted)', textTransform: 'uppercase', marginBottom: 2 }}>Before</div>
                      <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--color-text)' }}>
                        {formatValue(delta.field_key, delta.old_value)}
                      </div>
                    </div>
                    <span style={{ fontSize: 20, color: 'var(--color-text-muted)' }}>→</span>
                    <div style={{ padding: '8px 12px', backgroundColor: config.bg, borderRadius: 'var(--radius-sm)' }}>
                      <div style={{ fontSize: 10, color: 'var(--color-text-muted)', textTransform: 'uppercase', marginBottom: 2 }}>After</div>
                      <div style={{ fontSize: 14, fontWeight: 600, color: config.fg }}>
                        {formatValue(delta.field_key, delta.new_value)}
                      </div>
                    </div>
                  </div>

                  {/* Explanation */}
                  {explanation && (
                    <div style={{
                      padding: 12,
                      backgroundColor: '#f9fafb',
                      borderRadius: 'var(--radius-sm)',
                      marginBottom: 12,
                    }}>
                      <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text-muted)', marginBottom: 6 }}>
                        AI Explanation
                      </div>
                      <p style={{ fontSize: 13, color: 'var(--color-text)', margin: '0 0 8px', lineHeight: 1.5 }}>
                        {explanation.explanation}
                      </p>
                      {explanation.reasons.length > 0 && (
                        <div>
                          <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--color-text-muted)', marginBottom: 4 }}>
                            Possible reasons:
                          </div>
                          <ul style={{ margin: 0, paddingLeft: 16, fontSize: 12, color: 'var(--color-text-secondary)' }}>
                            {explanation.reasons.map((reason, i) => (
                              <li key={i}>{reason}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Actions */}
                  <div style={{ display: 'flex', gap: 8 }}>
                    {!explanation && (
                      <button
                        onClick={() => handleExplain(delta)}
                        disabled={explaining === delta.id}
                        className="btn btn-outline"
                        style={{ padding: '6px 12px', fontSize: 12 }}
                      >
                        {explaining === delta.id ? 'Analyzing...' : '🤖 Ask AI Why'}
                      </button>
                    )}
                    {!delta.is_acknowledged && (
                      <button
                        onClick={() => handleAcknowledge(delta.id)}
                        className="btn btn-outline"
                        style={{ padding: '6px 12px', fontSize: 12 }}
                      >
                        Acknowledge
                      </button>
                    )}
                    <button
                      onClick={() => router.push(`/policies/${delta.policy_id}`)}
                      className="btn btn-outline"
                      style={{ padding: '6px 12px', fontSize: 12 }}
                    >
                      View Policy
                    </button>
                    <button
                      onClick={() => handleDelete(delta.id)}
                      style={{ padding: '6px 12px', fontSize: 12, border: '1px solid #fecaca', borderRadius: 'var(--radius-sm)', backgroundColor: '#fff', color: '#dc2626', cursor: 'pointer', fontWeight: 500, marginLeft: 'auto' }}
                    >
                      Delete
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
