'use client';

import { useState, useEffect } from 'react';
import { adminApi, AdminDraftEntry } from '../../../lib/api';

export default function AdminDraftsTab() {
  const [entries, setEntries] = useState<AdminDraftEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [limit] = useState(25);
  const [loading, setLoading] = useState(true);

  // Filter state
  const [statusFilter, setStatusFilter] = useState('');

  // Inline approve form state
  const [approvingId, setApprovingId] = useState<number | null>(null);
  const [approveScope, setApproveScope] = useState('personal');
  const [approvePolicyType, setApprovePolicyType] = useState('');
  const [actionLoading, setActionLoading] = useState<number | null>(null);

  useEffect(() => {
    fetchDrafts(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fetchDrafts = async (pg: number) => {
    setLoading(true);
    try {
      const res = await adminApi.drafts({
        page: pg,
        limit,
        status: statusFilter || undefined,
      });
      setEntries(res.items);
      setTotal(res.total);
      setPage(res.page);
    } catch { /* handled at page level */ }
    finally { setLoading(false); }
  };

  const handleApply = () => {
    setApprovingId(null);
    fetchDrafts(1);
  };

  const goPage = (pg: number) => {
    setApprovingId(null);
    fetchDrafts(pg);
  };

  const totalPages = Math.ceil(total / limit);

  const openApproveForm = (draftId: number) => {
    setApprovingId(draftId);
    setApproveScope('personal');
    setApprovePolicyType('');
  };

  const handleConfirmApprove = async (draftId: number) => {
    setActionLoading(draftId);
    try {
      await adminApi.approveDraft(draftId, {
        scope: approveScope,
        policy_type: approvePolicyType || undefined,
      });
      setEntries(prev => prev.map(e =>
        e.id === draftId ? { ...e, status: 'approved' } : e
      ));
      setApprovingId(null);
    } catch { /* silently fail */ }
    finally { setActionLoading(null); }
  };

  const handleReject = async (draftId: number) => {
    if (!confirm('Are you sure you want to reject this draft?')) return;
    setActionLoading(draftId);
    try {
      await adminApi.rejectDraft(draftId);
      setEntries(prev => prev.map(e =>
        e.id === draftId ? { ...e, status: 'rejected' } : e
      ));
    } catch { /* silently fail */ }
    finally { setActionLoading(null); }
  };

  const statusColor = (status: string): string => {
    switch (status) {
      case 'pending': return 'var(--color-warning)';
      case 'approved': return 'var(--color-success)';
      case 'rejected': return 'var(--color-danger)';
      default: return 'var(--color-text-muted)';
    }
  };

  return (
    <div>
      {/* Filter Bar */}
      <div className="card" style={{ padding: 16, marginBottom: 20, display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: '0 1 180px', minWidth: 150 }}>
          <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text-secondary)' }}>Status</label>
          <select
            value={statusFilter}
            onChange={e => setStatusFilter(e.target.value)}
            className="form-input"
            style={{ padding: '7px 10px', fontSize: 13 }}
          >
            <option value="">All statuses</option>
            <option value="pending">Pending</option>
            <option value="approved">Approved</option>
            <option value="rejected">Rejected</option>
          </select>
        </div>

        <button
          onClick={handleApply}
          className="btn btn-primary"
          style={{ padding: '8px 20px', fontSize: 13, alignSelf: 'flex-end' }}
        >
          Apply
        </button>
      </div>

      {/* Results */}
      {loading ? (
        <div style={{ padding: 40, textAlign: 'center', color: 'var(--color-text-muted)' }}>Loading...</div>
      ) : entries.length === 0 ? (
        <div className="card" style={{ padding: 40, textAlign: 'center', color: 'var(--color-text-muted)' }}>
          No drafts found.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {entries.map(entry => (
            <div key={entry.id}>
              <div
                className="card"
                style={{
                  padding: '12px 16px',
                  display: 'grid',
                  gridTemplateColumns: '1fr auto auto auto auto 130px auto',
                  alignItems: 'center',
                  gap: '6px 12px',
                  borderRadius: approvingId === entry.id ? 'var(--radius-lg) var(--radius-lg) 0 0' : undefined,
                }}
              >
                {/* User email */}
                <span style={{ fontSize: 13, color: 'var(--color-text)', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {entry.user_email}
                </span>

                {/* Carrier */}
                <span style={{ fontSize: 12, color: 'var(--color-text-secondary)', whiteSpace: 'nowrap' }}>
                  {entry.carrier || '--'}
                </span>

                {/* Policy type */}
                <span style={{ fontSize: 12, color: 'var(--color-text-muted)', whiteSpace: 'nowrap' }}>
                  {entry.policy_type || '--'}
                </span>

                {/* Filename */}
                <span style={{ fontSize: 12, color: 'var(--color-text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 180 }}>
                  {entry.original_filename || '--'}
                </span>

                {/* Status badge */}
                <span style={{
                  fontSize: 11,
                  fontWeight: 600,
                  padding: '2px 8px',
                  borderRadius: 10,
                  backgroundColor: `${statusColor(entry.status)}18`,
                  color: statusColor(entry.status),
                  whiteSpace: 'nowrap',
                }}>
                  {entry.status}
                </span>

                {/* Created at */}
                <span style={{ fontSize: 12, color: 'var(--color-text-muted)', whiteSpace: 'nowrap' }}>
                  {entry.created_at ? new Date(entry.created_at).toLocaleDateString() : '--'}
                </span>

                {/* Actions */}
                <div style={{ display: 'flex', gap: 6 }}>
                  {entry.status === 'pending' && (
                    <>
                      <button
                        onClick={() => openApproveForm(entry.id)}
                        disabled={actionLoading === entry.id}
                        style={{
                          padding: '4px 10px',
                          fontSize: 12,
                          fontWeight: 600,
                          borderRadius: 'var(--radius-sm)',
                          border: 'none',
                          cursor: 'pointer',
                          backgroundColor: 'rgba(5, 150, 105, 0.1)',
                          color: 'var(--color-success)',
                        }}
                      >
                        Approve
                      </button>
                      <button
                        onClick={() => handleReject(entry.id)}
                        disabled={actionLoading === entry.id}
                        style={{
                          padding: '4px 10px',
                          fontSize: 12,
                          fontWeight: 600,
                          borderRadius: 'var(--radius-sm)',
                          border: 'none',
                          cursor: 'pointer',
                          backgroundColor: 'rgba(220, 38, 38, 0.1)',
                          color: 'var(--color-danger)',
                        }}
                      >
                        Reject
                      </button>
                    </>
                  )}
                </div>
              </div>

              {/* Inline approve form */}
              {approvingId === entry.id && (
                <div className="card" style={{
                  padding: '14px 16px',
                  borderTop: '1px solid var(--color-border)',
                  borderRadius: '0 0 var(--radius-lg) var(--radius-lg)',
                  backgroundColor: 'var(--color-bg)',
                  display: 'flex',
                  gap: 12,
                  alignItems: 'flex-end',
                  flexWrap: 'wrap',
                }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text-secondary)' }}>Scope</label>
                    <select
                      value={approveScope}
                      onChange={e => setApproveScope(e.target.value)}
                      className="form-input"
                      style={{ padding: '6px 10px', fontSize: 13, minWidth: 130 }}
                    >
                      <option value="personal">Personal</option>
                      <option value="business">Business</option>
                    </select>
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: '1 1 160px' }}>
                    <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text-secondary)' }}>Policy Type (optional)</label>
                    <input
                      type="text"
                      placeholder="e.g. Auto, Home..."
                      value={approvePolicyType}
                      onChange={e => setApprovePolicyType(e.target.value)}
                      className="form-input"
                      style={{ padding: '6px 10px', fontSize: 13 }}
                    />
                  </div>

                  <button
                    onClick={() => handleConfirmApprove(entry.id)}
                    disabled={actionLoading === entry.id}
                    className="btn btn-primary"
                    style={{ padding: '7px 16px', fontSize: 13 }}
                  >
                    {actionLoading === entry.id ? 'Approving...' : 'Confirm Approve'}
                  </button>

                  <button
                    onClick={() => setApprovingId(null)}
                    className="btn btn-outline"
                    style={{ padding: '7px 14px', fontSize: 13 }}
                  >
                    Cancel
                  </button>
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
            onClick={() => goPage(page - 1)}
            disabled={page <= 1}
            className="btn btn-outline"
            style={{ padding: '6px 14px', fontSize: 13 }}
          >
            Prev
          </button>
          <span style={{ padding: '6px 12px', fontSize: 13, color: 'var(--color-text-secondary)' }}>
            Page {page} of {totalPages}
          </span>
          <button
            onClick={() => goPage(page + 1)}
            disabled={page >= totalPages}
            className="btn btn-outline"
            style={{ padding: '6px 14px', fontSize: 13 }}
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}
