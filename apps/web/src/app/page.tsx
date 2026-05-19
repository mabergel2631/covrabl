'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '../../lib/auth';
import { scoresApi, deltasApi, renewalsApi, policiesApi, CoverageScoresResult, DeltaListResponse, RenewalSummaryResult, Policy } from '../../lib/api';
import { APP_NAME, APP_TAGLINE, APP_CONTACT_EMAIL, ANNOUNCEMENT_BAR } from './config';
import { POLICY_TYPE_CONFIG } from './constants';
import Logo from './components/Logo';
import { trackClick, trackPageView } from '../../lib/track';

/* ── Scroll-reveal hook ─────────────────────────────── */
function useScrollReveal() {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.classList.add('scroll-hidden');

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          el.classList.remove('scroll-hidden');
          el.classList.add('scroll-reveal');
          observer.unobserve(el);
        }
      },
      { threshold: 0.12 },
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return ref;
}

/* ── Authenticated Dashboard (consumer view — logged-in users) ────── */
function Dashboard() {
  const router = useRouter();
  const [scores, setScores] = useState<CoverageScoresResult | null>(null);
  const [alerts, setAlerts] = useState<DeltaListResponse | null>(null);
  const [renewals, setRenewals] = useState<RenewalSummaryResult | null>(null);
  const [policies, setPolicies] = useState<Policy[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      scoresApi.get().catch(() => null),
      deltasApi.list({ acknowledged: false, limit: 3 }).catch(() => null),
      renewalsApi.summary().catch(() => null),
      policiesApi.list().catch(() => []),
    ]).then(([s, a, r, p]) => {
      setScores(s);
      setAlerts(a);
      setRenewals(r);
      setPolicies(p as Policy[]);
      setLoading(false);
    });
  }, []);

  const unackCount = alerts?.unacknowledged_count ?? 0;
  const activeCount = policies.filter(p => p.status !== 'archived').length;
  const activePolicies = policies.filter(p => p.status !== 'archived' && p.status !== 'expired');

  // Status based on real issues (alerts + renewals), not advisory score
  const criticalAlerts = (alerts?.items ?? []).filter(d => d.severity === 'critical').length;
  const warningAlerts = (alerts?.items ?? []).filter(d => d.severity === 'warning').length;
  const overdueRenewals = (renewals?.policies ?? []).filter(r => r.days_until_renewal < 0).length;
  const soonRenewals = (renewals?.policies ?? []).filter(r => r.days_until_renewal >= 0 && r.days_until_renewal <= 30).length;
  const healthStatus = (criticalAlerts > 0 || overdueRenewals > 0)
    ? { label: 'Action Needed', color: '#991b1b', bg: '#fee2e2', icon: '⚠' }
    : (warningAlerts > 0 || soonRenewals > 0)
    ? { label: 'Needs Attention', color: '#92400e', bg: '#fef3c7', icon: '!' }
    : { label: 'Good Standing', color: '#166534', bg: '#dcfce7', icon: '✓' };

  const sortByAttention = (a: Policy, b: Policy) => {
    const daysA = a.renewal_date ? Math.ceil((new Date(a.renewal_date).getTime() - Date.now()) / (1000 * 60 * 60 * 24)) : 999;
    const daysB = b.renewal_date ? Math.ceil((new Date(b.renewal_date).getTime() - Date.now()) / (1000 * 60 * 60 * 24)) : 999;
    const urgentA = daysA <= 60 ? 0 : 1;
    const urgentB = daysB <= 60 ? 0 : 1;
    if (urgentA !== urgentB) return urgentA - urgentB;
    if (urgentA === 0 && urgentB === 0) return daysA - daysB;
    return (b.id || 0) - (a.id || 0);
  };
  const personalPolicies = activePolicies.filter(p => p.scope !== 'business').sort(sortByAttention);
  const businessPolicies = activePolicies.filter(p => p.scope === 'business').sort(sortByAttention);
  const businessGroups: { name: string; policies: Policy[] }[] = [];
  const groupMap = new Map<string, Policy[]>();
  businessPolicies.forEach(p => {
    const key = p.business_name || 'Other Business';
    if (!groupMap.has(key)) groupMap.set(key, []);
    groupMap.get(key)!.push(p);
  });
  groupMap.forEach((pols, name) => businessGroups.push({ name, policies: pols }));
  const urgentRenewals = (renewals?.policies ?? []).filter(r => r.days_until_renewal <= 30 && r.days_until_renewal >= 0);
  const hasAttention = unackCount > 0 || urgentRenewals.length > 0;

  const insights: { text: string; priority: string }[] = [];
  if (scores?.categories) {
    Object.values(scores.categories).forEach((cat: any) => {
      (cat.recommendations ?? []).filter((r: any) => !r.dismissed).forEach((r: any) => {
        insights.push({ text: r.text, priority: r.priority });
      });
    });
  }
  insights.sort((a, b) => {
    const order: Record<string, number> = { high: 0, medium: 1, low: 2 };
    return (order[a.priority] ?? 2) - (order[b.priority] ?? 2);
  });
  const topInsights = insights.slice(0, 3);

  return (
    <div style={{ padding: '32px 24px', maxWidth: 960, margin: '0 auto' }}>
      <h1 style={{ fontSize: 24, fontWeight: 700, color: 'var(--color-text)', marginBottom: 4 }}>Dashboard</h1>
      <p style={{ fontSize: 14, color: 'var(--color-text-muted)', marginBottom: 28 }}>
        {activeCount} active {activeCount === 1 ? 'policy' : 'policies'} on file
      </p>

      {loading ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <div style={{ height: 56, borderRadius: 'var(--radius-md)', backgroundColor: 'var(--color-bg)', border: '1px solid var(--color-border)' }} />
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 16 }}>
            {[1,2,3,4].map(i => (
              <div key={i} style={{ height: 140, borderRadius: 'var(--radius-md)', backgroundColor: 'var(--color-bg)', border: '1px solid var(--color-border)' }} />
            ))}
          </div>
        </div>
      ) : (
        <>
          <div onClick={() => router.push('/score')} style={{
            padding: '14px 20px', marginBottom: 20, cursor: 'pointer',
            backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)',
            borderLeft: `4px solid ${healthStatus.color}`, borderRadius: 'var(--radius-md)',
            display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
          }}>
            <div style={{
              width: 32, height: 32, borderRadius: '50%', flexShrink: 0,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              backgroundColor: healthStatus.bg, color: healthStatus.color,
              fontSize: 16, fontWeight: 700,
            }}>{healthStatus.icon}</div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--color-text)' }}>Coverage Status: </span>
              <span style={{ fontSize: 14, fontWeight: 600, color: healthStatus.color }}>{healthStatus.label}</span>
              <span style={{ fontSize: 13, color: 'var(--color-text-muted)', marginLeft: 12 }}>
                {activeCount} active {activeCount === 1 ? 'policy' : 'policies'}
                {unackCount > 0 && <> &middot; <span style={{ color: 'var(--color-danger)', fontWeight: 600 }}>{unackCount} alert{unackCount !== 1 ? 's' : ''}</span></>}
              </span>
            </div>
            <span style={{ fontSize: 12, color: 'var(--color-primary)', fontWeight: 600, whiteSpace: 'nowrap' }}>View details &rarr;</span>
          </div>

          {hasAttention && (
            <div className="card" style={{ padding: 20, marginBottom: 20 }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--color-text)', marginBottom: 12 }}>Needs Attention</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {alerts?.items?.slice(0, 3).map(d => (
                  <div key={`a-${d.id}`} onClick={() => router.push('/audit')} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13, color: 'var(--color-text-secondary)', cursor: 'pointer' }}>
                    <span style={{ width: 7, height: 7, borderRadius: '50%', flexShrink: 0, backgroundColor: d.severity === 'critical' ? 'var(--color-danger)' : d.severity === 'warning' ? 'var(--color-warning)' : 'var(--color-text-muted)' }} />
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {d.policy_carrier || 'Policy'}: {d.field_key} {d.delta_type}
                    </span>
                  </div>
                ))}
                {urgentRenewals.map(rp => (
                  <div key={`r-${rp.id}`} onClick={() => router.push('/renewals')} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13, color: 'var(--color-text-secondary)', cursor: 'pointer' }}>
                    <span style={{ width: 7, height: 7, borderRadius: '50%', flexShrink: 0, backgroundColor: rp.days_until_renewal <= 14 ? 'var(--color-danger)' : 'var(--color-warning)' }} />
                    <span>{rp.nickname || `${rp.carrier} ${rp.policy_type}`} — {rp.days_until_renewal <= 0 ? 'Renewal overdue' : `Renews in ${rp.days_until_renewal} days`}</span>
                  </div>
                ))}
              </div>
              <div style={{ display: 'flex', gap: 16, marginTop: 12 }}>
                {unackCount > 0 && (
                  <span onClick={() => router.push('/audit')} style={{ fontSize: 12, color: 'var(--color-primary)', fontWeight: 600, cursor: 'pointer' }}>View all alerts &rarr;</span>
                )}
                {urgentRenewals.length > 0 && (
                  <span onClick={() => router.push('/renewals')} style={{ fontSize: 12, color: 'var(--color-primary)', fontWeight: 600, cursor: 'pointer' }}>View renewals &rarr;</span>
                )}
              </div>
            </div>
          )}

          {(() => {
            const renderPolicyCard = (p: Policy) => {
              const cfg = POLICY_TYPE_CONFIG[p.policy_type] || { icon: '📋', label: p.policy_type };
              const renewalInfo = p.renewal_date ? (() => {
                const days = Math.ceil((new Date(p.renewal_date).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
                if (days < 0) return { label: 'Overdue', color: 'var(--color-danger)' };
                if (days <= 14) return { label: `${days}d left`, color: 'var(--color-danger)' };
                if (days <= 30) return { label: `${days}d left`, color: 'var(--color-warning-dark)' };
                return { label: new Date(p.renewal_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }), color: 'var(--color-text-muted)' };
              })() : null;

              return (
                <div key={p.id} role="button" tabIndex={0}
                  onClick={() => router.push(`/policies/${p.id}`)}
                  onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); router.push(`/policies/${p.id}`); } }}
                  style={{
                    backgroundColor: '#fff', border: '1px solid var(--color-border)',
                    borderRadius: 'var(--radius-lg)', cursor: 'pointer',
                    padding: 20, display: 'flex', flexDirection: 'column', gap: 10,
                    transition: 'border-color 0.15s, box-shadow 0.15s',
                  }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span style={{ fontSize: 24 }}>{cfg.icon}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.nickname || p.carrier}</div>
                      <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 1 }}>{cfg.label}</div>
                    </div>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
                    <div>
                      <div style={{ fontSize: 11, color: 'var(--color-text-muted)', fontWeight: 500 }}>Premium</div>
                      <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--color-text)' }}>{p.premium_amount ? `$${p.premium_amount.toLocaleString()}` : '—'}</div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontSize: 11, color: 'var(--color-text-muted)', fontWeight: 500 }}>Expiration</div>
                      <div style={{ fontSize: 13, fontWeight: 600, color: renewalInfo?.color || 'var(--color-text)' }}>{renewalInfo ? renewalInfo.label : '—'}</div>
                    </div>
                  </div>
                </div>
              );
            };

            const addPolicyCard = (
              <div role="button" tabIndex={0}
                onClick={() => router.push('/policies?action=upload')}
                onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); router.push('/policies?action=upload'); } }}
                style={{
                  border: '2px dashed var(--color-border)', borderRadius: 'var(--radius-lg)',
                  cursor: 'pointer', padding: 20, display: 'flex', flexDirection: 'column',
                  alignItems: 'center', justifyContent: 'center', gap: 8, minHeight: 120,
                  transition: 'border-color 0.15s, background-color 0.15s',
                }}>
                <span style={{ fontSize: 28, color: 'var(--color-text-muted)' }}>+</span>
                <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-text-muted)' }}>Add Policy</span>
              </div>
            );

            return (
              <div style={{ marginBottom: 20 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
                  <h2 style={{ margin: 0, fontSize: 17, fontWeight: 700, color: 'var(--color-text)' }}>Your Policies</h2>
                  {activePolicies.length > 0 && (
                    <span onClick={() => router.push('/policies')} style={{ fontSize: 12, color: 'var(--color-primary)', fontWeight: 600, cursor: 'pointer' }}>Manage all &rarr;</span>
                  )}
                </div>

                {activePolicies.length === 0 ? (
                  <div className="card" style={{ padding: 48, textAlign: 'center' }}>
                    <div style={{ fontSize: 40, marginBottom: 12 }}>{'📄'}</div>
                    <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--color-text)', marginBottom: 8 }}>No policies yet</div>
                    <div style={{ fontSize: 14, color: 'var(--color-text-muted)', marginBottom: 20 }}>Upload your first policy to get started with coverage analysis.</div>
                    <button onClick={() => router.push('/policies?action=upload')} className="btn btn-primary" style={{ padding: '10px 24px', fontSize: 14 }}>Upload Your First Policy</button>
                  </div>
                ) : (
                  <>
                    {personalPolicies.length > 0 && (
                      <div style={{ marginBottom: businessGroups.length > 0 ? 24 : 0 }}>
                        <h3 style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-text-secondary)', margin: '0 0 10px', textTransform: 'uppercase', letterSpacing: 0.5 }}>Personal Policies ({personalPolicies.length})</h3>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 16 }}>
                          {personalPolicies.map(renderPolicyCard)}
                          {businessGroups.length === 0 && addPolicyCard}
                        </div>
                      </div>
                    )}
                    {businessGroups.length > 0 && (
                      <div>
                        <h3 style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-text-secondary)', margin: '0 0 10px', textTransform: 'uppercase', letterSpacing: 0.5 }}>Business Policies</h3>
                        {businessGroups.map(group => (
                          <div key={group.name} style={{ marginBottom: 16 }}>
                            <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--color-text)', marginBottom: 8, paddingLeft: 2 }}>{group.name} ({group.policies.length})</div>
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 16 }}>
                              {group.policies.map(renderPolicyCard)}
                            </div>
                          </div>
                        ))}
                        {addPolicyCard}
                      </div>
                    )}
                    {personalPolicies.length === 0 && businessGroups.length === 0 && addPolicyCard}
                  </>
                )}
              </div>
            );
          })()}

          {topInsights.length > 0 && (
            <div style={{
              padding: '16px 20px', marginBottom: 20,
              backgroundColor: 'var(--color-bg)', border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius-md)',
            }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--color-text)', marginBottom: 10 }}>Opportunities to Strengthen Coverage</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {topInsights.map((ins, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13, color: 'var(--color-text-secondary)' }}>
                    <span style={{
                      padding: '1px 8px', borderRadius: 10, fontSize: 10, fontWeight: 600, flexShrink: 0,
                      backgroundColor: ins.priority === 'high' ? 'var(--color-danger-light)' : ins.priority === 'medium' ? 'var(--color-warning-light)' : 'var(--color-info-light)',
                      color: ins.priority === 'high' ? 'var(--color-danger-dark)' : ins.priority === 'medium' ? 'var(--color-warning-dark)' : 'var(--color-info-dark)',
                    }}>{ins.priority}</span>
                    <span>{ins.text}</span>
                  </div>
                ))}
              </div>
              <div style={{ marginTop: 10 }}>
                <span onClick={() => router.push('/score')} style={{ fontSize: 12, color: 'var(--color-primary)', fontWeight: 600, cursor: 'pointer' }}>View coverage details &rarr;</span>
              </div>
            </div>
          )}

          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 20 }}>
            <button onClick={() => router.push('/chat')} className="btn btn-outline" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: 14 }}>&#128172;</span> Ask Covrabl
            </button>
            <button onClick={() => router.push('/policies/compare')} className="btn btn-outline">Compare Policies</button>
          </div>

          <div style={{
            padding: '12px 20px', marginBottom: 28,
            backgroundColor: '#f0fdf4', border: '1px solid #bbf7d0',
            borderRadius: 'var(--radius-md)',
            display: 'flex', alignItems: 'center', gap: 10,
            fontSize: 12, color: '#166534',
          }}>
            <span style={{ fontSize: 16 }}>&#128274;</span>
            <span><strong>Secure Policy Vault</strong> — Your documents are encrypted and stored privately. Only you control access.</span>
            <span onClick={() => router.push('/security')} style={{ marginLeft: 'auto', cursor: 'pointer', fontWeight: 600, whiteSpace: 'nowrap' }}>Security &amp; Privacy &rarr;</span>
          </div>
        </>
      )}
    </div>
  );
}

