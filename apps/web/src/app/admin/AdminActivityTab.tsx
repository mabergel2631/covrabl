'use client';

import { useState, useEffect } from 'react';
import { adminApi, AdminAuditLogEntry, AdminAuditFilters } from '../../../lib/api';

export default function AdminActivityTab() {
  const [entries, setEntries] = useState<AdminAuditLogEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [limit] = useState(25);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState<AdminAuditFilters>({ actions: [], entity_types: [] });

  // Filter state
  const [userEmail, setUserEmail] = useState('');
  const [action, setAction] = useState('');
  const [entityType, setEntityType] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  // Expanded row for details
  const [expandedId, setExpandedId] = useState<number | null>(null);

  useEffect(() => {
    adminApi.auditLogFilters().then(setFilters).catch(() => {});
    fetchLogs(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fetchLogs = async (pg: number) => {
    setLoading(true);
    try {
      const res = await adminApi.auditLogs({
        page: pg,
        limit,
        user_email: userEmail || undefined,
        action: action || undefined,
        entity_type: entityType || undefined,
        date_from: dateFrom || undefined,
        date_to: dateTo || undefined,
      });
      setEntries(res.items);
      setTotal(res.total);
      setPage(res.page);
    } catch { /* handled at page level */ }
    finally { setLoading(false); }
  };

  const handleApply = () => {
    setExpandedId(null);
    fetchLogs(1);
  };

  const goPage = (pg: number) => {
    setExpandedId(null);
    fetchLogs(pg);
  };

  const totalPages = Math.ceil(total / limit);

  const actionColor = (act: string): string => {
    if (act.startsWith('create') || act === 'approve') return 'var(--color-success)';
    if (act.startsWith('delete') || act === 'reject' || act === 'suspend') return 'var(--color-danger)';
    if (act.startsWith('update') || act.startsWith('change') || act === 'extend_trial') return 'var(--color-warning)';
    if (act === 'login' || act === 'signup') return 'var(--color-info)';
    return 'var(--color-text-muted)';
  };

  return (
    <div>
      {/* Filter Bar */}
      <div className="card" style={{ padding: 16, marginBottom: 20, display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: '1 1 180px', minWidth: 150 }}>
          <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text-secondary)' }}>User Email</label>
          <input
            type="text"
            placeholder="Search by email..."
            value={userEmail}
            onChange={e => setUserEmail(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleApply()}
            className="form-input"
            style={{ padding: '7px 10px', fontSize: 13 }}
          />
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: '0 1 160px', minWidth: 130 }}>
          <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text-secondary)' }}>Action</label>
          <select
            value={action}
            onChange={e => setAction(e.target.value)}
            className="form-input"
            style={{ padding: '7px 10px', fontSize: 13 }}
          >
            <option value="">All actions</option>
            {filters.actions.map(a => (
              <option key={a} value={a}>{a}</option>
            ))}
          </select>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: '0 1 160px', minWidth: 130 }}>
          <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text-secondary)' }}>Entity Type</label>
          <select
            value={entityType}
            onChange={e => setEntityType(e.target.value)}
            className="form-input"
            style={{ padding: '7px 10px', fontSize: 13 }}
          >
            <option value="">All entities</option>
            {filters.entity_types.map(et => (
              <option key={et} value={et}>{et}</option>
            ))}
          </select>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: '0 1 150px', minWidth: 130 }}>
          <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text-secondary)' }}>From</label>
          <input
            type="date"
            value={dateFrom}
            onChange={e => setDateFrom(e.target.value)}
            className="form-input"
            style={{ padding: '7px 10px', fontSize: 13 }}
          />
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: '0 1 150px', minWidth: 130 }}>
          <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text-secondary)' }}>To</label>
          <input
            type="date"
            value={dateTo}
            onChange={e => setDateTo(e.target.value)}
            className="form-input"
            style={{ padding: '7px 10px', fontSize: 13 }}
          />
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
          No audit log entries found.
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
                  gridTemplateColumns: '140px 1fr auto auto auto 1fr',
                  alignItems: 'center',
                  gap: '6px 14px',
                  cursor: entry.details ? 'pointer' : 'default',
                  borderRadius: expandedId === entry.id ? 'var(--radius-lg) var(--radius-lg) 0 0' : undefined,
                }}
                onClick={() => entry.details && setExpandedId(expandedId === entry.id ? null : entry.id)}
              >
                {/* Timestamp */}
                <span style={{ fontSize: 12, color: 'var(--color-text-muted)', whiteSpace: 'nowrap' }}>
                  {entry.created_at ? new Date(entry.created_at).toLocaleString() : '--'}
                </span>

                {/* User email */}
                <span style={{ fontSize: 13, color: 'var(--color-text-secondary)', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {entry.user_email}
                </span>

                {/* Action badge */}
                <span style={{
                  fontSize: 11,
                  fontWeight: 600,
                  padding: '2px 8px',
                  borderRadius: 10,
                  backgroundColor: `${actionColor(entry.action)}18`,
                  color: actionColor(entry.action),
                  whiteSpace: 'nowrap',
                }}>
                  {entry.action}
                </span>

                {/* Entity type */}
                <span style={{ fontSize: 12, color: 'var(--color-text-muted)', whiteSpace: 'nowrap' }}>
                  {entry.entity_type}
                </span>

                {/* Entity ID */}
                <span style={{ fontSize: 12, color: 'var(--color-text-muted)', fontFamily: 'monospace' }}>
                  #{entry.entity_id}
                </span>

                {/* Details (truncated) */}
                <span style={{ fontSize: 12, color: 'var(--color-text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {entry.details
                    ? (entry.details.length > 80 && expandedId !== entry.id
                      ? entry.details.slice(0, 80) + '...'
                      : (expandedId !== entry.id ? entry.details : entry.details.slice(0, 80) + (entry.details.length > 80 ? '...' : '')))
                    : ''}
                </span>
              </div>

              {/* Expanded details */}
              {expandedId === entry.id && entry.details && (
                <div className="card" style={{
                  padding: '12px 16px',
                  borderTop: '1px solid var(--color-border)',
                  borderRadius: '0 0 var(--radius-lg) var(--radius-lg)',
                  backgroundColor: 'var(--color-bg)',
                }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text-secondary)', marginBottom: 6 }}>
                    Full Details
                  </div>
                  <pre style={{
                    fontSize: 12,
                    color: 'var(--color-text)',
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word',
                    margin: 0,
                    fontFamily: 'monospace',
                    lineHeight: 1.5,
                  }}>
                    {entry.details}
                  </pre>
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
