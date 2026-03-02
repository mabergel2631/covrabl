'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '../../../lib/auth';
import { scoresApi, CoverageScoresResult, CategoryResult, ScoreRecommendation } from '../../../lib/api';

const CATEGORY_LABELS: Record<string, string> = {
  liability: 'Liability Protection',
  property: 'Property Protection',
  income: 'Income Protection',
  catastrophic: 'Catastrophic Protection',
};

const CATEGORY_DESCRIPTIONS: Record<string, string> = {
  liability: 'Evaluates auto liability, home/renters liability, umbrella, and business GL coverage.',
  property: 'Evaluates dwelling/renters coverage, auto physical damage, and deductible levels.',
  income: 'Evaluates life insurance, disability income, and policy status.',
  catastrophic: 'Evaluates umbrella, flood, earthquake, and other catastrophic coverage.',
};

function scoreColor(s: number) {
  if (s >= 75) return '#22c55e';
  if (s >= 50) return '#f59e0b';
  return '#ef4444';
}

function ScoreGauge({ score, size = 120 }: { score: number; size?: number }) {
  const r = (size - 12) / 2;
  const circ = 2 * Math.PI * r;
  return (
    <div style={{ position: 'relative', width: size, height: size }}>
      <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#e5e7eb" strokeWidth={10} />
        <circle
          cx={size / 2} cy={size / 2} r={r} fill="none"
          stroke={scoreColor(score)} strokeWidth={10} strokeLinecap="round"
          strokeDasharray={`${(score / 100) * circ} ${circ}`}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </svg>
      <div style={{
        position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
      }}>
        <span style={{ fontSize: size * 0.3, fontWeight: 700, color: 'var(--color-text)', lineHeight: 1 }}>{score}</span>
        <span style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>/ 100</span>
      </div>
    </div>
  );
}

