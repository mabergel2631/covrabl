'use client';

import { useState, useEffect } from 'react';
import { adminApi, AdminStats, AdminSignup, AdminActivity } from '../../../lib/api';

export default function AdminOverviewTab() {
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [signups, setSignups] = useState<AdminSignup[]>([]);
  const [activity, setActivity] = useState<AdminActivity[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const [s, sg, a] = await Promise.all([
          adminApi.stats(),
          adminApi.signups(),
          adminApi.recentActivity(),
        ]);
        setStats(s);
        setSignups(sg);
        setActivity(a);
      } catch { /* handled at page level */ }
      finally { setLoading(false); }
    })();
  }, []);

  if (loading) return <div style={{ padding: 40, textAlign: 'center', color: 'var(--color-text-muted)' }}>Loading...</div>;

  const statCards = [
    { label: 'Total Users', value: stats?.total_users ?? 0, icon: '👥' },
    { label: 'Sign-ups (7d)', value: stats?.recent_signups ?? 0, icon: '📈' },
    { label: 'Total Policies', value: stats?.total_policies ?? 0, icon: '📋' },
    { label: 'Pending Drafts', value: stats?.pending_drafts ?? 0, icon: '📧' },
    { label: 'Documents', value: stats?.total_documents ?? 0, icon: '📄' },
    { label: 'Est. Storage', value: `${stats?.storage_estimate_mb ?? 0} MB`, icon: '💾' },
    { label: 'Active Now', value: stats?.active_sessions_approx ?? 0, icon: '🟢' },
  ];

  const mrr = stats?.mrr_breakdown || {};
  const totalMrr = Object.values(mrr).reduce((sum, p) => sum + p.mrr_cents, 0);

  const planEntries = stats?.plans ? Object.entries(stats.plans).sort((a, b) => b[1] - a[1]) : [];
  const maxSignup = Math.max(...signups.map(s => s.count), 1);

  return (
    <div>
      {/* Stat Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 14, marginBottom: 28 }}>
        {statCards.map(card => (
          <div key={card.label} className="card" style={{ padding: 18, textAlign: 'center' }}>
            <div style={{ fontSize: 15, marginBottom: 4 }}>{card.icon}</div>
            <div style={{ fontSize: 24, fontWeight: 700, color: 'var(--color-primary)', marginBottom: 2 }}>
              {card.value}
            </div>
            <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>{card.label}</div>
          </div>
        ))}
      </div>

      {/* MRR + Plan Breakdown side by side */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 28 }}>
        <div className="card" style={{ padding: 20 }}>
          <h3 style={{ fontSize: 15, fontWeight: 600, margin: '0 0 12px', color: 'var(--color-text)' }}>
            Monthly Recurring Revenue
          </h3>
          <div style={{ fontSize: 28, fontWeight: 700, color: 'var(--color-primary)', marginBottom: 12 }}>
            ${(totalMrr / 100).toFixed(0)}<span style={{ fontSize: 14, fontWeight: 400, color: 'var(--color-text-muted)' }}>/mo</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {Object.entries(mrr).map(([plan, data]) => (
              <div key={plan} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                <span style={{ color: 'var(--color-text-secondary)', textTransform: 'capitalize' }}>{plan} ({data.count})</span>
                <span style={{ fontWeight: 600, color: 'var(--color-text)' }}>${(data.mrr_cents / 100).toFixed(0)}</span>
              </div>
            ))}
          </div>
        </div>

        {planEntries.length > 0 && (
          <div className="card" style={{ padding: 20 }}>
            <h3 style={{ fontSize: 15, fontWeight: 600, margin: '0 0 12px', color: 'var(--color-text)' }}>
              Plan Breakdown
            </h3>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              {planEntries.map(([plan, count]) => (
                <div key={plan} style={{
                  padding: '8px 16px',
                  borderRadius: 'var(--radius-md)',
                  backgroundColor: 'var(--color-bg)',
                  border: '1px solid var(--color-border)',
                }}>
                  <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-primary)' }}>{count}</span>
                  <span style={{ fontSize: 13, color: 'var(--color-text-muted)', marginLeft: 6 }}>{plan}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Sign-up Trend */}
      {signups.length > 0 && (
        <div className="card" style={{ padding: 20, marginBottom: 28 }}>
          <h3 style={{ fontSize: 15, fontWeight: 600, margin: '0 0 12px', color: 'var(--color-text)' }}>
            Sign-ups (Last 30 Days)
          </h3>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: 80 }}>
            {signups.map(s => (
              <div
                key={s.date}
                title={`${s.date}: ${s.count}`}
                style={{
                  flex: 1, minWidth: 4,
                  backgroundColor: 'var(--color-accent)',
                  borderRadius: '2px 2px 0 0',
                  height: `${Math.max((s.count / maxSignup) * 100, 4)}%`,
                  opacity: s.count > 0 ? 1 : 0.2,
                }}
              />
            ))}
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6 }}>
            <span style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>{signups[0]?.date}</span>
            <span style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>{signups[signups.length - 1]?.date}</span>
          </div>
        </div>
      )}

      {/* Recent Activity */}
      <h3 style={{ fontSize: 15, fontWeight: 600, margin: '0 0 12px', color: 'var(--color-text)' }}>Recent Activity</h3>
      {activity.length === 0 ? (
        <div className="card" style={{ padding: 32, textAlign: 'center', color: 'var(--color-text-muted)' }}>No recent activity.</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {activity.slice(0, 15).map((a, i) => (
            <div key={i} className="card" style={{ padding: '10px 16px', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <StatusBadge type={a.type} />
              <span style={{ fontSize: 13, color: 'var(--color-text-secondary)', fontWeight: 500 }}>{a.user_email}</span>
              <span style={{ fontSize: 13, color: 'var(--color-text)' }}>
                {a.type === 'upload' ? a.filename : (a.original_filename || a.carrier || 'Draft')}
              </span>
              <span style={{ fontSize: 12, color: 'var(--color-text-muted)', marginLeft: 'auto' }}>
                {a.created_at ? new Date(a.created_at).toLocaleDateString() : ''}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function StatusBadge({ type }: { type: string }) {
  const isUpload = type === 'upload';
  return (
    <span style={{
      fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 10,
      backgroundColor: isUpload ? 'rgba(5,150,105,0.1)' : 'rgba(217,119,6,0.1)',
      color: isUpload ? 'var(--color-success)' : 'var(--color-warning)',
    }}>
      {isUpload ? 'Upload' : 'Draft'}
    </span>
  );
}
