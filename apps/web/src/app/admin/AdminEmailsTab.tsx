'use client';

import { useState, useEffect } from 'react';
import { adminApi, AdminEmailLogEntry } from '../../../lib/api';

const EMAIL_TYPES = [
  { value: '', label: 'All types' },
  { value: 'password_reset', label: 'Password Reset' },
  { value: 'share_notification', label: 'Share Notification' },
  { value: 'renewal_reminder', label: 'Renewal Reminder' },
  { value: 'admin_password_reset', label: 'Admin Password Reset' },
];

export default function AdminEmailsTab() {
  const [entries, setEntries] = useState<AdminEmailLogEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [limit] = useState(25);
  const [loading, setLoading] = useState(true);

  // Filter state
  const [emailType, setEmailType] = useState('');
  const [recipient, setRecipient] = useState('');

  useEffect(() => {
    fetchEmails(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fetchEmails = async (pg: number) => {
    setLoading(true);
    try {
      const res = await adminApi.emailLogs({
        page: pg,
        limit,
        email_type: emailType || undefined,
        recipient: recipient || undefined,
      });
      setEntries(res.items);
      setTotal(res.total);
      setPage(res.page);
    } catch { /* handled at page level */ }
    finally { setLoading(false); }
  };

  const handleApply = () => {
    fetchEmails(1);
  };

  const goPage = (pg: number) => {
    fetchEmails(pg);
  };

  const totalPages = Math.ceil(total / limit);

  const typeColor = (type: string): string => {
    switch (type) {
      case 'password_reset': return 'var(--color-warning)';
      case 'share_notification': return 'var(--color-info)';
      case 'renewal_reminder': return 'var(--color-accent)';
      case 'admin_password_reset': return 'var(--color-danger)';
      default: return 'var(--color-text-muted)';
    }
  };

  const typeLabel = (type: string): string => {
    const found = EMAIL_TYPES.find(t => t.value === type);
    return found ? found.label : type;
  };

  return (
    <div>
      {/* Filter Bar */}
      <div className="card" style={{ padding: 16, marginBottom: 20, display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: '0 1 180px', minWidth: 150 }}>
          <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text-secondary)' }}>Email Type</label>
          <select
            value={emailType}
            onChange={e => setEmailType(e.target.value)}
            className="form-input"
            style={{ padding: '7px 10px', fontSize: 13 }}
          >
            {EMAIL_TYPES.map(t => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </select>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: '1 1 200px', minWidth: 160 }}>
          <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text-secondary)' }}>Recipient</label>
          <input
            type="text"
            placeholder="Search by recipient..."
            value={recipient}
            onChange={e => setRecipient(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleApply()}
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
          No email logs found.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {entries.map(entry => (
            <div
              key={entry.id}
              className="card"
              style={{
                padding: '12px 16px',
                display: 'grid',
                gridTemplateColumns: '1fr auto 1fr auto 140px',
                alignItems: 'center',
                gap: '6px 14px',
              }}
            >
              {/* Recipient */}
              <span style={{ fontSize: 13, color: 'var(--color-text)', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {entry.recipient}
              </span>

              {/* Type badge */}
              <span style={{
                fontSize: 11,
                fontWeight: 600,
                padding: '2px 8px',
                borderRadius: 10,
                backgroundColor: `${typeColor(entry.email_type)}18`,
                color: typeColor(entry.email_type),
                whiteSpace: 'nowrap',
              }}>
                {typeLabel(entry.email_type)}
              </span>

              {/* Subject */}
              <span style={{ fontSize: 13, color: 'var(--color-text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {entry.subject}
              </span>

              {/* Status badge */}
              <span style={{
                fontSize: 11,
                fontWeight: 600,
                padding: '2px 8px',
                borderRadius: 10,
                backgroundColor: entry.status === 'sent'
                  ? 'rgba(5, 150, 105, 0.1)'
                  : 'rgba(220, 38, 38, 0.1)',
                color: entry.status === 'sent'
                  ? 'var(--color-success)'
                  : 'var(--color-danger)',
                whiteSpace: 'nowrap',
              }}>
                {entry.status}
              </span>

              {/* Timestamp */}
              <span style={{ fontSize: 12, color: 'var(--color-text-muted)', textAlign: 'right', whiteSpace: 'nowrap' }}>
                {entry.created_at ? new Date(entry.created_at).toLocaleString() : '--'}
              </span>
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
