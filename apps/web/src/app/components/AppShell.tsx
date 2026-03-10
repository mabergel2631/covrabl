'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useAuth } from '../../../lib/auth';
import { fetchActiveAnnouncements, checkFeatureAccess } from '../../../lib/api';
import { trackPageView, trackClick } from '../../../lib/track';
import { APP_NAME, APP_SIDEBAR_TAGLINE } from '../config';
import Logo from './Logo';
import BrokerPrompt from './BrokerPrompt';

type NavItem = { href: string; label: string; icon: string; urgent?: boolean; feature?: string };
type NavSection = { label: string; items: NavItem[] };

const NAV_SECTIONS: NavSection[] = [
  {
    label: 'MAIN',
    items: [
      { href: '/', label: 'Dashboard', icon: '🏠' },
      { href: '/policies', label: 'Policies', icon: '📋' },
      { href: '/certificates', label: 'Compliance', icon: '📜', feature: 'certificates' },
      { href: '/emergency', label: 'Emergency', icon: '🚨', urgent: true },
    ],
  },
  {
    label: 'INTELLIGENCE',
    items: [
      { href: '/score', label: 'Coverage Status', icon: '📊' },
      { href: '/chat', label: 'Insights', icon: '💬' },
      { href: '/audit', label: 'Alerts', icon: '🔔' },
      { href: '/renewals', label: 'Renewals', icon: '🔄', feature: 'deltas' },
      { href: '/policies/compare', label: 'Compare', icon: '⚖️' },
    ],
  },
  {
    label: 'ACCOUNT',
    items: [
      { href: '/profile', label: 'Profile', icon: '👤' },
      { href: '/billing', label: 'Billing', icon: '💳' },
      { href: '/privacy', label: 'Privacy', icon: '🔒' },
    ],
  },
];

