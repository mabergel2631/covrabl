'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '../../../lib/auth';
import {
  adminApi,
  AdminStats,
  AdminUser,
  AdminUserDetail,
  AdminActivity,
  AdminSignup,
} from '../../../lib/api';

export default function AdminDashboard() {
  const { token, role } = useAuth();
  const router = useRouter();
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [userTotal, setUserTotal] = useState(0);
  const [userPage, setUserPage] = useState(1);
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [activity, setActivity] = useState<AdminActivity[]>([]);
  const [signups, setSignups] = useState<AdminSignup[]>([]);
  const [expandedUser, setExpandedUser] = useState<number | null>(null);
  const [userDetail, setUserDetail] = useState<AdminUserDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Auth guard
  useEffect(() => {
    if (!token) { router.replace('/login'); return; }
    if (role && role !== 'admin') { router.replace('/policies'); return; }
  }, [token, role, router]);

  // Load initial data
  useEffect(() => {
    if (!token || (role && role !== 'admin')) return;
    const load = async () => {
      try {
        const [s, a, sg] = await Promise.all([
          adminApi.stats(),
          adminApi.recentActivity(),
          adminApi.signups(),
        ]);
        setStats(s);
        setActivity(a);
        setSignups(sg);
      } catch (err: any) {
        if (err.status === 403) { router.replace('/policies'); return; }
        setError(err.message || 'Failed to load');
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [token, role, router]);

  // Load users (paginated + search)
  const loadUsers = useCallback(async (pg: number, q: string) => {
    try {
      const res = await adminApi.users(pg, 50, q);
      setUsers(res.items);
      setUserTotal(res.total);
      setUserPage(res.page);
    } catch { /* stats already shown error */ }
  }, []);

  useEffect(() => {
    if (!token || (role && role !== 'admin')) return;
    loadUsers(1, '');
  }, [token, role, loadUsers]);

  // Search handler
  const handleSearch = () => {
    setSearch(searchInput);
    setExpandedUser(null);
    setUserDetail(null);
    loadUsers(1, searchInput);
  };

  // Expand user detail
  const toggleUser = async (userId: number) => {
    if (expandedUser === userId) {
      setExpandedUser(null);
      setUserDetail(null);
      return;
    }
    setExpandedUser(userId);
    setUserDetail(null);
    try {
      const detail = await adminApi.userDetail(userId);
      setUserDetail(detail);
    } catch { /* silently fail */ }
  };

  // Pagination
  const totalPages = Math.ceil(userTotal / 50);
  const goPage = (pg: number) => {
    setExpandedUser(null);
    setUserDetail(null);
    loadUsers(pg, search);
  };

  if (!token || loading) {
    return (
      <div style={{ padding: 40, textAlign: 'center', color: 'var(--color-text-muted)' }}>
        Loading...
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ padding: 40, textAlign: 'center' }}>
        <p style={{ color: 'var(--color-danger)' }}>{error}</p>
      </div>
    );
  }

  const statCards = [
    { label: 'Total Users', value: stats?.total_users ?? 0, icon: '👥' },
    { label: 'Sign-ups (7d)', value: stats?.recent_signups ?? 0, icon: '📈' },
    { label: 'Total Policies', value: stats?.total_policies ?? 0, icon: '📋' },
    { label: 'Pending Drafts', value: stats?.pending_drafts ?? 0, icon: '📧' },
  ];

  const planEntries = stats?.plans ? Object.entries(stats.plans).sort((a, b) => b[1] - a[1]) : [];

  // Sparkline bar chart for signups
  const maxSignup = Math.max(...signups.map(s => s.count), 1);

  return (
    <div style={{ padding: '32px 24px', maxWidth: 1000, margin: '0 auto' }}>
      <h1 style={{ fontSize: 24, fontWeight: 700, margin: '0 0 8px', color: 'var(--color-text)' }}>
        Admin Dashboard
      </h1>
      <p style={{ fontSize: 14, color: 'var(--color-text-secondary)', margin: '0 0 32px' }}>
        Platform overview and user management.
      </p>

      {/* Stat Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 16, marginBottom: 32 }}>
        {statCards.map(card => (
          <div key={card.label} className="card" style={{ padding: 20, textAlign: 'center' }}>
            <div style={{ fontSize: 16, marginBottom: 6 }}>{card.icon}</div>
            <div style={{ fontSize: 28, fontWeight: 700, color: 'var(--color-primary)', marginBottom: 4 }}>
              {card.value}
            </div>
            <div style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>{card.label}</div>
          </div>
        ))}
      </div>

      {/* Plan Breakdown */}
      {planEntries.length > 0 && (
        <div className="card" style={{ padding: 20, marginBottom: 32 }}>
          <h3 style={{ fontSize: 15, fontWeight: 600, margin: '0 0 12px', color: 'var(--color-text)' }}>
            Plan Breakdown
          </h3>
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
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

      {/* Sign-up Trend */}
      {signups.length > 0 && (
        <div className="card" style={{ padding: 20, marginBottom: 32 }}>
          <h3 style={{ fontSize: 15, fontWeight: 600, margin: '0 0 12px', color: 'var(--color-text)' }}>
            Sign-ups (Last 30 Days)
          </h3>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: 80 }}>
            {signups.map(s => (
              <div
                key={s.date}
                title={`${s.date}: ${s.count}`}
                style={{
                  flex: 1,
                  minWidth: 4,
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

      {/* User List */}
      <div style={{ marginBottom: 32 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
          <h2 style={{ fontSize: 18, fontWeight: 600, margin: 0, color: 'var(--color-text)' }}>
            Users ({userTotal})
          </h2>
          <div style={{ display: 'flex', gap: 8, flex: 1, minWidth: 200 }}>
            <input
              type="text"
              placeholder="Search by email..."
              value={searchInput}
              onChange={e => setSearchInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleSearch()}
              className="form-input"
              style={{ flex: 1, padding: '8px 12px', fontSize: 14 }}
            />
            <button onClick={handleSearch} className="btn btn-primary" style={{ padding: '8px 16px', fontSize: 13 }}>
              Search
            </button>
          </div>
        </div>

        {users.length === 0 ? (
          <div className="card" style={{ padding: 40, textAlign: 'center', color: 'var(--color-text-muted)' }}>
            No users found.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {users.map(u => (
              <div key={u.id}>
                <div
                  className="card"
                  onClick={() => toggleUser(u.id)}
                  style={{
                    padding: '14px 18px',
                    cursor: 'pointer',
                    display: 'grid',
                    gridTemplateColumns: '1fr auto auto auto auto',
                    alignItems: 'center',
                    gap: '8px 16px',
                    transition: 'box-shadow 0.15s',
                    borderBottom: expandedUser === u.id ? 'none' : undefined,
                    borderRadius: expandedUser === u.id ? 'var(--radius-lg) var(--radius-lg) 0 0' : undefined,
                  }}
                  onMouseEnter={e => { e.currentTarget.style.boxShadow = '0 2px 8px rgba(0,0,0,0.08)'; }}
                  onMouseLeave={e => { e.currentTarget.style.boxShadow = ''; }}
                >
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{u.email}</div>
                    <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 2 }}>
                      Joined {u.created_at ? new Date(u.created_at).toLocaleDateString() : '--'}
                    </div>
                  </div>
                  <PlanBadge plan={u.plan} />
                  <RoleBadge role={u.role} />
                  <div style={{ textAlign: 'center' }}>
                    <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>Policies</div>
                    <div style={{ fontSize: 14, fontWeight: 600 }}>{u.policy_count}</div>
                  </div>
                  <div style={{ fontSize: 14, color: 'var(--color-text-muted)' }}>
                    {expandedUser === u.id ? '▲' : '▼'}
                  </div>
                </div>

                {/* Expanded detail */}
                {expandedUser === u.id && (
                  <div className="card" style={{
                    padding: '16px 18px',
                    borderTop: '1px solid var(--color-border)',
                    borderRadius: '0 0 var(--radius-lg) var(--radius-lg)',
                    backgroundColor: 'var(--color-bg)',
                  }}>
                    {!userDetail ? (
                      <div style={{ color: 'var(--color-text-muted)', fontSize: 13 }}>Loading...</div>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                        {/* Policies */}
                        {userDetail.policies.length > 0 && (
                          <div>
                            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-text)', marginBottom: 8 }}>
                              Policies ({userDetail.policies.length})
                            </div>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                              {userDetail.policies.map(p => (
                                <div key={p.id} style={{
                                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                                  padding: '8px 12px', backgroundColor: 'var(--color-surface)',
                                  borderRadius: 'var(--radius-sm)', border: '1px solid var(--color-border)', fontSize: 13,
                                }}>
                                  <span style={{ fontWeight: 500 }}>{p.carrier} — {p.policy_type}</span>
                                  <span style={{ color: 'var(--color-text-muted)' }}>{p.policy_number}</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Recent documents */}
                        {userDetail.recent_documents.length > 0 && (
                          <div>
                            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-text)', marginBottom: 8 }}>
                              Recent Documents
                            </div>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                              {userDetail.recent_documents.map(d => (
                                <div key={d.id} style={{
                                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                                  padding: '8px 12px', backgroundColor: 'var(--color-surface)',
                                  borderRadius: 'var(--radius-sm)', border: '1px solid var(--color-border)', fontSize: 13,
                                }}>
                                  <span>{d.filename}</span>
                                  <span style={{ color: 'var(--color-text-muted)' }}>{d.doc_type}</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Drafts */}
                        {userDetail.drafts.length > 0 && (
                          <div>
                            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-text)', marginBottom: 8 }}>
                              Drafts
                            </div>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                              {userDetail.drafts.map(dr => (
                                <div key={dr.id} style={{
                                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                                  padding: '8px 12px', backgroundColor: 'var(--color-surface)',
                                  borderRadius: 'var(--radius-sm)', border: '1px solid var(--color-border)', fontSize: 13,
                                }}>
                                  <span>{dr.original_filename}</span>
                                  <DraftStatusBadge status={dr.status} />
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        {userDetail.policies.length === 0 && userDetail.recent_documents.length === 0 && userDetail.drafts.length === 0 && (
                          <div style={{ color: 'var(--color-text-muted)', fontSize: 13 }}>No activity for this user.</div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <div style={{ display: 'flex', justifyContent: 'center', gap: 8, marginTop: 16 }}>
            <button
              onClick={() => goPage(userPage - 1)}
              disabled={userPage <= 1}
              className="btn btn-ghost"
              style={{ padding: '6px 12px', fontSize: 13 }}
            >
              Prev
            </button>
            <span style={{ padding: '6px 12px', fontSize: 13, color: 'var(--color-text-secondary)' }}>
              Page {userPage} of {totalPages}
            </span>
            <button
              onClick={() => goPage(userPage + 1)}
              disabled={userPage >= totalPages}
              className="btn btn-ghost"
              style={{ padding: '6px 12px', fontSize: 13 }}
            >
              Next
            </button>
          </div>
        )}
      </div>

      {/* Recent Activity */}
      <div>
        <h2 style={{ fontSize: 18, fontWeight: 600, margin: '0 0 16px', color: 'var(--color-text)' }}>
          Recent Activity
        </h2>
        {activity.length === 0 ? (
          <div className="card" style={{ padding: 40, textAlign: 'center', color: 'var(--color-text-muted)' }}>
            No recent activity.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {activity.map((a, i) => (
              <div key={i} className="card" style={{
                padding: '12px 18px',
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                flexWrap: 'wrap',
              }}>
                <span style={{
                  fontSize: 12,
                  fontWeight: 600,
                  padding: '2px 8px',
                  borderRadius: 10,
                  backgroundColor: a.type === 'upload' ? 'rgba(5, 150, 105, 0.1)' : 'rgba(217, 119, 6, 0.1)',
                  color: a.type === 'upload' ? 'var(--color-success)' : 'var(--color-warning)',
                }}>
                  {a.type === 'upload' ? 'Upload' : 'Draft'}
                </span>
                <span style={{ fontSize: 13, color: 'var(--color-text-secondary)', fontWeight: 500 }}>
                  {a.user_email}
                </span>
                <span style={{ fontSize: 13, color: 'var(--color-text)' }}>
                  {a.type === 'upload' ? a.filename : (a.original_filename || a.carrier || 'Draft')}
                </span>
                {a.status && a.type === 'draft' && <DraftStatusBadge status={a.status} />}
                <span style={{ fontSize: 12, color: 'var(--color-text-muted)', marginLeft: 'auto' }}>
                  {a.created_at ? new Date(a.created_at).toLocaleDateString() : ''}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function PlanBadge({ plan }: { plan: string }) {
  const colors: Record<string, string> = {
    pro: 'var(--color-accent)',
    basic: 'var(--color-info)',
    trial: 'var(--color-warning)',
    free: 'var(--color-text-muted)',
  };
  const c = colors[plan] || 'var(--color-text-muted)';
  return (
    <span style={{
      fontSize: 11,
      fontWeight: 600,
      padding: '2px 8px',
      borderRadius: 10,
      backgroundColor: `${c}18`,
      color: c,
      textTransform: 'uppercase',
    }}>
      {plan}
    </span>
  );
}

function RoleBadge({ role }: { role: string }) {
  if (role === 'individual') return null;
  const c = role === 'admin' ? 'var(--color-danger)' : 'var(--color-info)';
  return (
    <span style={{
      fontSize: 11,
      fontWeight: 600,
      padding: '2px 8px',
      borderRadius: 10,
      backgroundColor: `${c}18`,
      color: c,
    }}>
      {role}
    </span>
  );
}

function DraftStatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    pending: 'var(--color-warning)',
    approved: 'var(--color-success)',
    rejected: 'var(--color-danger)',
  };
  const c = colors[status] || 'var(--color-text-muted)';
  return (
    <span style={{
      fontSize: 11,
      fontWeight: 600,
      padding: '2px 8px',
      borderRadius: 10,
      backgroundColor: `${c}18`,
      color: c,
    }}>
      {status}
    </span>
  );
}
