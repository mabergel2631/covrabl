'use client';

import { useState, useEffect } from 'react';
import { adminApi, AdminAnnouncement } from '../../../lib/api';

type AnnouncementForm = {
  title: string;
  message: string;
  type: string;
  starts_at: string;
  ends_at: string;
  is_active: boolean;
};

const EMPTY_FORM: AnnouncementForm = {
  title: '',
  message: '',
  type: 'info',
  starts_at: '',
  ends_at: '',
  is_active: true,
};

export default function AdminAnnouncementsTab() {
  const [announcements, setAnnouncements] = useState<AdminAnnouncement[]>([]);
  const [loading, setLoading] = useState(true);

  // Create / Edit form
  const [showCreate, setShowCreate] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<AnnouncementForm>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetchAnnouncements();
  }, []);

  const fetchAnnouncements = async () => {
    setLoading(true);
    try {
      const list = await adminApi.announcements();
      setAnnouncements(list);
    } catch { /* handled at page level */ }
    finally { setLoading(false); }
  };

  const toLocalDatetime = (iso: string | null): string => {
    if (!iso) return '';
    try {
      const d = new Date(iso);
      const offset = d.getTimezoneOffset();
      const local = new Date(d.getTime() - offset * 60000);
      return local.toISOString().slice(0, 16);
    } catch {
      return '';
    }
  };

  const openCreate = () => {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setShowCreate(true);
  };

  const openEdit = (ann: AdminAnnouncement) => {
    setShowCreate(false);
    setEditingId(ann.id);
    setForm({
      title: ann.title,
      message: ann.message,
      type: ann.type,
      starts_at: toLocalDatetime(ann.starts_at),
      ends_at: toLocalDatetime(ann.ends_at),
      is_active: ann.is_active,
    });
  };

  const cancelForm = () => {
    setShowCreate(false);
    setEditingId(null);
    setForm(EMPTY_FORM);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const payload: any = {
        title: form.title,
        message: form.message,
        type: form.type,
        is_active: form.is_active,
        starts_at: form.starts_at ? new Date(form.starts_at).toISOString() : null,
        ends_at: form.ends_at ? new Date(form.ends_at).toISOString() : null,
      };

      if (editingId) {
        const updated = await adminApi.updateAnnouncement(editingId, payload);
        setAnnouncements(prev => prev.map(a => a.id === editingId ? updated : a));
        setEditingId(null);
      } else {
        const created = await adminApi.createAnnouncement(payload);
        setAnnouncements(prev => [created, ...prev]);
        setShowCreate(false);
      }
      setForm(EMPTY_FORM);
    } catch { /* silently fail */ }
    finally { setSaving(false); }
  };

  const handleToggle = async (ann: AdminAnnouncement) => {
    try {
      const updated = await adminApi.updateAnnouncement(ann.id, { is_active: !ann.is_active });
      setAnnouncements(prev => prev.map(a => a.id === ann.id ? updated : a));
    } catch { /* silently fail */ }
  };

  const handleDelete = async (id: number) => {
    if (!confirm('Are you sure you want to delete this announcement?')) return;
    try {
      await adminApi.deleteAnnouncement(id);
      setAnnouncements(prev => prev.filter(a => a.id !== id));
      if (editingId === id) {
        setEditingId(null);
        setForm(EMPTY_FORM);
      }
    } catch { /* silently fail */ }
  };

  const typeColor = (type: string): string => {
    switch (type) {
      case 'info': return 'var(--color-info)';
      case 'warning': return 'var(--color-warning)';
      case 'maintenance': return 'var(--color-danger)';
      default: return 'var(--color-text-muted)';
    }
  };

  const renderForm = () => (
    <div className="card" style={{ padding: 20, marginBottom: 16, border: '1px solid var(--color-primary)', borderRadius: 'var(--radius-lg)' }}>
      <h3 style={{ fontSize: 15, fontWeight: 600, margin: '0 0 16px', color: 'var(--color-text)' }}>
        {editingId ? 'Edit Announcement' : 'Create Announcement'}
      </h3>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text-secondary)' }}>Title</label>
          <input
            type="text"
            value={form.title}
            onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
            placeholder="Announcement title..."
            className="form-input"
            style={{ padding: '8px 12px', fontSize: 14 }}
          />
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text-secondary)' }}>Message</label>
          <textarea
            value={form.message}
            onChange={e => setForm(f => ({ ...f, message: e.target.value }))}
            placeholder="Announcement message..."
            className="form-input"
            rows={4}
            style={{ padding: '8px 12px', fontSize: 14, resize: 'vertical', fontFamily: 'inherit' }}
          />
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text-secondary)' }}>Type</label>
            <select
              value={form.type}
              onChange={e => setForm(f => ({ ...f, type: e.target.value }))}
              className="form-input"
              style={{ padding: '8px 12px', fontSize: 13 }}
            >
              <option value="info">Info</option>
              <option value="warning">Warning</option>
              <option value="maintenance">Maintenance</option>
            </select>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text-secondary)' }}>Starts At</label>
            <input
              type="datetime-local"
              value={form.starts_at}
              onChange={e => setForm(f => ({ ...f, starts_at: e.target.value }))}
              className="form-input"
              style={{ padding: '8px 12px', fontSize: 13 }}
            />
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text-secondary)' }}>Ends At</label>
            <input
              type="datetime-local"
              value={form.ends_at}
              onChange={e => setForm(f => ({ ...f, ends_at: e.target.value }))}
              className="form-input"
              style={{ padding: '8px 12px', fontSize: 13 }}
            />
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <label
            style={{ position: 'relative', display: 'inline-block', width: 40, height: 22, cursor: 'pointer' }}
            onClick={() => setForm(f => ({ ...f, is_active: !f.is_active }))}
          >
            <div style={{
              width: 40,
              height: 22,
              borderRadius: 11,
              backgroundColor: form.is_active ? 'var(--color-success)' : 'var(--color-border)',
              transition: 'background-color 0.2s',
              position: 'relative',
            }}>
              <div style={{
                width: 18,
                height: 18,
                borderRadius: '50%',
                backgroundColor: '#fff',
                position: 'absolute',
                top: 2,
                left: form.is_active ? 20 : 2,
                transition: 'left 0.2s',
                boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
              }} />
            </div>
          </label>
          <span style={{ fontSize: 13, color: 'var(--color-text-secondary)' }}>
            {form.is_active ? 'Active' : 'Inactive'}
          </span>
        </div>

        <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
          <button
            onClick={handleSave}
            disabled={saving || !form.title.trim() || !form.message.trim()}
            className="btn btn-primary"
            style={{ padding: '8px 20px', fontSize: 13 }}
          >
            {saving ? 'Saving...' : 'Save'}
          </button>
          <button
            onClick={cancelForm}
            className="btn btn-outline"
            style={{ padding: '8px 16px', fontSize: 13 }}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );

  if (loading) {
    return <div style={{ padding: 40, textAlign: 'center', color: 'var(--color-text-muted)' }}>Loading...</div>;
  }

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <div style={{ fontSize: 14, color: 'var(--color-text-secondary)' }}>
          {announcements.length} announcement{announcements.length !== 1 ? 's' : ''}
        </div>
        {!showCreate && !editingId && (
          <button
            onClick={openCreate}
            className="btn btn-primary"
            style={{ padding: '8px 18px', fontSize: 13 }}
          >
            Create Announcement
          </button>
        )}
      </div>

      {/* Create form at top */}
      {showCreate && renderForm()}

      {/* Announcement list */}
      {announcements.length === 0 && !showCreate ? (
        <div className="card" style={{ padding: 40, textAlign: 'center', color: 'var(--color-text-muted)' }}>
          No announcements yet.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {announcements.map(ann => (
            <div key={ann.id}>
              {editingId === ann.id ? (
                renderForm()
              ) : (
                <div className="card" style={{ padding: 18 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      {/* Title + type badge */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                        <h4 style={{ fontSize: 15, fontWeight: 600, margin: 0, color: 'var(--color-text)' }}>
                          {ann.title}
                        </h4>
                        <span style={{
                          fontSize: 11,
                          fontWeight: 600,
                          padding: '2px 8px',
                          borderRadius: 10,
                          backgroundColor: `${typeColor(ann.type)}18`,
                          color: typeColor(ann.type),
                          whiteSpace: 'nowrap',
                        }}>
                          {ann.type}
                        </span>
                      </div>

                      {/* Message preview */}
                      <p style={{ fontSize: 13, color: 'var(--color-text-secondary)', margin: '0 0 8px', lineHeight: 1.5 }}>
                        {ann.message.length > 100 ? ann.message.slice(0, 100) + '...' : ann.message}
                      </p>

                      {/* Date range */}
                      <div style={{ fontSize: 12, color: 'var(--color-text-muted)', display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                        {ann.starts_at && (
                          <span>From: {new Date(ann.starts_at).toLocaleString()}</span>
                        )}
                        {ann.ends_at && (
                          <span>To: {new Date(ann.ends_at).toLocaleString()}</span>
                        )}
                        {!ann.starts_at && !ann.ends_at && (
                          <span>No date range set</span>
                        )}
                      </div>
                    </div>

                    {/* Right side: toggle + actions */}
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 10, flexShrink: 0 }}>
                      {/* Toggle switch */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>
                          {ann.is_active ? 'Active' : 'Inactive'}
                        </span>
                        <div
                          onClick={() => handleToggle(ann)}
                          style={{
                            width: 40,
                            height: 22,
                            borderRadius: 11,
                            backgroundColor: ann.is_active ? 'var(--color-success)' : 'var(--color-border)',
                            transition: 'background-color 0.2s',
                            position: 'relative',
                            cursor: 'pointer',
                          }}
                        >
                          <div style={{
                            width: 18,
                            height: 18,
                            borderRadius: '50%',
                            backgroundColor: '#fff',
                            position: 'absolute',
                            top: 2,
                            left: ann.is_active ? 20 : 2,
                            transition: 'left 0.2s',
                            boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
                          }} />
                        </div>
                      </div>

                      {/* Edit / Delete buttons */}
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button
                          onClick={() => openEdit(ann)}
                          className="btn btn-outline"
                          style={{ padding: '4px 12px', fontSize: 12 }}
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => handleDelete(ann.id)}
                          style={{
                            padding: '4px 12px',
                            fontSize: 12,
                            fontWeight: 600,
                            borderRadius: 'var(--radius-sm)',
                            border: '1px solid var(--color-danger)',
                            backgroundColor: 'transparent',
                            color: 'var(--color-danger)',
                            cursor: 'pointer',
                          }}
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