function CategoryCard({ name, data, defaultOpen }: { name: string; data: CategoryResult; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen || false);
  const label = CATEGORY_LABELS[name] || name;
  const desc = CATEGORY_DESCRIPTIONS[name] || '';

  return (
    <div style={{
      backgroundColor: '#fff', border: '1px solid var(--color-border)',
      borderRadius: 'var(--radius-lg)', overflow: 'hidden',
    }}>
      <button
        onClick={() => setOpen(!open)}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', gap: 16,
          padding: '16px 20px', background: 'none', border: 'none', cursor: 'pointer',
          textAlign: 'left',
        }}
      >
        {/* Mini gauge */}
        <div style={{ position: 'relative', width: 44, height: 44, flexShrink: 0 }}>
          <svg viewBox="0 0 44 44" width={44} height={44}>
            <circle cx={22} cy={22} r={18} fill="none" stroke="#e5e7eb" strokeWidth={4} />
            <circle
              cx={22} cy={22} r={18} fill="none"
              stroke={scoreColor(data.score)} strokeWidth={4} strokeLinecap="round"
              strokeDasharray={`${(data.score / 100) * 113} 113`}
              transform="rotate(-90 22 22)"
            />
          </svg>
          <div style={{
            position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 13, fontWeight: 700, color: 'var(--color-text)',
          }}>
            {data.score}
          </div>
        </div>

        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--color-text)' }}>{label}</div>
          <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>
            Weight: {data.weight}% · {data.components.length} components
          </div>
        </div>

        <span style={{ fontSize: 16, color: 'var(--color-text-muted)', transition: 'transform 0.2s', transform: open ? 'rotate(180deg)' : 'none' }}>
          ▾
        </span>
      </button>

      {open && (
        <div style={{ padding: '0 20px 20px', borderTop: '1px solid var(--color-border)' }}>
          <div style={{ fontSize: 12, color: 'var(--color-text-muted)', padding: '12px 0 16px' }}>{desc}</div>

          {/* Components */}
          {data.components.map((comp, i) => (
            <div key={i} style={{ marginBottom: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 4 }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-text)' }}>{comp.name}</span>
                <span style={{ fontSize: 12, fontWeight: 600, color: scoreColor((comp.score / comp.max) * 100) }}>
                  {comp.score} / {comp.max}
                </span>
              </div>
              <div style={{ height: 4, backgroundColor: '#e5e7eb', borderRadius: 2, overflow: 'hidden', marginBottom: 4 }}>
                <div style={{
                  height: '100%', width: `${(comp.score / comp.max) * 100}%`,
                  backgroundColor: scoreColor((comp.score / comp.max) * 100),
                  borderRadius: 2, transition: 'width 0.5s ease',
                }} />
              </div>
              <div style={{ fontSize: 12, color: 'var(--color-text-muted)', lineHeight: 1.4 }}>{comp.detail}</div>
            </div>
          ))}

          {/* Category recommendations */}
          {data.recommendations.length > 0 && (
            <div style={{ marginTop: 16, padding: '12px 16px', backgroundColor: '#f8fafc', borderRadius: 'var(--radius-md)', border: '1px solid #e2e8f0' }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>
                Questions for your agent
              </div>
              {data.recommendations.map((rec, i) => (
                <div key={i} style={{ marginBottom: i < data.recommendations.length - 1 ? 10 : 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                    <span style={{
                      display: 'inline-block', width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
                      backgroundColor: rec.priority === 'high' ? '#ef4444' : rec.priority === 'medium' ? '#f59e0b' : '#22c55e',
                    }} />
                    <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-text)' }}>{rec.text}</span>
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--color-text-muted)', paddingLeft: 14, lineHeight: 1.4 }}>{rec.detail}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function ScorePage() {
  const { token, logout } = useAuth();
  const router = useRouter();
  const [data, setData] = useState<CoverageScoresResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [recalculating, setRecalculating] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!token) { router.replace('/login'); return; }
    scoresApi.get()
      .then(setData)
      .catch(err => {
        if (err.status === 401) { logout(); router.replace('/login'); return; }
        setError(err.message || 'Failed to load score');
      })
      .finally(() => setLoading(false));
  }, [token]);

  const handleRecalculate = async () => {
    setRecalculating(true);
    try {
      const result = await scoresApi.recalculate();
      setData(result);
    } catch (err: any) {
      setError(err.message || 'Failed to recalculate');
    } finally {
      setRecalculating(false);
    }
  };

  // Aggregate all recommendations sorted by priority
  const allRecs: (ScoreRecommendation & { category: string })[] = [];
  if (data) {
    const order = { high: 0, medium: 1, low: 2 };
    for (const [cat, result] of Object.entries(data.categories)) {
      for (const rec of result.recommendations) {
        allRecs.push({ ...rec, category: cat });
      }
    }
    allRecs.sort((a, b) => order[a.priority] - order[b.priority]);
  }

  if (loading) {
    return (
      <div style={{ maxWidth: 800, margin: '0 auto', padding: '60px 24px', textAlign: 'center' }}>
        <div style={{ fontSize: 16, color: 'var(--color-text-muted)' }}>Calculating your Coverage Health Score...</div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div style={{ maxWidth: 800, margin: '0 auto', padding: '60px 24px', textAlign: 'center' }}>
        <div style={{ fontSize: 16, color: '#ef4444', marginBottom: 16 }}>{error || 'Unable to load score data'}</div>
        <button onClick={() => router.push('/policies')} style={{ padding: '8px 20px', borderRadius: 8, border: '1px solid var(--color-border)', background: '#fff', cursor: 'pointer' }}>
          Back to Policies
        </button>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 800, margin: '0 auto', padding: '32px 24px 80px' }}>
      {/* Disclaimer banner */}
      <div style={{
        padding: '12px 16px', marginBottom: 24,
        backgroundColor: '#f0f9ff', border: '1px solid #bae6fd',
        borderRadius: 'var(--radius-md)', fontSize: 12, color: '#0369a1', lineHeight: 1.5,
      }}>
        This score summarizes coverage found in your uploaded policies and profile information.
        It helps highlight areas that may warrant review with your insurance professional.
      </div>

      {/* Overall score */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 32, marginBottom: 32,
        padding: '28px 32px', backgroundColor: '#fff',
        border: '1px solid var(--color-border)', borderRadius: 'var(--radius-lg)',
      }}>
        <ScoreGauge score={data.overall_score} size={130} />
        <div style={{ flex: 1 }}>
          <h1 style={{ fontSize: 24, fontWeight: 700, margin: '0 0 6px', color: 'var(--color-text)' }}>
            Coverage Health Score
          </h1>
          <div style={{ fontSize: 14, color: 'var(--color-text-secondary)', marginBottom: 12 }}>
            Based on {data.policies_analyzed} {data.policies_analyzed === 1 ? 'policy' : 'policies'} · {data.confidence} confidence
            {data.exposure_band !== 'unknown' && ` · ${data.exposure_band.replace('_', ' ')} exposure`}
          </div>
          <button
            onClick={handleRecalculate}
            disabled={recalculating}
            style={{
              padding: '6px 16px', fontSize: 13, fontWeight: 500,
              borderRadius: 6, border: '1px solid var(--color-border)',
              backgroundColor: '#fff', color: 'var(--color-text-secondary)',
              cursor: recalculating ? 'wait' : 'pointer',
            }}
          >
            {recalculating ? 'Recalculating...' : 'Recalculate'}
          </button>
        </div>
      </div>

      {/* Category cards */}
      <h2 style={{ fontSize: 16, fontWeight: 700, color: 'var(--color-text)', marginBottom: 12 }}>Protection Categories</h2>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 32 }}>
        {(['liability', 'property', 'income', 'catastrophic'] as const).map(cat => (
          <CategoryCard key={cat} name={cat} data={data.categories[cat]} defaultOpen={data.categories[cat].score < 50} />
        ))}
      </div>

      {/* Not yet visible */}
      {data.not_visible.length > 0 && (
        <div style={{
          padding: '16px 20px', marginBottom: 32,
          backgroundColor: '#fffbeb', border: '1px solid #fde68a',
          borderRadius: 'var(--radius-lg)',
        }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: '#92400e', marginBottom: 6 }}>
            Not Yet Visible
          </div>
          <div style={{ fontSize: 13, color: '#78350f', lineHeight: 1.5 }}>
            Based on your profile, we&apos;d expect to see: <strong>{data.not_visible.join(', ')}</strong>.
            Uploading these policies will improve score accuracy and confidence.
          </div>
          <button
            onClick={() => router.push('/policies')}
            style={{
              marginTop: 10, padding: '6px 16px', fontSize: 13, fontWeight: 500,
              borderRadius: 6, border: '1px solid #fbbf24',
              backgroundColor: '#fef3c7', color: '#92400e', cursor: 'pointer',
            }}
          >
            Upload a Policy
          </button>
        </div>
      )}

      {/* All recommendations */}
      {allRecs.length > 0 && (
        <div style={{ marginBottom: 32 }}>
          <h2 style={{ fontSize: 16, fontWeight: 700, color: 'var(--color-text)', marginBottom: 12 }}>
            Questions for Your Agent
          </h2>
          <div style={{
            padding: '16px 20px', backgroundColor: '#fff',
            border: '1px solid var(--color-border)', borderRadius: 'var(--radius-lg)',
          }}>
            {allRecs.map((rec, i) => (
              <div key={i} style={{
                padding: '12px 0',
                borderBottom: i < allRecs.length - 1 ? '1px solid var(--color-border)' : 'none',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                  <span style={{
                    display: 'inline-block', padding: '2px 8px', fontSize: 10, fontWeight: 600,
                    borderRadius: 10, textTransform: 'uppercase', letterSpacing: '0.05em',
                    backgroundColor: rec.priority === 'high' ? '#fef2f2' : rec.priority === 'medium' ? '#fffbeb' : '#f0fdf4',
                    color: rec.priority === 'high' ? '#dc2626' : rec.priority === 'medium' ? '#d97706' : '#16a34a',
                  }}>
                    {rec.priority}
                  </span>
                  <span style={{ fontSize: 11, color: 'var(--color-text-muted)', textTransform: 'capitalize' }}>
                    {CATEGORY_LABELS[rec.category] || rec.category}
                  </span>
                </div>
                <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-text)', marginBottom: 2 }}>{rec.text}</div>
                <div style={{ fontSize: 12, color: 'var(--color-text-muted)', lineHeight: 1.4 }}>{rec.detail}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Policy health */}
      {(data.policy_health.expiring_soon.length > 0 || data.policy_health.missing_documents.length > 0) && (
        <div style={{ marginBottom: 32 }}>
          <h2 style={{ fontSize: 16, fontWeight: 700, color: 'var(--color-text)', marginBottom: 12 }}>Policy Health</h2>
          <div style={{
            padding: '16px 20px', backgroundColor: '#fff',
            border: '1px solid var(--color-border)', borderRadius: 'var(--radius-lg)',
          }}>
            {data.policy_health.expiring_soon.length > 0 && (
              <div style={{ marginBottom: data.policy_health.missing_documents.length > 0 ? 16 : 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-text)', marginBottom: 8 }}>Expiring Soon</div>
                {data.policy_health.expiring_soon.map((item, i) => (
                  <div
                    key={i}
                    onClick={() => router.push(`/policies/${item.policy_id}`)}
                    style={{
                      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                      padding: '8px 0', cursor: 'pointer',
                      borderBottom: i < data.policy_health.expiring_soon.length - 1 ? '1px solid #f1f5f9' : 'none',
                    }}
                  >
                    <span style={{ fontSize: 13, color: 'var(--color-text)' }}>{item.carrier} ({item.type})</span>
                    <span style={{ fontSize: 12, fontWeight: 600, color: item.days_left! <= 7 ? '#ef4444' : '#f59e0b' }}>
                      {item.days_left} days
                    </span>
                  </div>
                ))}
              </div>
            )}
            {data.policy_health.missing_documents.length > 0 && (
              <div>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-text)', marginBottom: 8 }}>Missing Documents</div>
                {data.policy_health.missing_documents.map((item, i) => (
                  <div
                    key={i}
                    onClick={() => router.push(`/policies/${item.policy_id}`)}
                    style={{
                      padding: '8px 0', fontSize: 13, color: 'var(--color-text-secondary)', cursor: 'pointer',
                      borderBottom: i < data.policy_health.missing_documents.length - 1 ? '1px solid #f1f5f9' : 'none',
                    }}
                  >
                    {item.carrier} ({item.type}) — no document uploaded
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Legal footer */}
      <div style={{
        padding: '16px 20px', marginTop: 24,
        backgroundColor: '#f8fafc', border: '1px solid #e2e8f0',
        borderRadius: 'var(--radius-md)', fontSize: 11, color: '#64748b', lineHeight: 1.5, textAlign: 'center',
      }}>
        For informational purposes only. This score is based on the policies and profile information you have uploaded.
        It does not constitute insurance advice and does not replace consultation with a licensed insurance professional.
      </div>
    </div>
  );
}