export default function AppShell({ children }: { children: React.ReactNode }) {
  const { token, role, plan, trialActive, trialDaysLeft, logout } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [announcements, setAnnouncements] = useState<{ id: number; title: string; message: string; type: string }[]>([]);
  const [dismissedIds, setDismissedIds] = useState<Set<number>>(new Set());

  useEffect(() => {
    fetchActiveAnnouncements()
      .then(setAnnouncements)
      .catch(() => {});
  }, []);

  // Global page view tracking
  useEffect(() => {
    if (token) trackPageView(pathname);
  }, [pathname, token]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Ctrl/Cmd+K → focus search on policies page
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        const searchInput = document.querySelector<HTMLInputElement>('input[placeholder*="Search"]');
        if (searchInput) searchInput.focus();
        else router.push('/policies');
      }
      // Escape → close sidebar
      if (e.key === 'Escape' && sidebarOpen) {
        setSidebarOpen(false);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [sidebarOpen, router]);

  // Public routes should never show the authenticated shell (even if user is logged in)
  const isPublicLeaseRoute = pathname.startsWith('/lease-compliance/') && pathname !== '/lease-compliance';
  const [isPublicOverride, setIsPublicOverride] = useState(false);
  useEffect(() => {
    if (pathname === '/' && typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      setIsPublicOverride(params.get('ref') === 'tenant' || params.get('preview') === '1');
    } else {
      setIsPublicOverride(false);
    }
  }, [pathname]);
  if (!token || isPublicLeaseRoute || isPublicOverride) return <>{children}</>;

  return (
    <div style={{ display: 'flex', minHeight: '100vh' }}>
      {/* Mobile overlay */}
      {sidebarOpen && (
        <div
          className="sidebar-overlay"
          style={{ display: 'none', position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.4)', zIndex: 899 }}
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={`sidebar${sidebarOpen ? ' open' : ''}`}
        style={{
          width: 220,
          backgroundColor: 'var(--color-primary-dark)',
          color: '#fff',
          display: 'flex',
          flexDirection: 'column',
          position: 'sticky',
          top: 0,
          height: '100vh',
          flexShrink: 0,
        }}
      >
        <div style={{ padding: '20px 20px 16px', borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
          <button
            onClick={() => router.push('/')}
            aria-label="Go to dashboard"
            style={{ cursor: 'pointer', background: 'none', border: 'none', color: 'inherit', textAlign: 'left', width: '100%', padding: 0 }}
          >
            <Logo size="md" variant="light" />
            <div style={{ fontSize: 11, opacity: 0.6, marginTop: 4 }}>{APP_SIDEBAR_TAGLINE}</div>
          </button>
          <button
            onClick={() => window.open('/?preview=1', '_blank')}
            style={{ marginTop: 8, background: 'none', border: 'none', color: 'rgba(255,255,255,0.4)', fontSize: 11, cursor: 'pointer', padding: 0, textDecoration: 'underline' }}
          >
            Visit site &#8599;
          </button>
        </div>

        <nav style={{ flex: 1, padding: '12px 8px', overflowY: 'auto' }}>
          {(() => {
            // Build sections with role-based items appended to MAIN
            const sections = NAV_SECTIONS.map(s => ({ ...s, items: [...s.items] }));
            if (role === 'agent') sections[0].items.push({ href: '/agent', label: 'My Clients', icon: '👥' });
            if (role === 'admin') sections[0].items.push({ href: '/admin', label: 'Admin', icon: '⚙️' });

            return sections.map((section, si) => (
              <div key={section.label} style={{ marginBottom: si < sections.length - 1 ? 8 : 0, ...(section.label === 'ACCOUNT' ? { borderTop: '1px solid rgba(255,255,255,0.1)', paddingTop: 8, marginTop: 4 } : {}) }}>
                <div style={{ padding: '6px 12px 4px', fontSize: 10, fontWeight: 700, color: 'rgba(255,255,255,0.4)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
                  {section.label}
                </div>
                {section.items.map(item => {
                  const isHome = item.href === '/';
                  const active = pathname === item.href || (!isHome && item.href !== '/policies' && pathname.startsWith(item.href));
                  const isPolActive = item.href === '/policies' && (pathname === '/policies' || (pathname.startsWith('/policies/') && !pathname.startsWith('/policies/compare')));
                  const isActive = active || isPolActive;
                  const isUrgent = item.urgent;
                  const isLocked = item.feature ? !checkFeatureAccess(plan || 'free', item.feature).allowed : false;
                  return (
                    <button
                      key={item.href}
                      onClick={() => { trackClick('nav', { target: item.href }); router.push(item.href); setSidebarOpen(false); }}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 10,
                        width: '100%',
                        padding: '10px 12px',
                        border: isUrgent && !isActive ? '1px solid rgba(239,68,68,0.4)' : 'none',
                        borderRadius: 'var(--radius-md)',
                        backgroundColor: isActive ? 'rgba(255,255,255,0.12)' : isUrgent ? 'rgba(239,68,68,0.1)' : 'transparent',
                        color: isLocked ? 'rgba(255,255,255,0.45)' : isUrgent ? '#fca5a5' : '#fff',
                        fontSize: 14,
                        fontWeight: isActive ? 600 : isUrgent ? 600 : 400,
                        cursor: 'pointer',
                        textAlign: 'left',
                        marginBottom: 2,
                      }}
                    >
                      <span style={{ fontSize: 16 }}>{item.icon}</span>
                      {item.label}
                      {isLocked && <span style={{ marginLeft: 'auto', fontSize: 11, opacity: 0.6 }}>&#128274;</span>}
                    </button>
                  );
                })}
              </div>
            ));
          })()}
        </nav>

        <div style={{ padding: '12px 8px', borderTop: '1px solid rgba(255,255,255,0.1)' }}>
          {trialActive && trialDaysLeft <= 10 && (
            <button
              onClick={() => router.push('/pricing')}
              style={{
                display: 'block',
                width: '100%',
                padding: '8px 12px',
                marginBottom: 6,
                border: '1px solid rgba(63, 167, 163, 0.4)',
                borderRadius: 'var(--radius-md)',
                backgroundColor: 'rgba(63, 167, 163, 0.15)',
                color: '#5fbfbc',
                fontSize: 12,
                fontWeight: 600,
                cursor: 'pointer',
                textAlign: 'center',
              }}
            >
              {trialDaysLeft} days left in trial
            </button>
          )}
          <button
            onClick={() => { logout(); router.replace('/'); }}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              width: '100%',
              padding: '10px 12px',
              border: 'none',
              borderRadius: 'var(--radius-md)',
              backgroundColor: 'transparent',
              color: 'rgba(255,255,255,0.7)',
              fontSize: 14,
              cursor: 'pointer',
              textAlign: 'left',
            }}
          >
            Sign Out
          </button>
        </div>
      </aside>

      {/* Main content */}
      <div className="main-content" style={{ flex: 1, minWidth: 0, overflowX: 'hidden' }}>
        {/* Mobile header bar */}
        <div className="mobile-header" style={{
          display: 'none',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '12px 16px',
          backgroundColor: 'var(--color-primary-dark)',
          color: '#fff',
          position: 'sticky',
          top: 0,
          zIndex: 101,
        }}>
          <button
            onClick={() => setSidebarOpen(!sidebarOpen)}
            aria-label={sidebarOpen ? 'Close navigation menu' : 'Open navigation menu'}
            style={{ background: 'none', border: 'none', color: '#fff', fontSize: 22, cursor: 'pointer', padding: 0 }}
          >
            ☰
          </button>
          <Logo size="sm" variant="light" />
          <button
            onClick={() => { logout(); router.replace('/'); }}
            aria-label="Sign out"
            style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.8)', fontSize: 13, cursor: 'pointer', padding: 0 }}
          >
            Sign Out
          </button>
        </div>
        {/* Top bar with sign out */}
        <div className="desktop-topbar" style={{
          display: 'flex',
          justifyContent: 'flex-end',
          alignItems: 'center',
          padding: '10px 24px',
          borderBottom: '1px solid var(--color-border)',
          backgroundColor: 'var(--color-surface)',
        }}>
          <button
            onClick={() => { logout(); router.replace('/'); }}
            style={{
              background: 'none',
              border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius-md)',
              color: 'var(--color-text-secondary)',
              fontSize: 13,
              fontWeight: 500,
              cursor: 'pointer',
              padding: '6px 14px',
            }}
          >
            Sign Out
          </button>
        </div>
        {/* Announcement Banners */}
        {announcements
          .filter(a => !dismissedIds.has(a.id))
          .map(a => {
            const colors: Record<string, { bg: string; border: string; text: string }> = {
              info: { bg: 'rgba(59,130,246,0.08)', border: 'rgba(59,130,246,0.3)', text: 'var(--color-info)' },
              warning: { bg: 'rgba(217,119,6,0.08)', border: 'rgba(217,119,6,0.3)', text: 'var(--color-warning)' },
              maintenance: { bg: 'rgba(220,38,38,0.08)', border: 'rgba(220,38,38,0.3)', text: 'var(--color-danger)' },
            };
            const c = colors[a.type] || colors.info;
            return (
              <div key={a.id} style={{
                padding: '10px 20px',
                backgroundColor: c.bg,
                borderBottom: `1px solid ${c.border}`,
                display: 'flex',
                alignItems: 'center',
                gap: 12,
              }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: c.text }}>{a.title}</span>
                <span style={{ fontSize: 13, color: 'var(--color-text-secondary)', flex: 1 }}>{a.message}</span>
                <button
                  onClick={() => setDismissedIds(prev => new Set(prev).add(a.id))}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: 'var(--color-text-muted)',
                    fontSize: 16,
                    cursor: 'pointer',
                    padding: '2px 6px',
                    lineHeight: 1,
                  }}
                  aria-label="Dismiss announcement"
                >
                  ×
                </button>
              </div>
            );
          })}
        {children}
        <BrokerPrompt />

        {/* Trust Footer */}
        <div style={{
          padding: '16px 24px', marginTop: 40,
          borderTop: '1px solid var(--color-border)',
          display: 'flex', justifyContent: 'center', gap: 20,
          fontSize: 11, color: 'var(--color-text-muted)',
        }}>
          <span>&#128274; Encrypted Storage</span>
          <span>&#128737;&#65039; Private Vault</span>
          <span onClick={() => router.push('/security')} style={{ cursor: 'pointer', color: 'var(--color-text-muted)' }}>Security &amp; Privacy</span>
        </div>
      </div>

      {/* Floating SOS Button — hidden on emergency and chat pages */}
      {!pathname.startsWith('/emergency') && !pathname.startsWith('/chat') && (
        <button
          onClick={() => router.push('/emergency')}
          aria-label="Emergency access"
          style={{
            position: 'fixed',
            bottom: 24,
            right: 24,
            width: 64,
            height: 64,
            borderRadius: '50%',
            backgroundColor: 'var(--color-danger)',
            color: '#fff',
            border: '3px solid rgba(255,255,255,0.9)',
            fontSize: 16,
            fontWeight: 700,
            cursor: 'pointer',
            boxShadow: '0 4px 20px rgba(220, 38, 38, 0.5)',
            zIndex: 1000,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            transition: 'transform 0.15s, box-shadow 0.15s',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.transform = 'scale(1.1)';
            e.currentTarget.style.boxShadow = '0 6px 20px rgba(220, 38, 38, 0.5)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.transform = 'scale(1)';
            e.currentTarget.style.boxShadow = '0 4px 14px rgba(220, 38, 38, 0.4)';
          }}
          title="Emergency Access"
        >
          SOS
        </button>
      )}
    </div>
  );
}