/* ═════════════════════════════════════════════════════════════════════
   AGENT-FACING LANDING PAGE
   Public visitors land here. Logged-in agents go to /agent; logged-in
   consumers see the Dashboard component above.
   ═════════════════════════════════════════════════════════════════ */

export default function Home() {
  const { token, role } = useAuth();
  const router = useRouter();
  const [isReferral, setIsReferral] = useState(false);
  const [isPreview, setIsPreview] = useState(false);
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      if (params.get('ref') === 'tenant') setIsReferral(true);
      if (params.get('preview') === '1') setIsPreview(true);
    }
  }, []);
  const [openFaq, setOpenFaq] = useState<number | null>(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [announcementDismissed, setAnnouncementDismissed] = useState(false);
  const showAsPublic = !token || isReferral || isPreview;
  const showAnnouncement = ANNOUNCEMENT_BAR.enabled && showAsPublic && !announcementDismissed;

  const scrollTo = (id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' });
    setMobileMenuOpen(false);
  };

  const ctaBookDemo = () => { trackClick('landing_cta_book_demo'); window.location.href = `mailto:${APP_CONTACT_EMAIL}?subject=Covrabl%20demo%20request`; };
  const ctaTryDemo = () => { trackClick('landing_cta_try_demo'); router.push('/login?email=demo%40covrabl.com'); };

  const pillar1Ref = useScrollReveal();
  const pillar2Ref = useScrollReveal();
  const tableRef = useScrollReveal();
  const sharedRef = useScrollReveal();
  const clientRef = useScrollReveal();
  const trustRef = useScrollReveal();
  const pricingRef = useScrollReveal();

  // Logged-in users:
  //   - Agents/admins go to /agent (their dashboard with This Week + clients)
  //   - Consumers see the Dashboard component
  // Tenant referrals and ?preview=1 still see the public landing.
  //
  // role is hydrated asynchronously from sessionStorage / /auth/me. Until it
  // resolves, render nothing rather than briefly flashing the consumer
  // Dashboard at an agent — otherwise the agent sees their personal-policies
  // view for half a second before being redirected to /agent.
  useEffect(() => {
    if (token && !isReferral && !isPreview && (role === 'agent' || role === 'admin')) {
      router.replace('/agent');
    }
  }, [token, role, isReferral, isPreview, router]);

  if (token && !isReferral && !isPreview) {
    if (role === null) return null;                       // hydrating
    if (role === 'agent' || role === 'admin') return null; // useEffect will redirect
    return <Dashboard />;
  }

  return (
    <div style={{ minHeight: '100vh', background: '#fff' }}>
      {/* ── ANNOUNCEMENT BAR ─────────────────────────────────────────── */}
      {showAnnouncement && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, zIndex: 101,
          height: 36, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
          backgroundColor: ANNOUNCEMENT_BAR.bgColor, color: '#fff', fontSize: 13, fontWeight: 500,
        }}>
          <span>{ANNOUNCEMENT_BAR.text}</span>
          <a href={ANNOUNCEMENT_BAR.linkUrl} target="_blank" rel="noopener noreferrer" style={{
            color: '#fff', fontWeight: 700, textDecoration: 'underline',
          }}>{ANNOUNCEMENT_BAR.linkText}</a>
          <button onClick={() => { trackClick('landing_announcement_dismiss'); setAnnouncementDismissed(true); }} style={{
            position: 'absolute', right: 12, background: 'none', border: 'none',
            color: '#fff', fontSize: 16, cursor: 'pointer', opacity: 0.8, padding: 4,
          }}>&times;</button>
        </div>
      )}

      {/* ── NAVIGATION ───────────────────────────────────────────────── */}
      {showAsPublic && (
        <header className="landing-header" style={{
          position: 'fixed', top: showAnnouncement ? 36 : 0, left: 0, right: 0, zIndex: 100,
          background: 'rgba(255,255,255,0.95)', backdropFilter: 'blur(8px)',
          borderBottom: '1px solid var(--color-border)',
          padding: '12px 24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        }}>
          <div onClick={() => { trackClick('landing_logo_click'); window.scrollTo({ top: 0, behavior: 'smooth' }); }} style={{ cursor: 'pointer' }}>
            <Logo size="md" variant="dark" />
          </div>
          <nav className="landing-nav-links">
            <span onClick={() => { trackClick('landing_nav_pillars'); scrollTo('pillars'); }} style={{ fontSize: 14, color: 'var(--color-text-secondary)', cursor: 'pointer' }}>How it works</span>
            <span onClick={() => { trackClick('landing_nav_pricing'); scrollTo('pricing'); }} style={{ fontSize: 14, color: 'var(--color-text-secondary)', cursor: 'pointer' }}>Pricing</span>
            <span onClick={() => { trackClick('landing_nav_faq'); scrollTo('faq'); }} style={{ fontSize: 14, color: 'var(--color-text-secondary)', cursor: 'pointer' }}>FAQ</span>
            <span onClick={() => { trackClick('landing_nav_invited_by_agent'); router.push('/how-it-works'); }} style={{
              fontSize: 13, color: 'var(--color-text-muted)', cursor: 'pointer',
              borderLeft: '1px solid var(--color-border)', paddingLeft: 16,
            }}>Invited by your agent?</span>
            <button onClick={() => { trackClick('landing_nav_sign_in'); router.push('/login'); }} style={{
              padding: '8px 20px', fontSize: 14, fontWeight: 600,
              backgroundColor: 'var(--color-primary)', color: '#fff',
              border: 'none', borderRadius: 'var(--radius-md)', cursor: 'pointer',
            }}>Sign in</button>
          </nav>
          <button className="hamburger-btn" onClick={() => { trackClick('landing_hamburger_toggle'); setMobileMenuOpen(!mobileMenuOpen); }} aria-label="Toggle navigation menu" style={{
            display: 'none', background: 'none', border: 'none', cursor: 'pointer', padding: 4,
            flexDirection: 'column', gap: 5, justifyContent: 'center',
          }}>
            <span style={{ display: 'block', width: 22, height: 2, backgroundColor: 'var(--color-text)', borderRadius: 1 }} />
            <span style={{ display: 'block', width: 22, height: 2, backgroundColor: 'var(--color-text)', borderRadius: 1 }} />
            <span style={{ display: 'block', width: 22, height: 2, backgroundColor: 'var(--color-text)', borderRadius: 1 }} />
          </button>
        </header>
      )}

      {showAsPublic && mobileMenuOpen && (
        <div className="mobile-menu-dropdown" style={{
          position: 'fixed', top: 52, left: 0, right: 0, zIndex: 99,
          background: '#fff', borderBottom: '1px solid var(--color-border)',
          boxShadow: '0 4px 12px rgba(0,0,0,0.1)', padding: '12px 24px',
          display: 'flex', flexDirection: 'column', gap: 4,
        }}>
          <button onClick={() => { trackClick('landing_mobile_pillars'); scrollTo('pillars'); }} style={{ padding: '12px 0', background: 'none', border: 'none', fontSize: 15, color: 'var(--color-text)', cursor: 'pointer', textAlign: 'left' }}>How it works</button>
          <button onClick={() => { trackClick('landing_mobile_pricing'); scrollTo('pricing'); }} style={{ padding: '12px 0', background: 'none', border: 'none', fontSize: 15, color: 'var(--color-text)', cursor: 'pointer', textAlign: 'left' }}>Pricing</button>
          <button onClick={() => { trackClick('landing_mobile_faq'); scrollTo('faq'); }} style={{ padding: '12px 0', background: 'none', border: 'none', fontSize: 15, color: 'var(--color-text)', cursor: 'pointer', textAlign: 'left' }}>FAQ</button>
          <button onClick={() => { trackClick('landing_mobile_invited_by_agent'); router.push('/how-it-works'); setMobileMenuOpen(false); }} style={{ padding: '12px 0', background: 'none', border: 'none', fontSize: 14, color: 'var(--color-text-muted)', cursor: 'pointer', textAlign: 'left', borderTop: '1px solid var(--color-border)' }}>Invited by your agent?</button>
          <button onClick={() => { trackClick('landing_mobile_sign_in'); router.push('/login'); setMobileMenuOpen(false); }} style={{
            padding: '10px 20px', fontSize: 15, fontWeight: 600, marginTop: 4,
            backgroundColor: 'var(--color-primary)', color: '#fff',
            border: 'none', borderRadius: 'var(--radius-md)', cursor: 'pointer', textAlign: 'center',
          }}>Sign in</button>
        </div>
      )}

      {/* ── 1. HERO ──────────────────────────────────────────────────── */}
      <section style={{
        paddingTop: showAsPublic ? (showAnnouncement ? 156 : 120) : 60, paddingBottom: 64, paddingLeft: 24, paddingRight: 24,
        background: 'linear-gradient(160deg, #0f1f33 0%, var(--color-primary-dark) 30%, var(--color-primary) 70%, var(--color-primary-light) 100%)',
        color: '#fff', position: 'relative', overflow: 'hidden',
      }}>
        <div style={{
          position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
          background: 'radial-gradient(ellipse at 70% 20%, rgba(63,167,163,0.12) 0%, transparent 60%)',
          pointerEvents: 'none',
        }} />
        <div style={{ maxWidth: 980, margin: '0 auto', textAlign: 'center', position: 'relative' }}>
          <div style={{ marginBottom: 24 }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/brand/covrabl-mark.svg" alt="Covrabl" width={56} height={56} style={{ display: 'inline-block', opacity: 0.9 }} />
            <div style={{ fontSize: 18, fontWeight: 700, marginTop: 10, letterSpacing: 'var(--letter-spacing-tight)', fontFamily: 'var(--font-heading)' }}>COVRABL</div>
            <div style={{ fontSize: 11, fontWeight: 600, opacity: 0.7, marginTop: 4, letterSpacing: 'var(--letter-spacing-wide)', textTransform: 'uppercase' }}>For insurance agencies</div>
          </div>
          <h1 style={{
            fontSize: 46, fontWeight: 700, margin: '0 0 20px', lineHeight: 1.15,
            letterSpacing: 'var(--letter-spacing-tight)', fontFamily: 'var(--font-heading)',
          }}>
            Insurance relationships shouldn&apos;t disappear between renewals.
          </h1>
          <p style={{ fontSize: 18, opacity: 0.95, margin: '0 0 12px', lineHeight: 1.7, maxWidth: 760, marginLeft: 'auto', marginRight: 'auto', fontWeight: 500 }}>
            Covrabl uses AI to help clients understand their coverage and agents spot what&apos;s worth their time — between every renewal.
          </p>
          <p style={{ fontSize: 14, opacity: 0.65, margin: '0 0 32px', lineHeight: 1.6, maxWidth: 640, marginLeft: 'auto', marginRight: 'auto', letterSpacing: 'var(--letter-spacing-wide)' }}>
            Sits on top of your AMS and CRM. Doesn&apos;t replace them.
          </p>
          <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap', marginBottom: 24 }}>
            <button onClick={ctaBookDemo} style={{
              padding: '14px 32px', fontSize: 16, fontWeight: 600,
              backgroundColor: 'var(--color-secondary)', color: '#fff',
              border: 'none', borderRadius: 'var(--radius-md)', cursor: 'pointer',
              boxShadow: '0 4px 14px rgba(63, 167, 163, 0.3)',
            }}>Book a 15-min demo</button>
            <button onClick={ctaTryDemo} style={{
              padding: '14px 28px', fontSize: 16, fontWeight: 500,
              backgroundColor: 'rgba(255,255,255,0.08)', color: '#fff',
              border: '1px solid rgba(255,255,255,0.2)', borderRadius: 'var(--radius-md)', cursor: 'pointer',
              backdropFilter: 'blur(4px)',
            }}>See the public demo &rarr;</button>
          </div>
          <div style={{ fontSize: 13, opacity: 0.6, letterSpacing: 'var(--letter-spacing-wide)' }}>
            $59/mo per agent · founding partner pricing · locks for 12 months
          </div>
          <div style={{ marginTop: 18 }}>
            <span onClick={() => { trackClick('landing_invited_by_agent'); router.push('/how-it-works'); }} style={{
              fontSize: 13, color: '#fff', opacity: 0.75, cursor: 'pointer',
              borderBottom: '1px solid rgba(255,255,255,0.3)', paddingBottom: 1,
            }}>
              Invited by your agent? See how it works &rarr;
            </span>
          </div>
        </div>

        {/* This Week feed mock — the killer screenshot, inline as JSX */}
        <div style={{ maxWidth: 720, margin: '48px auto 0', position: 'relative' }}>
          <div style={{
            borderRadius: 'var(--radius-lg)', overflow: 'hidden',
            backgroundColor: '#fff', color: 'var(--color-text)',
            boxShadow: '0 20px 60px rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.1)',
          }}>
            <div style={{ padding: '14px 20px', backgroundColor: 'var(--color-bg)', borderBottom: '1px solid var(--color-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: 'var(--letter-spacing-wide)' }}>This Week</div>
                <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--color-text)' }}>4 clients to reach out to</div>
              </div>
              <span style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>Mon, May 11</span>
            </div>
            {[
              { sev: '#dc2626', sevbg: '#fee2e2', icon: '⏰', who: 'Sarah Westlake', what: 'Auto renewal · Allstate · 21 days out · premium up 12%' },
              { sev: '#d97706', sevbg: '#fef3c7', icon: '\u{1F4C4}', who: 'Robert Thompson', what: 'Uploaded new umbrella declarations — needs review' },
              { sev: '#0891b2', sevbg: '#cffafe', icon: '\u{1F441}', who: 'Elena Rodriguez', what: 'Viewed her shared renewal review · ready to discuss' },
              { sev: '#64748b', sevbg: '#f1f5f9', icon: '\u{1F4AC}', who: 'Marcus Williams', what: 'No interaction in 127 days · still active book' },
            ].map((row, i) => (
              <div key={i} style={{
                display: 'flex', alignItems: 'center', gap: 12,
                padding: '12px 20px', borderBottom: i < 3 ? '1px solid var(--color-border)' : 'none',
              }}>
                <span style={{
                  width: 28, height: 28, borderRadius: '50%', display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  backgroundColor: row.sevbg, color: row.sev, fontSize: 13, fontWeight: 700, flexShrink: 0,
                }}>{row.icon}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-text)' }}>{row.who}</div>
                  <div style={{ fontSize: 12, color: 'var(--color-text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{row.what}</div>
                </div>
                <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--color-primary)' }}>Open</span>
              </div>
            ))}
          </div>
          <div style={{ fontSize: 12, opacity: 0.6, marginTop: 12, textAlign: 'center', fontStyle: 'italic' }}>
            What to talk to your book about this week — generated from real activity, not guesswork.
          </div>
        </div>
      </section>

      {/* ── 2. THE TWO PILLARS ───────────────────────────────────────── */}
      <section id="pillars" style={{ padding: '80px 24px', background: '#fff' }}>
        <div style={{ maxWidth: 1000, margin: '0 auto' }}>
          <div style={{ textAlign: 'center', marginBottom: 48 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--color-primary)', textTransform: 'uppercase', letterSpacing: 'var(--letter-spacing-wide)', marginBottom: 8 }}>What Covrabl does</div>
            <h2 style={{ fontSize: 32, fontWeight: 700, color: 'var(--color-text)', margin: '0 0 12px', letterSpacing: 'var(--letter-spacing-tight)' }}>Two things, done well.</h2>
            <p style={{ fontSize: 16, color: 'var(--color-text-secondary)', maxWidth: 600, margin: '0 auto', lineHeight: 1.6 }}>Identify the conversation worth having. Make that conversation beautiful.</p>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(380px, 1fr))', gap: 24 }}>
            <div ref={pillar1Ref} className="card" style={{ padding: 28 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--color-primary)', textTransform: 'uppercase', letterSpacing: 'var(--letter-spacing-wide)', marginBottom: 8 }}>Pillar 1</div>
              <h3 style={{ fontSize: 22, fontWeight: 700, color: 'var(--color-text)', margin: '0 0 8px' }}>Identify the conversation worth having</h3>
              <p style={{ fontSize: 14, color: 'var(--color-text-secondary)', margin: '0 0 18px', lineHeight: 1.6 }}>The right client. The right reason. The right week.</p>
              <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 10 }}>
                <li style={{ display: 'flex', gap: 10, fontSize: 14, color: 'var(--color-text-secondary)' }}>
                  <span style={{ color: 'var(--color-primary)', fontWeight: 700, flexShrink: 0 }}>—</span>
                  <span><strong style={{ color: 'var(--color-text)' }}>This Week feed</strong> surfaces renewals coming up, documents your clients just uploaded, share-link views, and clients who&apos;ve gone quiet</span>
                </li>
                <li style={{ display: 'flex', gap: 10, fontSize: 14, color: 'var(--color-text-secondary)' }}>
                  <span style={{ color: 'var(--color-primary)', fontWeight: 700, flexShrink: 0 }}>—</span>
                  <span><strong style={{ color: 'var(--color-text)' }}>No scoring, no judgment</strong> — every row is a signal; you decide what to do with it</span>
                </li>
                <li style={{ display: 'flex', gap: 10, fontSize: 14, color: 'var(--color-text-secondary)' }}>
                  <span style={{ color: 'var(--color-primary)', fontWeight: 700, flexShrink: 0 }}>—</span>
                  <span><strong style={{ color: 'var(--color-text)' }}>Built from real activity</strong> in your book — not predictions, not models</span>
                </li>
              </ul>
            </div>

            <div ref={pillar2Ref} className="card" style={{ padding: 28 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--color-primary)', textTransform: 'uppercase', letterSpacing: 'var(--letter-spacing-wide)', marginBottom: 8 }}>Pillar 2</div>
              <h3 style={{ fontSize: 22, fontWeight: 700, color: 'var(--color-text)', margin: '0 0 8px' }}>Have the conversation well</h3>
              <p style={{ fontSize: 14, color: 'var(--color-text-secondary)', margin: '0 0 18px', lineHeight: 1.6 }}>Show your work. Make it shareable. Make it land.</p>
              <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 10 }}>
                <li style={{ display: 'flex', gap: 10, fontSize: 14, color: 'var(--color-text-secondary)' }}>
                  <span style={{ color: 'var(--color-primary)', fontWeight: 700, flexShrink: 0 }}>—</span>
                  <span><strong style={{ color: 'var(--color-text)' }}>Coverage Reviews</strong> — side-by-side year-over-year comparisons for renewal conversations</span>
                </li>
                <li style={{ display: 'flex', gap: 10, fontSize: 14, color: 'var(--color-text-secondary)' }}>
                  <span style={{ color: 'var(--color-primary)', fontWeight: 700, flexShrink: 0 }}>—</span>
                  <span><strong style={{ color: 'var(--color-text)' }}>Quote Comparisons</strong> — incumbent-vs-quote layouts with structured differences</span>
                </li>
                <li style={{ display: 'flex', gap: 10, fontSize: 14, color: 'var(--color-text-secondary)' }}>
                  <span style={{ color: 'var(--color-primary)', fontWeight: 700, flexShrink: 0 }}>—</span>
                  <span><strong style={{ color: 'var(--color-text)' }}>Shareable summaries</strong> — your client opens a clean read-only page; no login, no app to download</span>
                </li>
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* ── 3. SYSTEM OF ENGAGEMENT, NOT RECORD ──────────────────────── */}
      <section style={{ padding: '80px 24px', background: 'var(--color-surface)' }}>
        <div style={{ maxWidth: 880, margin: '0 auto' }}>
          <div style={{ textAlign: 'center', marginBottom: 36 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--color-primary)', textTransform: 'uppercase', letterSpacing: 'var(--letter-spacing-wide)', marginBottom: 12 }}>How it fits with your stack</div>
            <div style={{ fontSize: 28, fontWeight: 700, color: 'var(--color-text)', lineHeight: 1.4, letterSpacing: 'var(--letter-spacing-tight)' }}>
              Your AMS stores the policies.<br />
              Your CRM stores the tasks.<br />
              <span style={{ color: 'var(--color-primary)' }}>Covrabl tells you what to talk about this week.</span>
            </div>
          </div>
          <div ref={tableRef} style={{
            backgroundColor: '#fff', border: '1px solid var(--color-border)',
            borderRadius: 'var(--radius-lg)', overflow: 'hidden',
            boxShadow: '0 4px 16px rgba(0,0,0,0.04)',
          }}>
            <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr', backgroundColor: 'var(--color-bg)', borderBottom: '1px solid var(--color-border)' }}>
              <div style={{ padding: '14px 18px', fontSize: 12, fontWeight: 700, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: 'var(--letter-spacing-wide)' }}></div>
              <div style={{ padding: '14px 12px', fontSize: 12, fontWeight: 700, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: 'var(--letter-spacing-wide)', textAlign: 'center' }}>AMS</div>
              <div style={{ padding: '14px 12px', fontSize: 12, fontWeight: 700, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: 'var(--letter-spacing-wide)', textAlign: 'center' }}>CRM</div>
              <div style={{ padding: '14px 12px', fontSize: 12, fontWeight: 700, color: 'var(--color-primary)', textTransform: 'uppercase', letterSpacing: 'var(--letter-spacing-wide)', textAlign: 'center' }}>Covrabl</div>
            </div>
            {[
              { row: 'Stores policies', ams: '✓', crm: '', cv: 'reads, not stores' },
              { row: 'Tracks tasks & pipelines', ams: '', crm: '✓', cv: '' },
              { row: 'Surfaces policy changes year-over-year', ams: '', crm: '', cv: '✓' },
              { row: 'Tells you which client to call this week', ams: '', crm: '', cv: '✓' },
              { row: 'Lets clients see their own coverage', ams: '', crm: '', cv: '✓' },
              { row: 'Generates shareable renewal reviews', ams: '', crm: '', cv: '✓' },
            ].map((r, i) => (
              <div key={i} style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr', borderBottom: i < 5 ? '1px solid var(--color-border)' : 'none' }}>
                <div style={{ padding: '14px 18px', fontSize: 14, color: 'var(--color-text)', fontWeight: 500 }}>{r.row}</div>
                <div style={{ padding: '14px 12px', textAlign: 'center', fontSize: 16, color: 'var(--color-text-muted)' }}>{r.ams}</div>
                <div style={{ padding: '14px 12px', textAlign: 'center', fontSize: 16, color: 'var(--color-text-muted)' }}>{r.crm}</div>
                <div style={{ padding: '14px 12px', textAlign: 'center', fontSize: r.cv === '✓' ? 16 : 11, color: r.cv === '✓' ? 'var(--color-primary)' : 'var(--color-text-muted)', fontWeight: r.cv === '✓' ? 700 : 500, fontStyle: r.cv === '✓' ? 'normal' : 'italic' }}>{r.cv}</div>
              </div>
            ))}
          </div>
          <p style={{ fontSize: 14, color: 'var(--color-text-muted)', textAlign: 'center', margin: '20px 0 0', fontStyle: 'italic' }}>
            AMS and CRM are systems of record. Covrabl is a system of engagement that sits on top of them — additive, not replacement.
          </p>
        </div>
      </section>

      {/* ── 4a. SHARED COVERAGE REVIEW (collaborative workspace) ─────── */}
      <section style={{ padding: '80px 24px', background: '#fff' }}>
        <div style={{ maxWidth: 1000, margin: '0 auto' }}>
          <div style={{ textAlign: 'center', marginBottom: 36 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--color-primary)', textTransform: 'uppercase', letterSpacing: 'var(--letter-spacing-wide)', marginBottom: 12 }}>The same page — literally</div>
            <h2 style={{ fontSize: 32, fontWeight: 700, color: 'var(--color-text)', margin: '0 0 12px', letterSpacing: 'var(--letter-spacing-tight)' }}>Coverage Reviews are a workspace, not a PDF.</h2>
            <p style={{ fontSize: 16, color: 'var(--color-text-secondary)', margin: '0 auto', maxWidth: 640, lineHeight: 1.6 }}>
              You prep it in Covrabl. Your client opens it from the share link. Both of you are looking at the same view — with your notes, the year-over-year changes, and context Covrabl adds quietly underneath.
            </p>
          </div>
          <div ref={sharedRef} style={{
            maxWidth: 720, margin: '0 auto',
            backgroundColor: '#fff', border: '1px solid var(--color-border)',
            borderRadius: 'var(--radius-lg)', overflow: 'hidden',
            boxShadow: '0 8px 32px rgba(0,0,0,0.08)',
          }}>
            {/* Header bar */}
            <div style={{ padding: '14px 20px', backgroundColor: 'var(--color-bg)', borderBottom: '1px solid var(--color-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              <div style={{ minWidth: 0, flex: '1 1 auto' }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: 'var(--letter-spacing-wide)' }}>Coverage Review · 2026 renewal</div>
                <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--color-text)' }}>Sarah Westlake · Auto · Allstate</div>
              </div>
              <span style={{ fontSize: 11, fontWeight: 600, color: '#15803d', background: '#dcfce7', padding: '4px 10px', borderRadius: 12, whiteSpace: 'nowrap' }}>Shared with Sarah</span>
            </div>

            {/* Side-by-side comparison */}
            <div style={{ padding: '20px 20px 12px' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr 1fr', gap: 12, alignItems: 'center' }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: 'var(--letter-spacing-wide)' }}></div>
                <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: 'var(--letter-spacing-wide)', textAlign: 'center' }}>Last year</div>
                <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--color-primary)', textTransform: 'uppercase', letterSpacing: 'var(--letter-spacing-wide)', textAlign: 'center' }}>Renewal</div>
              </div>
              {[
                { label: 'Bodily injury liability', last: '$300K', next: '$500K', dir: 'up' },
                { label: 'Deductible', last: '$500', next: '$1,000', dir: 'up' },
                { label: 'Annual premium', last: '$1,840', next: '$2,065', dir: 'up' },
              ].map((row, i) => (
                <div key={i} style={{
                  display: 'grid', gridTemplateColumns: '1.4fr 1fr 1fr', gap: 12, alignItems: 'center',
                  padding: '10px 0', borderTop: '1px solid var(--color-border)',
                }}>
                  <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--color-text)' }}>{row.label}</div>
                  <div style={{ fontSize: 13, color: 'var(--color-text-muted)', textAlign: 'center' }}>{row.last}</div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--color-text)', textAlign: 'center' }}>
                    {row.next} <span style={{ fontSize: 11, color: 'var(--color-warning-dark)', marginLeft: 4 }}>↑</span>
                  </div>
                </div>
              ))}
            </div>

            {/* Agent note */}
            <div style={{ padding: '14px 20px', backgroundColor: '#f0f9ff', borderTop: '1px solid var(--color-border)', display: 'flex', gap: 12 }}>
              <div style={{
                width: 32, height: 32, borderRadius: '50%', flexShrink: 0,
                backgroundColor: 'var(--color-primary)', color: '#fff',
                fontSize: 12, fontWeight: 700,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>MJ</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--color-primary-dark)', marginBottom: 2 }}>Mike Johnson · your agent</div>
                <div style={{ fontSize: 13, color: 'var(--color-text)', lineHeight: 1.5 }}>
                  Premium is up but you&apos;re getting a real bump in liability — worth discussing on our Tuesday call. I&apos;ve put a 30-min hold on your calendar.
                </div>
              </div>
            </div>

            {/* Covrabl context — assistive, not advisory */}
            <div style={{ padding: '12px 20px', backgroundColor: 'var(--color-surface)', borderTop: '1px solid var(--color-border)', display: 'flex', gap: 12, alignItems: 'flex-start' }}>
              <span style={{ fontSize: 14, flexShrink: 0, marginTop: 2 }}>✨</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: 'var(--letter-spacing-wide)', marginBottom: 2 }}>Context from Covrabl</div>
                <div style={{ fontSize: 12, color: 'var(--color-text-secondary)', lineHeight: 1.5 }}>
                  Liability now exceeds the recommended minimum for your household. Deductible doubled — out-of-pocket on a claim has changed. Worth confirming with Mike.
                </div>
              </div>
            </div>

            {/* Engagement footer — what feeds back into This Week */}
            <div style={{ padding: '10px 20px', backgroundColor: 'var(--color-bg)', borderTop: '1px solid var(--color-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>Sarah viewed this 2x · last opened 14 minutes ago</span>
              <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--color-primary)', whiteSpace: 'nowrap' }}>Appears in This Week →</span>
            </div>
          </div>

          <p style={{ fontSize: 13, color: 'var(--color-text-muted)', textAlign: 'center', margin: '20px auto 0', maxWidth: 600, lineHeight: 1.6, fontStyle: 'italic' }}>
            Your client sees what you wrote. You see when they engaged. Covrabl adds context, never advice — the agent stays the authority.
          </p>
        </div>
      </section>

      {/* ── 4. A BETTER EXPERIENCE FOR YOUR CLIENTS ──────────────────── */}
      <section style={{ padding: '80px 24px', background: '#fff' }}>
        <div style={{ maxWidth: 1000, margin: '0 auto' }}>
          <div ref={clientRef} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: 48, alignItems: 'center' }}>
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--color-primary)', textTransform: 'uppercase', letterSpacing: 'var(--letter-spacing-wide)', marginBottom: 12 }}>For your book</div>
              <h2 style={{ fontSize: 32, fontWeight: 700, color: 'var(--color-text)', margin: '0 0 16px', letterSpacing: 'var(--letter-spacing-tight)' }}>This is what your book sees.</h2>
              <p style={{ fontSize: 16, color: 'var(--color-text-secondary)', margin: '0 0 24px', lineHeight: 1.7 }}>
                A clean, branded view of every policy you&apos;ve shared with them. No ads. No quote spam. No &ldquo;we noticed you might also be interested in life insurance.&rdquo; Just their coverage — organized, current, theirs to reference any time.
              </p>
              <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 10 }}>
                <li style={{ display: 'flex', gap: 10, fontSize: 14, color: 'var(--color-text-secondary)' }}>
                  <span style={{ color: 'var(--color-primary)', fontWeight: 700, flexShrink: 0 }}>✓</span>
                  <span><strong style={{ color: 'var(--color-text)' }}>Branded as your agency</strong>, not Covrabl</span>
                </li>
                <li style={{ display: 'flex', gap: 10, fontSize: 14, color: 'var(--color-text-secondary)' }}>
                  <span style={{ color: 'var(--color-primary)', fontWeight: 700, flexShrink: 0 }}>✓</span>
                  <span><strong style={{ color: 'var(--color-text)' }}>No data sold, no marketing emails</strong> — not now, not ever</span>
                </li>
                <li style={{ display: 'flex', gap: 10, fontSize: 14, color: 'var(--color-text-secondary)' }}>
                  <span style={{ color: 'var(--color-primary)', fontWeight: 700, flexShrink: 0 }}>✓</span>
                  <span><strong style={{ color: 'var(--color-text)' }}>Renewal reviews and quote comparisons land here too</strong> — they see the conversation prep before the call</span>
                </li>
              </ul>
            </div>
            <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
              <div style={{ padding: '16px 20px', backgroundColor: 'var(--color-bg)', borderBottom: '1px solid var(--color-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--color-text)' }}>Your Coverage</div>
                  <div style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>3 policies on file</div>
                </div>
                <div style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>Branded: Westlake Insurance Agency</div>
              </div>
              {[
                { type: 'Auto', carrier: 'Allstate', renew: 'Renews Oct 3, 2026', premium: '$1,980/yr' },
                { type: 'Home', carrier: 'Allstate', renew: 'Renews Oct 3, 2026', premium: '$2,900/yr' },
                { type: 'Umbrella', carrier: 'Allstate', renew: 'Renews Oct 3, 2026', premium: '$480/yr' },
              ].map((p, i) => (
                <div key={i} style={{
                  padding: '14px 20px', borderBottom: i < 2 ? '1px solid var(--color-border)' : 'none',
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                }}>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-text)' }}>{p.carrier} {p.type}</div>
                    <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>{p.renew}</div>
                  </div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-text)' }}>{p.premium}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ── 5. AGENCY TRUST INFRASTRUCTURE ───────────────────────────── */}
      <section style={{ padding: '80px 24px', background: 'var(--color-surface)' }}>
        <div ref={trustRef} style={{ maxWidth: 720, margin: '0 auto', textAlign: 'center' }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--color-primary)', textTransform: 'uppercase', letterSpacing: 'var(--letter-spacing-wide)', marginBottom: 12 }}>Agency trust infrastructure</div>
          <h2 style={{ fontSize: 28, fontWeight: 700, color: 'var(--color-text)', margin: '0 0 16px', letterSpacing: 'var(--letter-spacing-tight)' }}>Built for the trust your book has in you.</h2>
          <p style={{ fontSize: 15, color: 'var(--color-text-secondary)', margin: '0 0 36px', lineHeight: 1.7 }}>
            When you invite your clients into Covrabl, you&apos;re extending your agency&apos;s reputation. We treat that as the responsibility it is.
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 16, textAlign: 'left' }}>
            {[
              { head: 'No data sold. Ever.', body: 'We make money from agencies, not advertisers or lead aggregators.' },
              { head: 'No carrier marketplace.', body: 'Covrabl will never quote against your business or resell client data to lead networks.' },
              { head: 'Encrypted, audited access.', body: 'AES-256 at rest. Audit log on every account. Data export on demand.' },
            ].map((t, i) => (
              <div key={i} className="card" style={{ padding: 20 }}>
                <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--color-text)', marginBottom: 6 }}>{t.head}</div>
                <div style={{ fontSize: 13, color: 'var(--color-text-secondary)', lineHeight: 1.6 }}>{t.body}</div>
              </div>
            ))}
          </div>
          <p style={{ fontSize: 13, color: 'var(--color-text-muted)', margin: '24px 0 0' }}>
            See our <span onClick={() => router.push('/privacy')} style={{ color: 'var(--color-primary)', fontWeight: 600, cursor: 'pointer' }}>Privacy</span> and <span onClick={() => router.push('/subprocessors')} style={{ color: 'var(--color-primary)', fontWeight: 600, cursor: 'pointer' }}>Subprocessors</span> pages for specifics.
          </p>
        </div>
      </section>

      {/* ── 6. PRICING ───────────────────────────────────────────────── */}
      <section id="pricing" style={{ padding: '80px 24px', background: '#fff' }}>
        <div ref={pricingRef} style={{ maxWidth: 920, margin: '0 auto' }}>
          <div style={{ textAlign: 'center', marginBottom: 36 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--color-primary)', textTransform: 'uppercase', letterSpacing: 'var(--letter-spacing-wide)', marginBottom: 12 }}>Pricing</div>
            <h2 style={{ fontSize: 32, fontWeight: 700, color: 'var(--color-text)', margin: '0 0 12px', letterSpacing: 'var(--letter-spacing-tight)' }}>Founding partner pricing — locked for 12 months.</h2>
            <p style={{ fontSize: 15, color: 'var(--color-text-secondary)', margin: 0 }}>No platform fee. No per-client charges.</p>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 20 }}>
            <div className="card" style={{ padding: 28, border: '2px solid var(--color-primary)' }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--color-primary)', textTransform: 'uppercase', letterSpacing: 'var(--letter-spacing-wide)', marginBottom: 8 }}>Founding partner</div>
              <div style={{ fontSize: 40, fontWeight: 700, color: 'var(--color-text)', margin: '0 0 4px', letterSpacing: 'var(--letter-spacing-tight)' }}>$59<span style={{ fontSize: 16, fontWeight: 500, color: 'var(--color-text-muted)' }}>/mo per agent</span></div>
              <div style={{ fontSize: 13, color: 'var(--color-text-muted)', marginBottom: 18 }}>Locks for 12 months</div>
              <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 20px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                {[
                  'Every feature — unlimited clients',
                  'Coverage Reviews (renewal + quote)',
                  'This Week outreach feed',
                  'Branded client portal',
                  'Audit log + data export',
                  'Email support',
                ].map((f, i) => (
                  <li key={i} style={{ display: 'flex', gap: 8, fontSize: 13, color: 'var(--color-text-secondary)' }}>
                    <span style={{ color: 'var(--color-primary)', fontWeight: 700, flexShrink: 0 }}>✓</span>
                    <span>{f}</span>
                  </li>
                ))}
              </ul>
              <button onClick={ctaBookDemo} style={{
                width: '100%', padding: '12px 20px', fontSize: 14, fontWeight: 600,
                backgroundColor: 'var(--color-primary)', color: '#fff',
                border: 'none', borderRadius: 'var(--radius-md)', cursor: 'pointer',
              }}>Book a 15-min demo</button>
            </div>

            <div className="card" style={{ padding: 28 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: 'var(--letter-spacing-wide)', marginBottom: 8 }}>Add-ons</div>
              <div style={{ marginBottom: 24 }}>
                <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--color-text)', margin: '0 0 4px' }}>White-label</div>
                <div style={{ fontSize: 13, color: 'var(--color-text-muted)', marginBottom: 8 }}>+$500 one-time setup</div>
                <div style={{ fontSize: 13, color: 'var(--color-text-secondary)', lineHeight: 1.6 }}>
                  Your logo, your colors, your domain on the client-facing portal. Your clients never see a Covrabl brand.
                </div>
              </div>
              <div>
                <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--color-text)', margin: '0 0 4px' }}>More than 5 agents?</div>
                <div style={{ fontSize: 13, color: 'var(--color-text-secondary)', lineHeight: 1.6, marginBottom: 12 }}>
                  Larger agencies get tiered pricing and dedicated onboarding. Let&apos;s talk.
                </div>
                <button onClick={ctaBookDemo} style={{
                  padding: '10px 16px', fontSize: 13, fontWeight: 600,
                  backgroundColor: 'var(--color-surface)', color: 'var(--color-text)',
                  border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', cursor: 'pointer',
                }}>Contact us &rarr;</button>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── 7. FAQ ───────────────────────────────────────────────────── */}
      <section id="faq" style={{ padding: '80px 24px', background: 'var(--color-surface)' }}>
        <div style={{ maxWidth: 680, margin: '0 auto' }}>
          <h2 style={{ fontSize: 28, fontWeight: 700, margin: '0 0 40px', textAlign: 'center', color: 'var(--color-text)' }}>Frequently asked questions</h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
            {[
              {
                q: 'How is Covrabl different from my AMS?',
                a: 'Your AMS stores policies, handles servicing, and processes carrier downloads. Covrabl reads policy data and surfaces what changed and which client to talk to this week. Additive, not replacement — Covrabl sits on top of your AMS, not in place of it.',
              },
              {
                q: 'Isn’t this just a CRM with extra steps?',
                a: 'CRMs are built for sales and task management — leads, pipelines, follow-ups. Covrabl is built for post-sale relationship continuity: tracking coverage changes over time, generating shareable reviews, and surfacing engagement signals. Different problem.',
              },
              {
                q: 'Will my clients actually use it?',
                a: 'They will if they see value. The consumer portal is branded as your agency, has no ads, no upsells, no quote spam — just a clean view of their coverage with the renewal reviews you’ve prepared. Engagement on shared review links is one of the metrics we surface back to you.',
              },
              {
                q: 'What about my E&O liability?',
                a: 'Privacy and data handling are designed for E&O comfort: no data sold, no carrier marketplace, no scraping, no ad networks. Audit log on every account. AES-256 encryption at rest. Data export on demand. See our Privacy and Subprocessors pages for specifics.',
              },
              {
                q: 'How long does onboarding take?',
                a: 'About 15 minutes to add your first client and share a policy. Bulk-add via CSV for larger books — we’ll help you import on a setup call.',
              },
            ].map((faq, i) => (
              <div key={i} style={{ borderBottom: '1px solid var(--color-border)' }}>
                <button onClick={() => { trackClick('landing_faq_toggle', { index: i }); setOpenFaq(openFaq === i ? null : i); }} style={{
                  width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  padding: '20px 0', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left',
                }}>
                  <span style={{ fontSize: 16, fontWeight: 600, color: 'var(--color-text)', paddingRight: 16 }}>{faq.q}</span>
                  <span style={{
                    fontSize: 20, color: 'var(--color-text-muted)', flexShrink: 0, lineHeight: 1,
                    transform: openFaq === i ? 'rotate(45deg)' : 'none', transition: 'transform 0.2s',
                  }}>+</span>
                </button>
                {openFaq === i && (
                  <div style={{ padding: '0 0 20px', fontSize: 15, color: 'var(--color-text-secondary)', lineHeight: 1.7 }}>{faq.a}</div>
                )}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── 8. FINAL CTA ─────────────────────────────────────────────── */}
      <section style={{
        padding: '80px 24px',
        background: 'linear-gradient(160deg, #0f1f33 0%, var(--color-primary-dark) 40%, var(--color-primary) 100%)',
        color: '#fff', textAlign: 'center', position: 'relative', overflow: 'hidden',
      }}>
        <div style={{
          position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
          background: 'radial-gradient(ellipse at 30% 80%, rgba(63,167,163,0.1) 0%, transparent 60%)',
          pointerEvents: 'none',
        }} />
        <div style={{ maxWidth: 640, margin: '0 auto', position: 'relative' }}>
          <h2 style={{ fontSize: 32, fontWeight: 700, margin: '0 0 16px', letterSpacing: 'var(--letter-spacing-tight)' }}>
            Stop guessing which client to call.<br />Start knowing.
          </h2>
          <p style={{ fontSize: 17, opacity: 0.9, margin: '0 0 32px' }}>
            Book a 15-minute demo and we&apos;ll walk you through a real book in Covrabl. Founding partner pricing locks for 12 months.
          </p>
          <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap', marginBottom: 16 }}>
            <button onClick={ctaBookDemo} style={{
              padding: '16px 36px', fontSize: 17, fontWeight: 600,
              backgroundColor: 'var(--color-secondary)', color: '#fff',
              border: 'none', borderRadius: 'var(--radius-md)', cursor: 'pointer',
              boxShadow: '0 4px 14px rgba(63, 167, 163, 0.3)',
            }}>Book a 15-min demo with the founder</button>
            <button onClick={ctaTryDemo} style={{
              padding: '16px 28px', fontSize: 15, fontWeight: 500,
              backgroundColor: 'rgba(255,255,255,0.08)', color: '#fff',
              border: '1px solid rgba(255,255,255,0.2)', borderRadius: 'var(--radius-md)', cursor: 'pointer',
              backdropFilter: 'blur(4px)',
            }}>Try the public demo &rarr;</button>
          </div>
          <div style={{ marginTop: 12, fontSize: 12, opacity: 0.5, letterSpacing: 'var(--letter-spacing-wide)' }}>
            No data sold. Ever. Your clients see only their coverage.
          </div>
        </div>
      </section>

      {/* ── FOOTER ───────────────────────────────────────────────────── */}
      <footer style={{ padding: '32px 24px', borderTop: '1px solid var(--color-border)', color: 'var(--color-text-muted)', fontSize: 13 }}>
        <div style={{ maxWidth: 700, margin: '0 auto' }}>
          <div style={{ display: 'flex', justifyContent: 'center', gap: 16, marginBottom: 20, flexWrap: 'wrap' }}>
            {[
              { icon: '\u{1F512}', label: 'AES-256 Encrypted' },
              { icon: '\u{1F6E1}️', label: 'SOC 2 Standards' },
              { icon: '\u{1F4DC}', label: 'No data sold' },
            ].map(b => (
              <span key={b.label} onClick={() => { trackClick('landing_footer_trust_badge', { label: b.label }); router.push('/security'); }} style={{
                display: 'inline-flex', alignItems: 'center', gap: 6,
                padding: '6px 14px', borderRadius: 20,
                border: '1px solid var(--color-border)', backgroundColor: 'var(--color-bg)',
                fontSize: 11, fontWeight: 600, color: 'var(--color-text-secondary)',
                cursor: 'pointer',
              }}>
                <span style={{ fontSize: 14 }}>{b.icon}</span> {b.label}
              </span>
            ))}
          </div>
          <div style={{ display: 'flex', justifyContent: 'center', gap: 24, marginBottom: 16, flexWrap: 'wrap' }}>
            <span onClick={() => { trackClick('landing_footer_for_clients'); router.push('/how-it-works'); }} style={{ cursor: 'pointer' }}>For clients</span>
            <span onClick={() => { trackClick('landing_footer_privacy'); router.push('/privacy'); }} style={{ cursor: 'pointer' }}>Privacy</span>
            <span onClick={() => { trackClick('landing_footer_terms'); router.push('/terms'); }} style={{ cursor: 'pointer' }}>Terms</span>
            <span onClick={() => { trackClick('landing_footer_security'); router.push('/security'); }} style={{ cursor: 'pointer' }}>Security</span>
            <span onClick={() => { trackClick('landing_footer_subprocessors'); router.push('/subprocessors'); }} style={{ cursor: 'pointer' }}>Subprocessors</span>
            <span onClick={() => { trackClick('landing_footer_support'); router.push('/support'); }} style={{ cursor: 'pointer' }}>Support</span>
            <a href={`mailto:${APP_CONTACT_EMAIL}`} style={{ color: 'var(--color-text-muted)', textDecoration: 'none' }}>{APP_CONTACT_EMAIL}</a>
          </div>
          <div style={{ textAlign: 'center' }}>
            &copy; 2026 Covrabl, LLC &mdash; {APP_TAGLINE}
          </div>
        </div>
      </footer>
    </div>
  );
}
