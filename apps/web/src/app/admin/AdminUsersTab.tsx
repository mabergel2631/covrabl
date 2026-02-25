'use client';

import { useState, useEffect, useCallback } from 'react';
import { adminApi, AdminUser, AdminUserDetail } from '../../../lib/api';

// ── Badge helpers ────────────────────────────────────

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

function SuspendedBadge() {
  return (
    <span style={{
      fontSize: 11,
      fontWeight: 600,
      padding: '2px 8px',
      borderRadius: 10,
      backgroundColor: 'var(--color-danger)18',
      color: 'var(--color-danger)',
      textTransform: 'uppercase',
    }}>
      SUSPENDED
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

// ── Main component ───────────────────────────────────

export default function AdminUsersTab() {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [userTotal, setUserTotal] = useState(0);
  const [userPage, setUserPage] = useState(1);
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [expandedUser, setExpandedUser] = useState<number | null>(null);
  const [userDetail, setUserDetail] = useState<AdminUserDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionsOpen, setActionsOpen] = useState<number | null>(null);
  const [trialDaysInput, setTrialDaysInput] = useState<Record<number, string>>({});
  const [confirmDelete, setConfirmDelete] = useState<number | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  // Show a brief toast message
  const showToast = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2500);
  }, []);

  // Load users (paginated + search)
  const loadUsers = useCallback(async (pg: number, q: string) => {
    try {
      const res = await adminApi.users(pg, 50, q);
      setUsers(res.items);
      setUserTotal(res.total);
      setUserPage(res.page);
    } catch { /* silently fail */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    loadUsers(1, '');
  }, [loadUsers]);

  // Close actions dropdown when clicking outside
  useEffect(() => {
    if (actionsOpen === null) return;
    const handler = () => setActionsOpen(null);
    document.addEventListener('click', handler);
    return () => document.removeEventListener('click', handler);
  }, [actionsOpen]);

  // Search handler
  const handleSearch = () => {
    setSearch(searchInput);
    setExpandedUser(null);
    setUserDetail(null);
    setActionsOpen(null);
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
    setActionsOpen(null);
    loadUsers(pg, search);
  };

  // ── Action handlers ─────────────────────────────────

  const handleChangeRole = async (userId: number, role: string) => {
    try {
      const res = await adminApi.updateUserRole(userId, role);
      setUsers(prev => prev.map(u => u.id === userId ? { ...u, role: res.role } : u));
      showToast(`Role changed to ${res.role}`);
    } catch (err: any) {
      showToast(`Error: ${err.message || 'Failed to update role'}`);
    }
    setActionsOpen(null);
  };

  const handleChangePlan = async (userId: number, plan: string) => {
    try {
      const res = await adminApi.updateUserPlan(userId, plan);
      setUsers(prev => prev.map(u => u.id === userId ? { ...u, plan: res.plan } : u));
      showToast(`Plan changed to ${res.plan}`);
    } catch (err: any) {
      showToast(`Error: ${err.message || 'Failed to update plan'}`);
    }
    setActionsOpen(null);
  };

  const handleExtendTrial = async (userId: number) => {
    const days = parseInt(trialDaysInput[userId] || '0', 10);
    if (!days || days <= 0) return;
    try {
      const res = await adminApi.extendTrial(userId, days);
      setUsers(prev => prev.map(u => u.id === userId ? { ...u, trial_ends_at: res.trial_ends_at } : u));
      showToast(`Trial extended by ${days} day${days > 1 ? 's' : ''}`);
      setTrialDaysInput(prev => ({ ...prev, [userId]: '' }));
    } catch (err: any) {
      showToast(`Error: ${err.message || 'Failed to extend trial'}`);
    }
    setActionsOpen(null);
  };

  const handleSuspend = async (user: AdminUser) => {
    try {
      const res = await adminApi.suspendUser(user.id, !user.is_suspended);
      setUsers(prev => prev.map(u => u.id === user.id ? { ...u, is_suspended: res.is_suspended } : u));
      showToast(res.is_suspended ? 'User suspended' : 'User unsuspended');
    } catch (err: any) {
      showToast(`Error: ${err.message || 'Failed to update suspension'}`);
    }
    setActionsOpen(null);
  };

  const handlePasswordReset = async (userId: number) => {
    try {
      await adminApi.sendPasswordReset(userId);
      showToast('Password reset email sent');
    } catch (err: any) {
      showToast(`Error: ${err.message || 'Failed to send reset'}`);
    }
    setActionsOpen(null);
  };

  const handleDelete = async (userId: number) => {
    try {
      await adminApi.deleteUser(userId);
      setUsers(prev => prev.filter(u => u.id !== userId));
      setUserTotal(prev => prev - 1);
      showToast('User deleted');
      if (expandedUser === userId) {
        setExpandedUser(null);
        setUserDetail(null);
      }
    } catch (err: any) {
      showToast(`Error: ${err.message || 'Failed to delete user'}`);
    }
    setConfirmDelete(null);
    setActionsOpen(null);
  };

  // ── Render ──────────────────────────────────────────

  if (loading) {
    return (
      <div style={{ padding: 40, textAlign: 'center', color: 'var(--color-text-muted)' }}>
        Loading...
      </div>
    );
  }

  return (
    <div>
      {/* Toast */}
      {toast && (
        <div style={{
          position: 'fixed',
          top: 24,
          right: 24,
          zIndex: 9999,
          padding: '12px 20px',
          borderRadius: 'var(--radius-md)',
          backgroundColor: toast.startsWith('Error') ? 'var(--color-danger)' : 'var(--color-success)',
          color: '#fff',
          fontSize: 13,
          fontWeight: 600,
          boxShadow: '0 4px 16px rgba(0,0,0,0.15)',
          pointerEvents: 'none',
        }}>
          {toast}
        </div>
      )}

      {/* Header + Search */}
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

      {/* User List */}
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
                  gridTemplateColumns: '1fr auto auto auto auto auto auto',
                  alignItems: 'center',
                  gap: '8px 16px',
                  transition: 'box-shadow 0.15s',
                  borderBottom: expandedUser === u.id ? 'none' : undefined,
                  borderRadius: expandedUser === u.id ? 'var(--radius-lg) var(--radius-lg) 0 0' : undefined,
                }}
                onMouseEnter={e => { e.currentTarget.style.boxShadow = '0 2px 8px rgba(0,0,0,0.08)'; }}
                onMouseLeave={e => { e.currentTarget.style.boxShadow = ''; }}
              >
                {/* Email + join date */}
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {u.email}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 2 }}>
                    Joined {u.created_at ? new Date(u.created_at).toLocaleDateString() : '--'}
                  </div>
                </div>

                {/* Badges */}
                <PlanBadge plan={u.plan} />
                <RoleBadge role={u.role} />
                {u.is_suspended ? <SuspendedBadge /> : <span />}

                {/* Policy count */}
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>Policies</div>
                  <div style={{ fontSize: 14, fontWeight: 600 }}>{u.policy_count}</div>
                </div>

                {/* Actions "..." button */}
                <div style={{ position: 'relative' }}>
                  <button
                    onClick={e => {
                      e.stopPropagation();
                      setActionsOpen(actionsOpen === u.id ? null : u.id);
                      setConfirmDelete(null);
                    }}
                    className="btn btn-outline"
                    style={{
                      padding: '4px 10px',
                      fontSize: 16,
                      lineHeight: 1,
                      minWidth: 0,
                      borderRadius: 'var(--radius-sm)',
                    }}
                  >
                    ...
                  </button>

                  {/* Actions dropdown */}
                  {actionsOpen === u.id && (
                    <div
                      onClick={e => e.stopPropagation()}
                      style={{
                        position: 'absolute',
                        top: '100%',
                        right: 0,
                        marginTop: 4,
                        zIndex: 1000,
                        width: 300,
                        backgroundColor: 'var(--color-surface)',
                        border: '1px solid var(--color-border)',
                        borderRadius: 'var(--radius-lg)',
                        boxShadow: '0 8px 24px rgba(0,0,0,0.12)',
                        padding: 16,
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 14,
                      }}
                    >
                      {/* Change Role */}
                      <div>
                        <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text-secondary)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                          Change Role
                        </div>
                        <div style={{ display: 'flex', gap: 6 }}>
                          {['individual', 'agent', 'admin'].map(r => (
                            <button
                              key={r}
                              onClick={() => handleChangeRole(u.id, r)}
                              className="btn btn-outline"
                              style={{
                                padding: '4px 10px',
                                fontSize: 12,
                                flex: 1,
                                backgroundColor: u.role === r ? 'var(--color-primary)' : undefined,
                                color: u.role === r ? '#fff' : undefined,
                                borderColor: u.role === r ? 'var(--color-primary)' : undefined,
                              }}
                            >
                              {r}
                            </button>
                          ))}
                        </div>
                      </div>

                      {/* Change Plan */}
                      <div>
                        <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text-secondary)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                          Change Plan
                        </div>
                        <div style={{ display: 'flex', gap: 6 }}>
                          {['trial', 'free', 'basic', 'pro'].map(p => (
                            <button
                              key={p}
                              onClick={() => handleChangePlan(u.id, p)}
                              className="btn btn-outline"
                              style={{
                                padding: '4px 10px',
                                fontSize: 12,
                                flex: 1,
                                backgroundColor: u.plan === p ? 'var(--color-primary)' : undefined,
                                color: u.plan === p ? '#fff' : undefined,
                                borderColor: u.plan === p ? 'var(--color-primary)' : undefined,
                              }}
                            >
                              {p}
                            </button>
                          ))}
                        </div>
                      </div>

                      {/* Extend Trial */}
                      <div>
                        <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text-secondary)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                          Extend Trial
                        </div>
                        <div style={{ display: 'flex', gap: 6 }}>
                          <input
                            type="number"
                            min={1}
                            placeholder="Days"
                            value={trialDaysInput[u.id] || ''}
                            onChange={e => setTrialDaysInput(prev => ({ ...prev, [u.id]: e.target.value }))}
                            onClick={e => e.stopPropagation()}
                            className="form-input"
                            style={{ flex: 1, padding: '4px 8px', fontSize: 12 }}
                          />
                          <button
                            onClick={() => handleExtendTrial(u.id)}
                            className="btn btn-primary"
                            style={{ padding: '4px 12px', fontSize: 12 }}
                          >
                            Extend
                          </button>
                        </div>
                      </div>

                      {/* Suspend / Unsuspend */}
                      <button
                        onClick={() => handleSuspend(u)}
                        className="btn btn-outline"
                        style={{
                          padding: '6px 12px',
                          fontSize: 12,
                          color: u.is_suspended ? 'var(--color-success)' : 'var(--color-warning)',
                          borderColor: u.is_suspended ? 'var(--color-success)' : 'var(--color-warning)',
                        }}
                      >
                        {u.is_suspended ? 'Unsuspend User' : 'Suspend User'}
                      </button>

                      {/* Send Password Reset */}
                      <button
                        onClick={() => handlePasswordReset(u.id)}
                        className="btn btn-outline"
                        style={{ padding: '6px 12px', fontSize: 12 }}
                      >
                        Send Password Reset
                      </button>

                      {/* Delete Account */}
                      {confirmDelete === u.id ? (
                        <div style={{
                          padding: 12,
                          borderRadius: 'var(--radius-md)',
                          backgroundColor: 'var(--color-danger)10',
                          border: '1px solid var(--color-danger)',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: 8,
                        }}>
                          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-danger)' }}>
                            Permanently delete this user and all their data?
                          </div>
                          <div style={{ display: 'flex', gap: 8 }}>
                            <button
                              onClick={() => handleDelete(u.id)}
                              style={{
                                flex: 1,
                                padding: '6px 12px',
                                fontSize: 12,
                                fontWeight: 600,
                                border: 'none',
                                borderRadius: 'var(--radius-sm)',
                                backgroundColor: 'var(--color-danger)',
                                color: '#fff',
                                cursor: 'pointer',
                              }}
                            >
                              Confirm Delete
                            </button>
                            <button
                              onClick={() => setConfirmDelete(null)}
                              className="btn btn-outline"
                              style={{ flex: 1, padding: '6px 12px', fontSize: 12 }}
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      ) : (
                        <button
                          onClick={() => setConfirmDelete(u.id)}
                          style={{
                            padding: '6px 12px',
                            fontSize: 12,
                            fontWeight: 600,
                            border: '1px solid var(--color-danger)',
                            borderRadius: 'var(--radius-sm)',
                            backgroundColor: 'transparent',
                            color: 'var(--color-danger)',
                            cursor: 'pointer',
                          }}
                        >
                          Delete Account
                        </button>
                      )}
                    </div>
                  )}
                </div>

                {/* Expand arrow */}
                <div style={{ fontSize: 14, color: 'var(--color-text-muted)' }}>
                  {expandedUser === u.id ? '\u25B2' : '\u25BC'}
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
            className="btn btn-outline"
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
            className="btn btn-outline"
            style={{ padding: '6px 12px', fontSize: 13 }}
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}
