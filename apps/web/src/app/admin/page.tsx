'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '../../../lib/auth';
import BackButton from '../components/BackButton';
import AdminOverviewTab from './AdminOverviewTab';
import AdminUsersTab from './AdminUsersTab';
import AdminActivityTab from './AdminActivityTab';
import AdminEmailsTab from './AdminEmailsTab';
import AdminDraftsTab from './AdminDraftsTab';
import AdminAnnouncementsTab from './AdminAnnouncementsTab';

const TABS = [
  { key: 'overview', label: 'Overview', icon: '📊' },
  { key: 'users', label: 'Users', icon: '👥' },
  { key: 'activity', label: 'Activity', icon: '📋' },
  { key: 'emails', label: 'Emails', icon: '📧' },
  { key: 'drafts', label: 'Drafts', icon: '📝' },
  { key: 'announcements', label: 'Announcements', icon: '📢' },
] as const;

type TabKey = (typeof TABS)[number]['key'];

export default function AdminDashboard() {
  const { token, role } = useAuth();
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<TabKey>('overview');
  const [authChecked, setAuthChecked] = useState(false);

  useEffect(() => {
    if (!token) { router.replace('/login'); return; }
    if (role && role !== 'admin') { router.replace('/policies'); return; }
    setAuthChecked(true);
  }, [token, role, router]);

  if (!token || !authChecked) {
    return (
      <div style={{ padding: 40, textAlign: 'center', color: 'var(--color-text-muted)' }}>
        Loading...
      </div>
    );
  }

  return (
    <div style={{ padding: '32px 24px', maxWidth: 1100, margin: '0 auto' }}>
      <BackButton href="/" label="Admin" parentLabel="Home" />
      <h1 style={{ fontSize: 24, fontWeight: 700, margin: '0 0 8px', color: 'var(--color-text)' }}>
        Admin Dashboard
      </h1>
      <p style={{ fontSize: 14, color: 'var(--color-text-secondary)', margin: '0 0 24px' }}>
        Platform overview and management console.
      </p>

      {/* Tab Bar */}
      <div style={{
        display: 'flex',
        gap: 0,
        borderBottom: '2px solid var(--color-border)',
        marginBottom: 28,
        overflowX: 'auto',
      }}>
        {TABS.map(tab => {
          const isActive = activeTab === tab.key;
          return (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: '10px 18px',
                border: 'none',
                borderBottom: isActive ? '2px solid var(--color-primary)' : '2px solid transparent',
                marginBottom: -2,
                backgroundColor: 'transparent',
                color: isActive ? 'var(--color-primary)' : 'var(--color-text-secondary)',
                fontSize: 14,
                fontWeight: isActive ? 600 : 400,
                cursor: 'pointer',
                whiteSpace: 'nowrap',
                transition: 'color 0.15s, border-color 0.15s',
              }}
            >
              <span style={{ fontSize: 15 }}>{tab.icon}</span>
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Tab Content */}
      {activeTab === 'overview' && <AdminOverviewTab />}
      {activeTab === 'users' && <AdminUsersTab />}
      {activeTab === 'activity' && <AdminActivityTab />}
      {activeTab === 'emails' && <AdminEmailsTab />}
      {activeTab === 'drafts' && <AdminDraftsTab />}
      {activeTab === 'announcements' && <AdminAnnouncementsTab />}
    </div>
  );
}
