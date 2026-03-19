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
    <>
      <style>{`
        .admin-dashboard { padding: 32px 24px; max-width: 1100px; margin: 0 auto; }
        .admin-tab-bar {
          display: flex; flex-wrap: wrap; gap: 4px;
          border-bottom: 2px solid var(--color-border);
          margin-bottom: 28px;
        }
        .admin-tab-btn {
          display: flex; align-items: center; gap: 6px;
          padding: 10px 18px; border: none;
          margin-bottom: -2px; background-color: transparent;
          font-size: 14px; cursor: pointer; white-space: nowrap;
          transition: color 0.15s, border-color 0.15s;
          min-width: 0;
        }
        .admin-content { overflow-x: auto; }
        @media (max-width: 768px) {
          .admin-dashboard { padding: 20px 12px; }
          .admin-tab-bar { gap: 2px; }
          .admin-tab-btn { padding: 8px 10px; font-size: 13px; }
          .admin-tab-btn .tab-icon { display: none; }
        }
        @media (max-width: 480px) {
          .admin-dashboard { padding: 16px 8px; }
          .admin-tab-btn { padding: 7px 8px; font-size: 12px; }
        }
      `}</style>
      <div className="admin-dashboard">
        <BackButton href="/" label="Admin" parentLabel="Home" />
        <h1 style={{ fontSize: 24, fontWeight: 700, margin: '0 0 8px', color: 'var(--color-text)' }}>
          Admin Dashboard
        </h1>
        <p style={{ fontSize: 14, color: 'var(--color-text-secondary)', margin: '0 0 24px' }}>
          Platform overview and management console.
        </p>

        {/* Tab Bar */}
        <div className="admin-tab-bar">
          {TABS.map(tab => {
            const isActive = activeTab === tab.key;
            return (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className="admin-tab-btn"
                style={{
                  borderBottom: isActive ? '2px solid var(--color-primary)' : '2px solid transparent',
                  color: isActive ? 'var(--color-primary)' : 'var(--color-text-secondary)',
                  fontWeight: isActive ? 600 : 400,
                }}
              >
                <span className="tab-icon" style={{ fontSize: 15 }}>{tab.icon}</span>
                {tab.label}
              </button>
            );
          })}
        </div>

        {/* Tab Content */}
        <div className="admin-content">
          {activeTab === 'overview' && <AdminOverviewTab />}
          {activeTab === 'users' && <AdminUsersTab />}
          {activeTab === 'activity' && <AdminActivityTab />}
          {activeTab === 'emails' && <AdminEmailsTab />}
          {activeTab === 'drafts' && <AdminDraftsTab />}
          {activeTab === 'announcements' && <AdminAnnouncementsTab />}
        </div>
      </div>
    </>
  );
}
