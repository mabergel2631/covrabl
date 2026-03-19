'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '../../../lib/auth';
import { profileApi, authApi, UserProfile, ProfileContact, ProfileContactCreate } from '../../../lib/api';
import { formatPhone } from '../../../lib/format';
import { trackClick, trackFeatureUse } from '../../../lib/track';
import { useToast } from '../components/Toast';
import BackButton from '../components/BackButton';

const CONTEXT_FLAGS: { key: keyof UserProfile; label: string; help: string }[] = [
  { key: 'is_homeowner', label: 'I own a home', help: 'Helps identify homeowners insurance gaps' },
  { key: 'is_renter', label: 'I rent', help: 'Helps identify renters insurance gaps' },
  { key: 'has_dependents', label: 'I have dependents', help: 'Flags life and disability insurance needs' },
  { key: 'has_vehicle', label: 'I have a vehicle', help: 'Elevates auto insurance gap severity' },
  { key: 'owns_business', label: 'I own a business', help: 'Elevates business coverage gap severity' },
  { key: 'high_net_worth', label: 'High net worth', help: 'Flags umbrella and excess liability needs' },
];

export default function ProfilePage() {
  const { token, logout } = useAuth();
  const router = useRouter();

  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [contacts, setContacts] = useState<ProfileContact[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editingPersonal, setEditingPersonal] = useState(false);
  const { toast } = useToast();

  // Personal info form
  const [form, setForm] = useState({
    full_name: '',
    phone: '',
    address_street: '',
    address_city: '',
    address_state: '',
    address_zip: '',
  });

  // Contact form
  const [contactForm, setContactForm] = useState<ProfileContactCreate & { id?: number }>({
    contact_type: 'emergency',
    name: '',
    relationship: '',
    company: '',
    phone: '',
    email: '',
    notes: '',
  });
  const [showContactForm, setShowContactForm] = useState<'emergency' | 'broker' | null>(null);
  const [editingContactId, setEditingContactId] = useState<number | null>(null);

  // Change password flow
  const [showPasswordForm, setShowPasswordForm] = useState(false);
  const [pwForm, setPwForm] = useState({ current: '', newPw: '', confirm: '' });
  const [pwError, setPwError] = useState('');
  const [changingPw, setChangingPw] = useState(false);

  // Delete account flow
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deletePassword, setDeletePassword] = useState('');
  const [deleteError, setDeleteError] = useState('');
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (!token) { router.replace('/login'); return; }
    loadProfile();
  }, [token]);

  const loadProfile = async () => {
    try {
      const { profile: p, contacts: c } = await profileApi.get();
      setProfile(p);
      setContacts(c);
      setForm({
        full_name: p.full_name || '',
        phone: p.phone || '',
        address_street: p.address_street || '',
        address_city: p.address_city || '',
        address_state: p.address_state || '',
        address_zip: p.address_zip || '',
      });
    } catch (err: any) {
      if (err.status === 401) { logout(); router.replace('/login'); return; }
      toast(err.message || 'Failed to load profile', 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleSavePersonal = async () => {
    trackClick('save_profile');
    setSaving(true);
    try {
      const updated = await profileApi.update(form);
      setProfile(updated);
      setEditingPersonal(false);
      toast('Profile saved', 'success');
    } catch (err: any) {
      toast(err.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleToggleFlag = async (key: string, value: boolean) => {
    if (!profile) return;
    try {
      const updated = await profileApi.update({ [key]: value });
      setProfile(updated);
      toast('Preferences updated', 'success');
    } catch (err: any) {
      toast(err.message, 'error');
    }
  };

  const handleSaveContact = async () => {
    setSaving(true);
    try {
      if (editingContactId) {
        const { contact_type, ...rest } = contactForm;
        await profileApi.updateContact(editingContactId, rest);
      } else {
        await profileApi.createContact(contactForm as ProfileContactCreate);
      }
      await loadProfile();
      resetContactForm();
      toast(editingContactId ? 'Contact updated' : 'Contact added', 'success');
    } catch (err: any) {
      toast(err.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteContact = async (id: number) => {
    if (!confirm('Remove this contact?')) return;
    try {
      await profileApi.removeContact(id);
      setContacts(prev => prev.filter(c => c.id !== id));
      toast('Contact removed', 'success');
    } catch (err: any) {
      toast(err.message, 'error');
    }
  };

  const startEditContact = (c: ProfileContact) => {
    setEditingContactId(c.id);
    setContactForm({
      contact_type: c.contact_type,
      name: c.name,
      relationship: c.relationship || '',
      company: c.company || '',
      phone: c.phone || '',
      email: c.email || '',
      notes: c.notes || '',
    });
    setShowContactForm(c.contact_type as 'emergency' | 'broker');
  };

  const resetContactForm = () => {
    setShowContactForm(null);
    setEditingContactId(null);
    setContactForm({
      contact_type: 'emergency',
      name: '',
      relationship: '',
      company: '',
      phone: '',
      email: '',
      notes: '',
    });
  };

  const handleChangePassword = async () => {
    setPwError('');
    if (!pwForm.current.trim()) { setPwError('Current password is required'); return; }
    if (pwForm.newPw.length < 6) { setPwError('New password must be at least 6 characters'); return; }
    if (pwForm.newPw !== pwForm.confirm) { setPwError('Passwords do not match'); return; }
    trackClick('change_password');

    setChangingPw(true);
    try {
      await authApi.changePassword(pwForm.current, pwForm.newPw);
      toast('Password updated', 'success');
      setShowPasswordForm(false);
      setPwForm({ current: '', newPw: '', confirm: '' });
    } catch (err: any) {
      setPwError(err.message || 'Failed to change password');
    } finally {
      setChangingPw(false);
    }
  };

  const handleDeleteAccount = async () => {
    if (!deletePassword.trim()) { setDeleteError('Password is required'); return; }
    trackClick('delete_account');
    setDeleting(true);
    setDeleteError('');
    try {
      await authApi.deleteAccount(deletePassword);
      logout();
      router.replace('/');
    } catch (err: any) {
      setDeleteError(err.message || 'Failed to delete account');
    } finally {
      setDeleting(false);
    }
  };

  if (!token) return null;

  if (loading) {
    return (
      <div style={{ maxWidth: 720, margin: '0 auto', padding: 24 }}>
        <div style={{ height: 32, width: 200, backgroundColor: '#e5e7eb', borderRadius: 8, marginBottom: 24 }} />
        {[1, 2, 3].map(i => (
          <div key={i} className="card" style={{ padding: 24, marginBottom: 16 }}>
            <div style={{ height: 20, width: 160, backgroundColor: '#e5e7eb', borderRadius: 4, marginBottom: 12 }} />
            <div style={{ height: 16, width: '80%', backgroundColor: '#f3f4f6', borderRadius: 4 }} />
          </div>
        ))}
      </div>
    );
  }

  const emergencyContacts = contacts.filter(c => c.contact_type === 'emergency');
  const brokerContacts = contacts.filter(c => c.contact_type === 'broker');

  return (
    <div style={{ maxWidth: 720, margin: '0 auto', padding: 24 }}>
      <BackButton href="/" label="Profile" parentLabel="Home" />
      <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 4 }}>Your Profile</h1>
      <p style={{ fontSize: 14, color: 'var(--color-text-secondary)', marginBottom: 24 }}>
        Your personal info helps pre-fill forms and powers smarter coverage recommendations.
      </p>

      {/* 1. Personal Information */}
      <div className="card" style={{ padding: 0, marginBottom: 20, overflow: 'hidden' }}>
        <div style={{
          padding: '16px 20px',
          borderBottom: '1px solid var(--color-border)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: 8,
        }}>
          <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>Personal Information</h2>
          {!editingPersonal ? (
            <button
              onClick={() => { trackClick('profile_edit_personal'); setEditingPersonal(true); }}
              className="btn btn-outline"
              style={{ padding: '6px 14px', fontSize: 13 }}
            >
              Edit
            </button>
          ) : (
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                onClick={handleSavePersonal}
                disabled={saving}
                className="btn btn-primary"
                style={{ padding: '6px 14px', fontSize: 13 }}
              >
                {saving ? 'Saving...' : 'Save'}
              </button>
              <button
                onClick={() => {
                  trackClick('profile_cancel_personal');
                  setEditingPersonal(false);
                  setForm({
                    full_name: profile?.full_name || '',
                    phone: profile?.phone || '',
                    address_street: profile?.address_street || '',
                    address_city: profile?.address_city || '',
                    address_state: profile?.address_state || '',
                    address_zip: profile?.address_zip || '',
                  });
                }}
                className="btn btn-outline"
                style={{ padding: '6px 14px', fontSize: 13 }}
              >
                Cancel
              </button>
            </div>
          )}
        </div>

        <div style={{ padding: 20 }}>
          {editingPersonal ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <FormField label="Full Name" value={form.full_name} onChange={v => setForm({ ...form, full_name: v })} placeholder="John Smith" />
              <FormField label="Phone" value={form.phone} onChange={v => setForm({ ...form, phone: v })} placeholder="(555) 123-4567" type="tel" />
              <FormField label="Street Address" value={form.address_street} onChange={v => setForm({ ...form, address_street: v })} placeholder="123 Main St" />
              <div className="mobile-grid-1" style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: 12 }}>
                <FormField label="City" value={form.address_city} onChange={v => setForm({ ...form, address_city: v })} placeholder="Springfield" />
                <FormField label="State" value={form.address_state} onChange={v => setForm({ ...form, address_state: v })} placeholder="IL" />
                <FormField label="ZIP" value={form.address_zip} onChange={v => setForm({ ...form, address_zip: v })} placeholder="62701" />
              </div>
            </div>
          ) : (
            <div className="form-grid-2" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <InfoField label="Full Name" value={profile?.full_name} />
              <InfoField label="Phone" value={profile?.phone ? formatPhone(profile.phone) : undefined} />
              <InfoField label="Address" value={[profile?.address_street, [profile?.address_city, profile?.address_state, profile?.address_zip].filter(Boolean).join(' ')].filter(Boolean).join(', ') || undefined} span={2} />
            </div>
          )}
        </div>
      </div>

      {/* 2. Emergency Contacts */}
      <div className="card" style={{ padding: 0, marginBottom: 20, overflow: 'hidden' }}>
        <div style={{
          padding: '16px 20px',
          borderBottom: '1px solid var(--color-border)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: 8,
        }}>
          <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>Emergency Contacts</h2>
          <button
            onClick={() => {
              trackClick('profile_add_emergency_contact');
              resetContactForm();
              setContactForm(prev => ({ ...prev, contact_type: 'emergency' }));
              setShowContactForm('emergency');
            }}
            className="btn btn-outline"
            style={{ padding: '6px 14px', fontSize: 13 }}
          >
            + Add
          </button>
        </div>

        <div style={{ padding: 20 }}>
          {emergencyContacts.length === 0 && showContactForm !== 'emergency' && (
            <p style={{ fontSize: 14, color: 'var(--color-text-muted)', textAlign: 'center', padding: '12px 0' }}>
              No emergency contacts yet. Add one so it can pre-fill your ICE card.
            </p>
          )}

          {emergencyContacts.map(c => (
            <ContactCard
              key={c.id}
              contact={c}
              onEdit={() => startEditContact(c)}
              onDelete={() => handleDeleteContact(c.id)}
            />
          ))}

          {showContactForm === 'emergency' && (
            <ContactFormCard
              form={contactForm}
              setForm={setContactForm}
              type="emergency"
              saving={saving}
              isEditing={!!editingContactId}
              onSave={handleSaveContact}
              onCancel={resetContactForm}
            />
          )}
        </div>
      </div>

      {/* 3. Insurance Brokers */}
      <div className="card" style={{ padding: 0, marginBottom: 20, overflow: 'hidden' }}>
        <div style={{
          padding: '16px 20px',
          borderBottom: '1px solid var(--color-border)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: 8,
        }}>
          <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>Insurance Brokers</h2>
          <button
            onClick={() => {
              trackClick('profile_add_broker');
              resetContactForm();
              setContactForm(prev => ({ ...prev, contact_type: 'broker' }));
              setShowContactForm('broker');
            }}
            className="btn btn-outline"
            style={{ padding: '6px 14px', fontSize: 13 }}
          >
            + Add
          </button>
        </div>

        <div style={{ padding: 20 }}>
          {brokerContacts.length === 0 && showContactForm !== 'broker' && (
            <p style={{ fontSize: 14, color: 'var(--color-text-muted)', textAlign: 'center', padding: '12px 0' }}>
              No brokers yet. Add your insurance broker or agent for quick reference.
            </p>
          )}

          {brokerContacts.map(c => (
            <ContactCard
              key={c.id}
              contact={c}
              onEdit={() => startEditContact(c)}
              onDelete={() => handleDeleteContact(c.id)}
            />
          ))}

          {showContactForm === 'broker' && (
            <ContactFormCard
              form={contactForm}
              setForm={setContactForm}
              type="broker"
              saving={saving}
              isEditing={!!editingContactId}
              onSave={handleSaveContact}
              onCancel={resetContactForm}
            />
          )}
        </div>
      </div>

      {/* 4. Coverage Context */}
      <div className="card" style={{ padding: 0, marginBottom: 20, overflow: 'hidden' }}>
        <div style={{
          padding: '16px 20px',
          borderBottom: '1px solid var(--color-border)',
        }}>
          <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>Coverage Context</h2>
          <p style={{ margin: '6px 0 0', fontSize: 13, color: 'var(--color-text-secondary)' }}>
            These help Covrabl identify coverage gaps relevant to you.
          </p>
        </div>

        <div style={{ padding: 20 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {CONTEXT_FLAGS.map(flag => (
              <label
                key={flag.key}
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: 12,
                  padding: '10px 14px',
                  borderRadius: 8,
                  backgroundColor: profile?.[flag.key] ? '#f0fdf4' : 'transparent',
                  border: `1px solid ${profile?.[flag.key] ? '#bbf7d0' : 'var(--color-border)'}`,
                  cursor: 'pointer',
                  transition: 'all 0.15s',
                }}
              >
                <input
                  type="checkbox"
                  checked={!!profile?.[flag.key]}
                  onChange={e => handleToggleFlag(flag.key, e.target.checked)}
                  style={{ marginTop: 2, width: 18, height: 18, accentColor: '#22c55e', flexShrink: 0 }}
                />
                <div>
                  <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--color-text)' }}>{flag.label}</div>
                  <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 2 }}>{flag.help}</div>
                </div>
              </label>
            ))}
          </div>
        </div>
      </div>

      {/* 5. Change Password */}
      <div className="card" style={{ padding: 0, marginBottom: 20, overflow: 'hidden' }}>
        <div style={{
          padding: '16px 20px',
          borderBottom: '1px solid var(--color-border)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: 8,
        }}>
          <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>Change Password</h2>
          {!showPasswordForm && (
            <button
              onClick={() => { trackClick('profile_change_password'); setShowPasswordForm(true); setPwForm({ current: '', newPw: '', confirm: '' }); setPwError(''); }}
              className="btn btn-outline"
              style={{ padding: '6px 14px', fontSize: 13 }}
            >
              Change
            </button>
          )}
        </div>

        <div style={{ padding: 20 }}>
          {!showPasswordForm ? (
            <p style={{ fontSize: 14, color: 'var(--color-text-secondary)', margin: 0 }}>
              Update your login password. You&apos;ll need to enter your current password to verify your identity.
            </p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <FormField label="Current Password" value={pwForm.current} onChange={v => { setPwForm(p => ({ ...p, current: v })); setPwError(''); }} placeholder="Enter current password" type="password" />
              <FormField label="New Password" value={pwForm.newPw} onChange={v => { setPwForm(p => ({ ...p, newPw: v })); setPwError(''); }} placeholder="At least 6 characters" type="password" />
              <FormField label="Confirm New Password" value={pwForm.confirm} onChange={v => { setPwForm(p => ({ ...p, confirm: v })); setPwError(''); }} placeholder="Re-enter new password" type="password" />
              {pwError && (
                <p style={{ fontSize: 13, color: '#dc2626', margin: 0 }}>{pwError}</p>
              )}
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  onClick={handleChangePassword}
                  disabled={changingPw}
                  className="btn btn-primary"
                  style={{ padding: '8px 16px', fontSize: 13 }}
                >
                  {changingPw ? 'Updating...' : 'Update Password'}
                </button>
                <button
                  onClick={() => { trackClick('profile_cancel_password'); setShowPasswordForm(false); setPwError(''); }}
                  className="btn btn-outline"
                  style={{ padding: '8px 16px', fontSize: 13 }}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* 6. Danger Zone */}
      <div style={{
        padding: 0, marginBottom: 20, overflow: 'hidden',
        border: '1px solid #fca5a5', borderRadius: 'var(--radius-lg)',
        backgroundColor: '#fff',
      }}>
        <div style={{
          padding: '16px 20px',
          borderBottom: '1px solid #fca5a5',
          backgroundColor: '#fef2f2',
        }}>
          <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: '#991b1b' }}>Danger Zone</h2>
        </div>

        <div style={{ padding: 20 }}>
          <p style={{ fontSize: 14, color: 'var(--color-text-secondary)', margin: '0 0 16px', lineHeight: 1.6 }}>
            Permanently delete your account and all associated data. This action is irreversible.
            If you have data you want to keep, export it first.
          </p>
          <button
            onClick={() => { trackClick('profile_delete_account_open'); setShowDeleteModal(true); setDeletePassword(''); setDeleteError(''); }}
            style={{
              padding: '8px 20px', fontSize: 14, fontWeight: 600,
              backgroundColor: '#fff', color: '#dc2626',
              border: '1px solid #dc2626', borderRadius: 'var(--radius-md)',
              cursor: 'pointer',
            }}
          >
            Delete Account
          </button>
        </div>
      </div>

      {/* Delete Account Confirmation Modal */}
      {showDeleteModal && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          backgroundColor: 'rgba(0,0,0,0.5)', zIndex: 1000,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          padding: 24,
        }}>
          <div style={{
            backgroundColor: '#fff', borderRadius: 'var(--radius-lg)',
            padding: 28, maxWidth: 440, width: '100%',
            boxShadow: '0 20px 60px rgba(0,0,0,0.2)',
          }}>
            <h3 style={{ margin: '0 0 8px', fontSize: 18, fontWeight: 700, color: '#991b1b' }}>
              Delete your account?
            </h3>
            <p style={{ fontSize: 14, color: 'var(--color-text-secondary)', margin: '0 0 20px', lineHeight: 1.6 }}>
              This will permanently delete your account, all policies, documents, and personal data. This cannot be undone.
            </p>
            <label style={{ display: 'block', fontSize: 13, fontWeight: 500, marginBottom: 6, color: 'var(--color-text-secondary)' }}>
              Enter your password to confirm
            </label>
            <input
              type="password"
              value={deletePassword}
              onChange={e => { setDeletePassword(e.target.value); setDeleteError(''); }}
              placeholder="Your password"
              className="form-input"
              style={{ width: '100%', marginBottom: deleteError ? 8 : 20 }}
              autoFocus
              onKeyDown={e => { if (e.key === 'Enter') handleDeleteAccount(); }}
            />
            {deleteError && (
              <p style={{ fontSize: 13, color: '#dc2626', margin: '0 0 16px' }}>{deleteError}</p>
            )}
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button
                onClick={() => { trackClick('profile_delete_account_cancel'); setShowDeleteModal(false); }}
                className="btn btn-outline"
                style={{ padding: '8px 20px', fontSize: 14 }}
                disabled={deleting}
              >
                Cancel
              </button>
              <button
                onClick={handleDeleteAccount}
                disabled={deleting || !deletePassword.trim()}
                style={{
                  padding: '8px 20px', fontSize: 14, fontWeight: 600,
                  backgroundColor: '#dc2626', color: '#fff',
                  border: 'none', borderRadius: 'var(--radius-md)',
                  cursor: deleting || !deletePassword.trim() ? 'not-allowed' : 'pointer',
                  opacity: deleting || !deletePassword.trim() ? 0.5 : 1,
                }}
              >
                {deleting ? 'Deleting...' : 'Permanently Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function FormField({ label, value, onChange, placeholder, type = 'text' }: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string; type?: string;
}) {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (type === 'tel') {
      onChange(formatPhone(e.target.value));
    } else {
      onChange(e.target.value);
    }
  };

  return (
    <div>
      <label style={{ display: 'block', fontSize: 13, fontWeight: 500, marginBottom: 4, color: 'var(--color-text-secondary)' }}>{label}</label>
      <input
        type={type}
        value={type === 'tel' ? formatPhone(value) : value}
        onChange={handleChange}
        placeholder={placeholder}
        className="form-input"
        style={{ width: '100%' }}
      />
    </div>
  );
}

function InfoField({ label, value, span }: { label: string; value?: string | null; span?: number }) {
  return (
    <div style={span ? { gridColumn: `span ${span}` } : undefined}>
      <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 14, color: value ? 'var(--color-text)' : 'var(--color-text-muted)', fontStyle: value ? 'normal' : 'italic' }}>
        {value || 'Not set'}
      </div>
    </div>
  );
}

function ContactCard({ contact, onEdit, onDelete }: {
  contact: ProfileContact; onEdit: () => void; onDelete: () => void;
}) {
  return (
    <div style={{
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      padding: '12px 14px',
      backgroundColor: 'var(--color-bg)',
      borderRadius: 8,
      marginBottom: 8,
      border: '1px solid var(--color-border)',
      flexWrap: 'wrap',
      gap: 8,
    }}>
      <div>
        <div style={{ fontSize: 14, fontWeight: 600 }}>{contact.name}</div>
        <div style={{ fontSize: 12, color: 'var(--color-text-secondary)', marginTop: 2 }}>
          {contact.contact_type === 'emergency' && contact.relationship && <span>{contact.relationship} &middot; </span>}
          {contact.contact_type === 'broker' && contact.company && <span>{contact.company} &middot; </span>}
          {contact.phone && <span>{formatPhone(contact.phone)}</span>}
          {contact.phone && contact.email && <span> &middot; </span>}
          {contact.email && <span>{contact.email}</span>}
        </div>
        {contact.notes && (
          <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 4, fontStyle: 'italic' }}>{contact.notes}</div>
        )}
      </div>
      <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
        <button onClick={() => { trackClick('profile_edit_contact'); onEdit(); }} aria-label="Edit contact" style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 16, padding: 4 }} title="Edit">
          &#9998;
        </button>
        <button onClick={() => { trackClick('profile_delete_contact'); onDelete(); }} aria-label="Delete contact" style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 16, padding: 4, color: 'var(--color-danger)' }} title="Delete">
          &times;
        </button>
      </div>
    </div>
  );
}

function ContactFormCard({ form, setForm, type, saving, isEditing, onSave, onCancel }: {
  form: ProfileContactCreate & { id?: number };
  setForm: (fn: (prev: any) => any) => void;
  type: 'emergency' | 'broker';
  saving: boolean;
  isEditing: boolean;
  onSave: () => void;
  onCancel: () => void;
}) {
  return (
    <div style={{
      padding: 16,
      backgroundColor: '#f9fafb',
      borderRadius: 8,
      border: '1px solid var(--color-border)',
      marginTop: 8,
    }}>
      <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>
        {isEditing ? 'Edit' : 'Add'} {type === 'emergency' ? 'Emergency Contact' : 'Insurance Broker'}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <FormField label="Name" value={form.name} onChange={v => setForm((prev: any) => ({ ...prev, name: v }))} placeholder={type === 'emergency' ? 'Jane Smith' : 'John Broker'} />
        {type === 'emergency' && (
          <FormField label="Relationship" value={form.relationship || ''} onChange={v => setForm((prev: any) => ({ ...prev, relationship: v }))} placeholder="Spouse, Parent, Sibling..." />
        )}
        {type === 'broker' && (
          <FormField label="Company" value={form.company || ''} onChange={v => setForm((prev: any) => ({ ...prev, company: v }))} placeholder="ABC Insurance Agency" />
        )}
        <div className="form-grid-2" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <FormField label="Phone" value={form.phone || ''} onChange={v => setForm((prev: any) => ({ ...prev, phone: v }))} placeholder="(555) 123-4567" type="tel" />
          <FormField label="Email" value={form.email || ''} onChange={v => setForm((prev: any) => ({ ...prev, email: v }))} placeholder="email@example.com" type="email" />
        </div>
        {type === 'broker' && (
          <FormField label="Notes" value={form.notes || ''} onChange={v => setForm((prev: any) => ({ ...prev, notes: v }))} placeholder="Handles my auto and home policies" />
        )}
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
        <button
          onClick={onSave}
          disabled={!form.name.trim() || saving}
          className="btn btn-primary"
          style={{ padding: '8px 16px', fontSize: 13 }}
        >
          {saving ? 'Saving...' : isEditing ? 'Update' : 'Add'}
        </button>
        <button onClick={onCancel} className="btn btn-outline" style={{ padding: '8px 16px', fontSize: 13 }}>
          Cancel
        </button>
      </div>
    </div>
  );
}
