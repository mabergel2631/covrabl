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

/* ── Timeline scroll tracker ─────────────────────────── */
function useTimelineFill() {
  const containerRef = useRef<HTMLDivElement>(null);
  const lineRef = useRef<HTMLDivElement>(null);
  const [activeDots, setActiveDots] = useState<boolean[]>([false, false, false, false]);

  useEffect(() => {
    const container = containerRef.current;
    const line = lineRef.current;
    if (!container || !line) return;

    const onScroll = () => {
      const rect = container.getBoundingClientRect();
      const windowH = window.innerHeight;
      const containerTop = rect.top;
      const containerH = rect.height;

      // How far the viewport center has traveled through the container
      const progress = Math.min(Math.max((windowH * 0.5 - containerTop) / containerH, 0), 1);
      line.style.height = `${progress * 100}%`;

      // Activate dots at 12.5%, 37.5%, 62.5%, 87.5% (centers of 4 quarters)
      const thresholds = [0.125, 0.375, 0.625, 0.875];
      setActiveDots(thresholds.map(t => progress >= t));
    };

    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll(); // initial
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return { containerRef, lineRef, activeDots };
}

/* ── Product Demo Simulation ──────────────────────────── */
const DEMO_SCENES = [
  { id: 'upload', duration: 4500, label: 'Upload any policy — personal or business' },
  { id: 'extract', duration: 6000, label: 'AI extracts limits, terms, and exclusions' },
  { id: 'chat', duration: 7500, label: 'Ask questions about your coverage' },
  { id: 'compliance', duration: 6000, label: 'Verify compliance requirements' },
  { id: 'emergency', duration: 5000, label: 'Emergency access when it matters' },
  { id: 'summary', duration: 5000, label: 'See everything. Verify. Stay ahead.' },
];
const TOTAL_DURATION = DEMO_SCENES.reduce((s, sc) => s + sc.duration, 0);

function ProductDemo() {
  const [elapsed, setElapsed] = useState(0);
  const [isVisible, setIsVisible] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const router = useRouter();

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(([e]) => { if (e.isIntersecting) setIsVisible(true); }, { threshold: 0.3 });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  useEffect(() => {
    if (!isVisible) return;
    const tick = setInterval(() => setElapsed(p => (p + 50) % TOTAL_DURATION), 50);
    return () => clearInterval(tick);
  }, [isVisible]);

  // Determine active scene
  let cumulative = 0;
  let activeIdx = 0;
  let sceneProgress = 0;
  for (let i = 0; i < DEMO_SCENES.length; i++) {
    if (elapsed < cumulative + DEMO_SCENES[i].duration) {
      activeIdx = i;
      sceneProgress = (elapsed - cumulative) / DEMO_SCENES[i].duration;
      break;
    }
    cumulative += DEMO_SCENES[i].duration;
  }
  const scene = DEMO_SCENES[activeIdx];
  const overallProgress = elapsed / TOTAL_DURATION;

  // Fade: first 8% of each scene fades in, last 8% fades out
  const fadeOpacity = sceneProgress < 0.08 ? sceneProgress / 0.08 : sceneProgress > 0.92 ? (1 - sceneProgress) / 0.08 : 1;

  const extractFields = [
    { label: 'Carrier', value: 'Hartford' },
    { label: 'Policy #', value: 'HF-GL-440291' },
    { label: 'Type', value: 'General Liability' },
    { label: 'Per Occurrence', value: '$1,000,000' },
    { label: 'Aggregate', value: '$2,000,000' },
    { label: 'Premium', value: '$3,200/yr' },
    { label: 'Renewal', value: 'Jun 1, 2026' },
  ];

  return (
    <section ref={containerRef} style={{ padding: '0 24px 80px', background: '#fff' }}>
      <div style={{ maxWidth: 720, margin: '0 auto' }}>
        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-text-muted)', letterSpacing: '0.04em' }}>
            See how layered coverage becomes visible in seconds
          </span>
        </div>

        <div style={{
          borderRadius: 16, overflow: 'hidden', border: '1px solid #e5e7eb',
          boxShadow: '0 8px 32px rgba(0,0,0,0.08)',
          backgroundColor: '#111827',
        }}>
          {/* Browser chrome */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 8, padding: '10px 16px',
            backgroundColor: '#1f2937', borderBottom: '1px solid #374151',
          }}>
            <div style={{ display: 'flex', gap: 6 }}>
              <div style={{ width: 10, height: 10, borderRadius: '50%', backgroundColor: '#ef4444' }} />
              <div style={{ width: 10, height: 10, borderRadius: '50%', backgroundColor: '#f59e0b' }} />
              <div style={{ width: 10, height: 10, borderRadius: '50%', backgroundColor: '#22c55e' }} />
            </div>
            <div style={{
              flex: 1, textAlign: 'center', fontSize: 11, color: '#9ca3af',
              backgroundColor: '#374151', padding: '4px 12px', borderRadius: 6, marginLeft: 24, marginRight: 24,
            }}>
              app.covrabl.com
            </div>
          </div>

          {/* Screen content */}
          <div style={{ padding: '20px 28px', minHeight: 300, maxHeight: 360, backgroundColor: '#f8f9fa', position: 'relative', overflow: 'hidden' }}>
            <div style={{ opacity: fadeOpacity, transition: 'opacity 0.15s ease' }}>

              {/* Scene 1: Upload — shows multiple policy types */}
              {activeIdx === 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: 252 }}>
                  <div style={{
                    width: '80%', maxWidth: 400, padding: '24px 28px',
                    border: `2px dashed ${sceneProgress > 0.3 ? '#2563eb' : '#d1d5db'}`,
                    borderRadius: 12, textAlign: 'center', backgroundColor: '#fff',
                    transition: 'border-color 0.5s',
                  }}>
                    <div style={{ fontSize: 36, marginBottom: 10 }}>{sceneProgress > 0.4 ? '\u{1F4C4}' : '\u{2B06}\u{FE0F}'}</div>
                    <div style={{ fontSize: 14, fontWeight: 600, color: '#111827', marginBottom: 4 }}>
                      {sceneProgress > 0.4 ? 'Hartford_GL_2026.pdf' : 'Drop any policy here'}
                    </div>
                    <div style={{ fontSize: 12, color: '#9ca3af' }}>
                      {sceneProgress > 0.4 ? '1.8 MB' : 'Personal, commercial, or professional'}
                    </div>
                    {sceneProgress > 0.3 && sceneProgress <= 0.6 && (
                      <div style={{ marginTop: 14, height: 4, backgroundColor: '#e5e7eb', borderRadius: 2, overflow: 'hidden' }}>
                        <div style={{ height: '100%', width: `${Math.min((sceneProgress - 0.3) * 333, 100)}%`, backgroundColor: '#2563eb', borderRadius: 2, transition: 'width 0.1s' }} />
                      </div>
                    )}
                    {sceneProgress > 0.6 && (
                      <>
                        <div style={{ marginTop: 10, fontSize: 13, fontWeight: 600, color: '#16a34a' }}>
                          {'\u2713'} Uploaded &mdash; analyzing coverage...
                        </div>
                        <div style={{ display: 'flex', gap: 6, justifyContent: 'center', marginTop: 10, flexWrap: 'wrap' }}>
                          {['GL', 'Auto', 'Umbrella', 'Property'].map((t, i) => (
                            <span key={t} style={{
                              padding: '3px 10px', borderRadius: 10, fontSize: 10, fontWeight: 600,
                              backgroundColor: i === 0 ? '#dbeafe' : '#f3f4f6',
                              color: i === 0 ? '#1d4ed8' : '#6b7280',
                              opacity: sceneProgress > 0.65 + i * 0.07 ? 1 : 0.3,
                              transition: 'opacity 0.3s',
                            }}>{t}</span>
                          ))}
                        </div>
                      </>
                    )}
                  </div>
                </div>
              )}

              {/* Scene 2: Extraction — sequential checkmarks */}
              {activeIdx === 1 && (
                <div style={{ maxWidth: 400, margin: '0 auto' }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: '#111827', marginBottom: 3 }}>AI is reading your policy...</div>
                  <div style={{ fontSize: 11, color: '#9ca3af', marginBottom: 12 }}>Hartford_GL_2026.pdf</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                    {extractFields.map((f, i) => {
                      const fieldProgress = sceneProgress * (extractFields.length + 0.5);
                      const isRevealed = fieldProgress > i;
                      const isAnimating = fieldProgress > i && fieldProgress < i + 1;
                      return (
                        <div key={f.label} style={{
                          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                          padding: '6px 12px', backgroundColor: '#fff', border: '1px solid #e5e7eb', borderRadius: 6,
                          opacity: isRevealed ? 1 : 0.3, transition: 'opacity 0.3s',
                        }}>
                          <span style={{ fontSize: 11, fontWeight: 600, color: isRevealed ? '#6b7280' : '#d1d5db', textTransform: 'uppercase', transition: 'color 0.3s' }}>{f.label}</span>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <span style={{ fontSize: 12, fontWeight: 600, color: isRevealed ? '#111827' : '#d1d5db', transition: 'color 0.3s' }}>{isRevealed ? f.value : '\u2014'}</span>
                            {isRevealed && !isAnimating && <span style={{ color: '#16a34a', fontSize: 13, fontWeight: 700 }}>{'\u2713'}</span>}
                            {isAnimating && <span style={{ color: '#2563eb', fontSize: 10, animation: 'pulse 1s infinite' }}>{'\u25CF'}</span>}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Scene 3: Ask AI — layered coverage questions */}
              {activeIdx === 2 && (
                <div style={{ maxWidth: 440, margin: '0 auto' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {sceneProgress > 0.04 && (
                      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                        <div style={{ padding: '7px 12px', backgroundColor: '#2563eb', color: '#fff', borderRadius: '12px 12px 4px 12px', fontSize: 12, maxWidth: '80%' }}>
                          Am I covered if a contractor gets hurt on my property?
                        </div>
                      </div>
                    )}
                    {sceneProgress > 0.15 && (
                      <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
                        <div style={{ padding: '7px 12px', backgroundColor: '#fff', border: '1px solid #e5e7eb', color: '#111827', borderRadius: '12px 12px 12px 4px', fontSize: 12, maxWidth: '88%', lineHeight: 1.5 }}>
                          {sceneProgress > 0.35
                            ? (<>Your Hartford GL policy (<strong>HF-GL-440291</strong>) provides <strong>$1M per occurrence</strong> for bodily injury on your premises. However, you should require contractors to carry their own workers&apos; comp.</>)
                            : (<span style={{ color: '#9ca3af' }}>Reading your policies...</span>)}
                        </div>
                      </div>
                    )}
                    {sceneProgress > 0.55 && (
                      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                        <div style={{ padding: '7px 12px', backgroundColor: '#2563eb', color: '#fff', borderRadius: '12px 12px 4px 12px', fontSize: 12, maxWidth: '80%' }}>
                          Does my umbrella extend over this GL policy?
                        </div>
                      </div>
                    )}
                    {sceneProgress > 0.7 && (
                      <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
                        <div style={{ padding: '7px 12px', backgroundColor: '#fff', border: '1px solid #e5e7eb', color: '#111827', borderRadius: '12px 12px 12px 4px', fontSize: 12, maxWidth: '88%', lineHeight: 1.5 }}>
                          {sceneProgress > 0.82
                            ? (<>Yes. Your Chubb umbrella (<strong>$2M</strong>) lists your Hartford GL as an underlying policy. It would activate after the <strong>$1M GL limit</strong> is exhausted.</>)
                            : (<span style={{ color: '#9ca3af' }}>Checking across your policies...</span>)}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Scene 4: Compliance verification */}
              {activeIdx === 3 && (
                <div style={{ maxWidth: 420, margin: '0 auto' }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: '#111827', marginBottom: 3 }}>Compliance Check</div>
                  <div style={{ fontSize: 11, color: '#9ca3af', marginBottom: 14 }}>Verifying coverage against requirements</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {[
                      { req: 'General Liability \u2265 $1,000,000', status: 'PASS', color: '#22c55e', bg: '#f0fdf4', delay: 0.1 },
                      { req: 'Additional Insured endorsement', status: 'PASS', color: '#22c55e', bg: '#f0fdf4', delay: 0.25 },
                      { req: 'Workers\u2019 Comp coverage', status: 'FAIL', color: '#ef4444', bg: '#fef2f2', delay: 0.4 },
                      { req: 'Waiver of Subrogation', status: 'UNCLEAR', color: '#f59e0b', bg: '#fffbeb', delay: 0.55 },
                      { req: 'Property Damage \u2265 $500,000', status: 'PASS', color: '#22c55e', bg: '#f0fdf4', delay: 0.7 },
                    ].map(item => (
                      <div key={item.req} style={{
                        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                        padding: '8px 12px', backgroundColor: sceneProgress > item.delay ? item.bg : '#fff',
                        border: '1px solid #e5e7eb', borderRadius: 6,
                        opacity: sceneProgress > item.delay ? 1 : 0.3, transition: 'all 0.4s',
                      }}>
                        <span style={{ fontSize: 12, color: '#374151', fontWeight: 500 }}>{item.req}</span>
                        <span style={{
                          fontSize: 10, fontWeight: 700, color: item.color, padding: '2px 8px',
                          borderRadius: 4, backgroundColor: sceneProgress > item.delay ? `${item.color}15` : 'transparent',
                        }}>
                          {sceneProgress > item.delay ? item.status : '\u2014'}
                        </span>
                      </div>
                    ))}
                  </div>
                  {sceneProgress > 0.8 && (
                    <div style={{
                      marginTop: 10, padding: '8px 12px', backgroundColor: '#fef2f2', borderRadius: 6,
                      borderLeft: '3px solid #ef4444', fontSize: 11, color: '#991b1b', lineHeight: 1.4,
                    }}>
                      1 requirement failed. Workers&apos; Comp not found in uploaded policies.
                    </div>
                  )}
                </div>
              )}

              {/* Scene 5: Emergency Card — slightly smaller, safety feature feel */}
              {activeIdx === 4 && (
                <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: 252 }}>
                  <div style={{
                    width: 280, backgroundColor: '#fff', borderRadius: 14, padding: 18,
                    border: '1px solid #e5e7eb', boxShadow: '0 4px 16px rgba(0,0,0,0.06)',
                  }}>
                    <div style={{ textAlign: 'center', marginBottom: 12 }}>
                      <div style={{ fontSize: 22, marginBottom: 4 }}>{'\u{1F6D1}'}</div>
                      <div style={{ fontSize: 14, fontWeight: 700, color: '#111827' }}>Emergency Card</div>
                      <div style={{ fontSize: 11, color: '#9ca3af' }}>Instant access &mdash; no login needed</div>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                      {[
                        { icon: '\u{1F697}', type: 'Auto', carrier: 'State Farm', number: 'SF-8834201' },
                        { icon: '\u{1F3E0}', type: 'Home', carrier: 'Allstate', number: 'AL-7729104' },
                      ].map((p, i) => (
                        <div key={i} style={{
                          display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px',
                          backgroundColor: '#f9fafb', borderRadius: 8,
                          opacity: sceneProgress > 0.15 + i * 0.2 ? 1 : 0.15, transition: 'opacity 0.4s',
                        }}>
                          <span style={{ fontSize: 14 }}>{p.icon}</span>
                          <div style={{ flex: 1 }}>
                            <div style={{ fontSize: 11, fontWeight: 600, color: '#111827' }}>{p.carrier}</div>
                            <div style={{ fontSize: 10, color: '#9ca3af' }}>{p.type} {'\u00B7'} {p.number}</div>
                          </div>
                        </div>
                      ))}
                    </div>
                    {sceneProgress > 0.4 && (
                      <div style={{
                        marginTop: 6, padding: '6px 10px', backgroundColor: '#f0f9ff', borderRadius: 8,
                        display: 'flex', alignItems: 'center', gap: 8,
                        opacity: sceneProgress > 0.4 ? 1 : 0, transition: 'opacity 0.4s',
                      }}>
                        <span style={{ fontSize: 12 }}>{'\u{1F4DE}'}</span>
                        <div>
                          <div style={{ fontSize: 10, fontWeight: 600, color: '#1e40af' }}>Your Agent: Mike Johnson</div>
                          <div style={{ fontSize: 9, color: '#6b7280' }}>ABC Insurance &middot; (555) 012-3456</div>
                        </div>
                      </div>
                    )}
                    {sceneProgress > 0.55 && (
                      <div style={{ marginTop: 5, padding: '5px 10px', backgroundColor: '#ecfdf5', borderRadius: 8, textAlign: 'center' }}>
                        <div style={{ fontSize: 10, fontWeight: 600, color: '#059669' }}>Emergency Contact: 555-0199</div>
                      </div>
                    )}
                    {sceneProgress > 0.7 && (
                      <div style={{ marginTop: 4, textAlign: 'center', fontSize: 9, color: '#9ca3af' }}>
                        Share via link or add to phone wallet
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Scene 6: Summary — three pillars */}
              {activeIdx === 5 && (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: 252, textAlign: 'center' }}>
                  <div style={{ fontSize: 20, fontWeight: 700, color: '#111827', marginBottom: 20 }}>
                    Layered coverage, finally visible
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 24, alignItems: 'flex-start' }}>
                    {[
                      { text: 'See what you actually have \u2014 across every policy', delay: 0.05 },
                      { text: 'Verify what\u2019s required \u2014 compliance in seconds', delay: 0.2 },
                      { text: 'Stay ahead of changes \u2014 renewals, gaps, alerts', delay: 0.35 },
                      { text: 'Access everything in an emergency', delay: 0.5 },
                    ].map((item, i) => (
                      <div key={i} style={{
                        display: 'flex', alignItems: 'center', gap: 10,
                        opacity: sceneProgress > item.delay ? 1 : 0,
                        transform: sceneProgress > item.delay ? 'translateX(0)' : 'translateX(-10px)',
                        transition: 'all 0.4s ease',
                      }}>
                        <span style={{ color: '#16a34a', fontSize: 16, fontWeight: 700 }}>{'\u2713'}</span>
                        <span style={{ fontSize: 14, fontWeight: 500, color: '#374151' }}>{item.text}</span>
                      </div>
                    ))}
                  </div>
                  {sceneProgress > 0.65 && (
                    <button
                      onClick={() => { trackClick('landing_demo_start_free'); router.push('/login'); }}
                      style={{
                        padding: '10px 28px', fontSize: 14, fontWeight: 600,
                        backgroundColor: 'var(--color-primary)', color: '#fff',
                        border: 'none', borderRadius: 'var(--radius-md)', cursor: 'pointer',
                        opacity: sceneProgress > 0.65 ? 1 : 0,
                        transition: 'opacity 0.4s',
                      }}
                    >
                      Start Free
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Bottom bar: label + scene indicators + progress */}
          <div style={{ backgroundColor: '#111827' }}>
            <div style={{
              padding: '12px 20px',
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: '#3fa7a3', fontVariantNumeric: 'tabular-nums' }}>
                  {activeIdx + 1}/{DEMO_SCENES.length}
                </span>
                <span style={{ fontSize: 13, fontWeight: 500, color: '#e5e7eb' }}>{scene.label}</span>
              </div>
              <div style={{ display: 'flex', gap: 4 }}>
                {DEMO_SCENES.map((_, i) => (
                  <div key={i} style={{
                    width: i === activeIdx ? 20 : 6, height: 6, borderRadius: 3,
                    backgroundColor: i < activeIdx ? '#3fa7a3' : i === activeIdx ? '#fff' : '#374151',
                    transition: 'all 0.3s',
                  }} />
                ))}
              </div>
            </div>
            {/* Overall progress bar */}
            <div style={{ height: 3, backgroundColor: '#1f2937' }}>
              <div style={{
                height: '100%', width: `${overallProgress * 100}%`,
                backgroundColor: '#3fa7a3',
                transition: 'width 0.05s linear',
              }} />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ── Authenticated Dashboard ────────────────────────── */
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

  const scoreValue = scores?.overall_score ?? 0;
  const healthStatus = scoreValue >= 70
    ? { label: 'Good Standing', color: '#166534', bg: '#dcfce7', icon: '\u2713' }
    : scoreValue >= 40
    ? { label: 'Needs Review', color: '#92400e', bg: '#fef3c7', icon: '!' }
    : { label: 'Action Needed', color: '#991b1b', bg: '#fee2e2', icon: '\u26A0' };
  const unackCount = alerts?.unacknowledged_count ?? 0;
  const renewalPolicies = renewals?.policies?.slice(0, 3) ?? [];
  const activeCount = policies.filter(p => p.status !== 'archived').length;
  const activePolicies = policies.filter(p => p.status !== 'archived' && p.status !== 'expired');

  // Categorize and sort policies
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

  // Coverage insights from score recommendations
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
          {/* ── Section 1: Coverage Status Bar ── */}
          <div
            onClick={() => router.push('/score')}
            style={{
              padding: '14px 20px', marginBottom: 20, cursor: 'pointer',
              backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)',
              borderLeft: `4px solid ${healthStatus.color}`,
              borderRadius: 'var(--radius-md)',
              display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
            }}
          >
            <div style={{
              width: 32, height: 32, borderRadius: '50%', flexShrink: 0,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              backgroundColor: healthStatus.bg, color: healthStatus.color,
              fontSize: 16, fontWeight: 700,
            }}>
              {healthStatus.icon}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--color-text)' }}>Coverage Status: </span>
              <span style={{ fontSize: 14, fontWeight: 600, color: healthStatus.color }}>{healthStatus.label}</span>
              <span style={{ fontSize: 13, color: 'var(--color-text-muted)', marginLeft: 12 }}>
                {activeCount} active {activeCount === 1 ? 'policy' : 'policies'}
                {unackCount > 0 && <> &middot; <span style={{ color: 'var(--color-danger)', fontWeight: 600 }}>{unackCount} alert{unackCount !== 1 ? 's' : ''}</span></>}
              </span>
            </div>
            <span style={{ fontSize: 12, color: 'var(--color-primary)', fontWeight: 600, whiteSpace: 'nowrap' }}>
              View details &rarr;
            </span>
          </div>

          {/* ── Section 2: Important Alerts (only when items need attention) ── */}
          {hasAttention && (
            <div className="card" style={{ padding: 20, marginBottom: 20 }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--color-text)', marginBottom: 12 }}>Needs Attention</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {alerts?.items?.slice(0, 3).map(d => (
                  <div key={`a-${d.id}`} onClick={() => router.push('/audit')} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13, color: 'var(--color-text-secondary)', cursor: 'pointer' }}>
                    <span style={{
                      width: 7, height: 7, borderRadius: '50%', flexShrink: 0,
                      backgroundColor: d.severity === 'critical' ? 'var(--color-danger)' : d.severity === 'warning' ? 'var(--color-warning)' : 'var(--color-text-muted)',
                    }} />
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {d.policy_carrier || 'Policy'}: {d.field_key} {d.delta_type}
                    </span>
                  </div>
                ))}
                {urgentRenewals.map(rp => (
                  <div key={`r-${rp.id}`} onClick={() => router.push('/renewals')} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13, color: 'var(--color-text-secondary)', cursor: 'pointer' }}>
                    <span style={{
                      width: 7, height: 7, borderRadius: '50%', flexShrink: 0,
                      backgroundColor: rp.days_until_renewal <= 14 ? 'var(--color-danger)' : 'var(--color-warning)',
                    }} />
                    <span>
                      {rp.nickname || `${rp.carrier} ${rp.policy_type}`} — {rp.days_until_renewal <= 0 ? 'Renewal overdue' : `Renews in ${rp.days_until_renewal} days`}
                    </span>
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

          {/* ── Section 3: Your Policies (categorized) ── */}
          {(() => {
            const renderPolicyCard = (p: Policy) => {
              const cfg = POLICY_TYPE_CONFIG[p.policy_type] || { icon: '\ud83d\udccb', label: p.policy_type };
              const renewalInfo = p.renewal_date ? (() => {
                const days = Math.ceil((new Date(p.renewal_date).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
                if (days < 0) return { label: 'Overdue', color: 'var(--color-danger)' };
                if (days <= 14) return { label: `${days}d left`, color: 'var(--color-danger)' };
                if (days <= 30) return { label: `${days}d left`, color: 'var(--color-warning-dark)' };
                return { label: new Date(p.renewal_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }), color: 'var(--color-text-muted)' };
              })() : null;

              return (
                <div
                  key={p.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => router.push(`/policies/${p.id}`)}
                  onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); router.push(`/policies/${p.id}`); } }}
                  style={{
                    backgroundColor: '#fff', border: '1px solid var(--color-border)',
                    borderRadius: 'var(--radius-lg)', cursor: 'pointer',
                    padding: 20, display: 'flex', flexDirection: 'column', gap: 10,
                    transition: 'border-color 0.15s, box-shadow 0.15s',
                  }}
                  onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--color-primary)'; e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,0,0,0.06)'; }}
                  onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--color-border)'; e.currentTarget.style.boxShadow = 'none'; }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span style={{ fontSize: 24 }}>{cfg.icon}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {p.nickname || p.carrier}
                      </div>
                      <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 1 }}>
                        {cfg.label}
                      </div>
                    </div>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
                    <div>
                      <div style={{ fontSize: 11, color: 'var(--color-text-muted)', fontWeight: 500 }}>Premium</div>
                      <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--color-text)' }}>
                        {p.premium_amount ? `$${p.premium_amount.toLocaleString()}` : '\u2014'}
                      </div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontSize: 11, color: 'var(--color-text-muted)', fontWeight: 500 }}>Expiration</div>
                      <div style={{ fontSize: 13, fontWeight: 600, color: renewalInfo?.color || 'var(--color-text)' }}>
                        {renewalInfo ? renewalInfo.label : '\u2014'}
                      </div>
                    </div>
                  </div>
                </div>
              );
            };

            const addPolicyCard = (
              <div
                role="button"
                tabIndex={0}
                onClick={() => router.push('/policies?action=upload')}
                onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); router.push('/policies?action=upload'); } }}
                style={{
                  border: '2px dashed var(--color-border)', borderRadius: 'var(--radius-lg)',
                  cursor: 'pointer', padding: 20, display: 'flex', flexDirection: 'column',
                  alignItems: 'center', justifyContent: 'center', gap: 8, minHeight: 120,
                  transition: 'border-color 0.15s, background-color 0.15s',
                }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--color-primary)'; e.currentTarget.style.backgroundColor = 'rgba(13,148,136,0.03)'; }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--color-border)'; e.currentTarget.style.backgroundColor = 'transparent'; }}
              >
                <span style={{ fontSize: 28, color: 'var(--color-text-muted)' }}>+</span>
                <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-text-muted)' }}>Add Policy</span>
              </div>
            );

            return (
              <div style={{ marginBottom: 20 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
                  <h2 style={{ margin: 0, fontSize: 17, fontWeight: 700, color: 'var(--color-text)' }}>Your Policies</h2>
                  {activePolicies.length > 0 && (
                    <span onClick={() => router.push('/policies')} style={{ fontSize: 12, color: 'var(--color-primary)', fontWeight: 600, cursor: 'pointer' }}>
                      Manage all &rarr;
                    </span>
                  )}
                </div>

                {activePolicies.length === 0 ? (
                  <div className="card" style={{ padding: 48, textAlign: 'center' }}>
                    <div style={{ fontSize: 40, marginBottom: 12 }}>{'\ud83d\udcc4'}</div>
                    <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--color-text)', marginBottom: 8 }}>No policies yet</div>
                    <div style={{ fontSize: 14, color: 'var(--color-text-muted)', marginBottom: 20 }}>Upload your first policy to get started with coverage analysis.</div>
                    <button onClick={() => router.push('/policies?action=upload')} className="btn btn-primary" style={{ padding: '10px 24px', fontSize: 14 }}>
                      Upload Your First Policy
                    </button>
                  </div>
                ) : (
                  <>
                    {/* Personal Policies */}
                    {personalPolicies.length > 0 && (
                      <div style={{ marginBottom: businessGroups.length > 0 ? 24 : 0 }}>
                        <h3 style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-text-secondary)', margin: '0 0 10px', textTransform: 'uppercase', letterSpacing: 0.5 }}>
                          Personal Policies ({personalPolicies.length})
                        </h3>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 16 }}>
                          {personalPolicies.map(renderPolicyCard)}
                          {businessGroups.length === 0 && addPolicyCard}
                        </div>
                      </div>
                    )}

                    {/* Business Policies — grouped by business name */}
                    {businessGroups.length > 0 && (
                      <div>
                        <h3 style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-text-secondary)', margin: '0 0 10px', textTransform: 'uppercase', letterSpacing: 0.5 }}>
                          Business Policies
                        </h3>
                        {businessGroups.map(group => (
                          <div key={group.name} style={{ marginBottom: 16 }}>
                            <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--color-text)', marginBottom: 8, paddingLeft: 2 }}>
                              {group.name} ({group.policies.length})
                            </div>
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 16 }}>
                              {group.policies.map(renderPolicyCard)}
                            </div>
                          </div>
                        ))}
                        {addPolicyCard}
                      </div>
                    )}

                    {/* If only personal, add policy card is inline; if no personal but has business, add is below business */}
                    {personalPolicies.length === 0 && businessGroups.length === 0 && addPolicyCard}
                  </>
                )}
              </div>
            );
          })()}

          {/* ── Section 4: Coverage Insights (advisory) ── */}
          {topInsights.length > 0 && (
            <div style={{
              padding: '16px 20px', marginBottom: 20,
              backgroundColor: 'var(--color-bg)', border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius-md)',
            }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--color-text)', marginBottom: 10 }}>Coverage Insights</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {topInsights.map((ins, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13, color: 'var(--color-text-secondary)' }}>
                    <span style={{
                      padding: '1px 8px', borderRadius: 10, fontSize: 10, fontWeight: 600, flexShrink: 0,
                      backgroundColor: ins.priority === 'high' ? 'var(--color-danger-light)' : ins.priority === 'medium' ? 'var(--color-warning-light)' : 'var(--color-info-light)',
                      color: ins.priority === 'high' ? 'var(--color-danger-dark)' : ins.priority === 'medium' ? 'var(--color-warning-dark)' : 'var(--color-info-dark)',
                    }}>
                      {ins.priority}
                    </span>
                    <span>{ins.text}</span>
                  </div>
                ))}
              </div>
              <div style={{ marginTop: 10 }}>
                <span onClick={() => router.push('/score')} style={{ fontSize: 12, color: 'var(--color-primary)', fontWeight: 600, cursor: 'pointer' }}>
                  View coverage details &rarr;
                </span>
              </div>
            </div>
          )}

          {/* ── Section 5: Quick Actions ── */}
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 20 }}>
            <button onClick={() => router.push('/chat')} className="btn btn-outline" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: 14 }}>&#10024;</span> Ask AI
            </button>
            <button onClick={() => router.push('/policies/compare')} className="btn btn-outline">
              Compare Policies
            </button>
          </div>

          {/* ── Section 6: Security Trust Banner ── */}
          <div style={{
            padding: '12px 20px', marginBottom: 28,
            backgroundColor: '#f0fdf4', border: '1px solid #bbf7d0',
            borderRadius: 'var(--radius-md)',
            display: 'flex', alignItems: 'center', gap: 10,
            fontSize: 12, color: '#166534',
          }}>
            <span style={{ fontSize: 16 }}>&#128274;</span>
            <span><strong>Secure Policy Vault</strong> — Your documents are encrypted and stored privately. Only you control access.</span>
            <span onClick={() => router.push('/security')} style={{ marginLeft: 'auto', cursor: 'pointer', fontWeight: 600, whiteSpace: 'nowrap' }}>
              Security &amp; Privacy &rarr;
            </span>
          </div>
        </>
      )}
    </div>
  );
}

export default function Home() {
  const { token } = useAuth();
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

  const ctaAction = () => { trackClick('landing_cta_primary'); router.push(showAsPublic ? '/login' : '/policies'); };
  const ctaLabel = showAsPublic ? 'Analyze Your Coverage Free' : 'View My Coverage';

  /* Scroll-reveal refs for each animated section */
  const step1Ref = useScrollReveal();
  const step2Ref = useScrollReveal();
  const step3Ref = useScrollReveal();
  const step4Ref = useScrollReveal();
  const emergencyRef = useScrollReveal();

  /* Timeline fill tracker */
  const { containerRef: timelineContainer, lineRef: timelineLine, activeDots } = useTimelineFill();

  // Authenticated users see the dashboard (unless arriving via tenant referral or preview)
  if (token && !isReferral && !isPreview) return <Dashboard />;

  return (
    <div style={{ minHeight: '100vh', background: '#fff' }}>
      {/* ═══════════════════════════════════════════════════════════════
          ANNOUNCEMENT BAR
      ═══════════════════════════════════════════════════════════════ */}
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

      {/* ═══════════════════════════════════════════════════════════════
          NAVIGATION
      ═══════════════════════════════════════════════════════════════ */}
      {showAsPublic && (
        <header className="landing-header" style={{
          position: 'fixed', top: showAnnouncement ? 36 : 0, left: 0, right: 0, zIndex: 100,
          background: 'rgba(255,255,255,0.95)', backdropFilter: 'blur(8px)',
          borderBottom: '1px solid var(--color-border)',
          padding: '12px 24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        }}>
          <div
            onClick={() => { trackClick('landing_logo_click'); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
            style={{ cursor: 'pointer' }}
          >
            <Logo size="md" variant="dark" />
          </div>
          <nav className="landing-nav-links">
            <span onClick={() => { trackClick('landing_nav_how_it_works'); scrollTo('how-it-works'); }} style={{ fontSize: 14, color: 'var(--color-text-secondary)', cursor: 'pointer' }}>How it works</span>
            <span onClick={() => { trackClick('landing_nav_pricing'); router.push('/pricing'); }} style={{ fontSize: 14, color: 'var(--color-text-secondary)', cursor: 'pointer' }}>Pricing</span>
            <span onClick={() => { trackClick('landing_nav_faq'); scrollTo('faq'); }} style={{ fontSize: 14, color: 'var(--color-text-secondary)', cursor: 'pointer' }}>FAQ</span>
            <button onClick={() => { trackClick('landing_nav_sign_in'); router.push('/login'); }} style={{
              padding: '8px 20px', fontSize: 14, fontWeight: 600,
              backgroundColor: 'var(--color-primary)', color: '#fff',
              border: 'none', borderRadius: 'var(--radius-md)', cursor: 'pointer',
            }}>
              Sign in
            </button>
          </nav>
          {/* Hamburger menu button — mobile only */}
          <button
            className="hamburger-btn"
            onClick={() => { trackClick('landing_hamburger_toggle'); setMobileMenuOpen(!mobileMenuOpen); }}
            aria-label="Toggle navigation menu"
            style={{
              display: 'none', background: 'none', border: 'none', cursor: 'pointer', padding: 4,
              flexDirection: 'column', gap: 5, justifyContent: 'center',
            }}
          >
            <span style={{ display: 'block', width: 22, height: 2, backgroundColor: 'var(--color-text)', borderRadius: 1, transition: 'transform 0.2s' }} />
            <span style={{ display: 'block', width: 22, height: 2, backgroundColor: 'var(--color-text)', borderRadius: 1, transition: 'opacity 0.2s' }} />
            <span style={{ display: 'block', width: 22, height: 2, backgroundColor: 'var(--color-text)', borderRadius: 1, transition: 'transform 0.2s' }} />
          </button>
        </header>
      )}

      {/* Mobile menu dropdown */}
      {showAsPublic && mobileMenuOpen && (
        <div className="mobile-menu-dropdown" style={{
          position: 'fixed', top: 52, left: 0, right: 0, zIndex: 99,
          background: '#fff', borderBottom: '1px solid var(--color-border)',
          boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
          padding: '12px 24px',
          display: 'flex', flexDirection: 'column', gap: 4,
        }}>
          <button onClick={() => { trackClick('landing_mobile_how_it_works'); scrollTo('how-it-works'); }} style={{ padding: '12px 0', background: 'none', border: 'none', fontSize: 15, color: 'var(--color-text)', cursor: 'pointer', textAlign: 'left' }}>
            How it works
          </button>
          <button onClick={() => { trackClick('landing_mobile_pricing'); router.push('/pricing'); setMobileMenuOpen(false); }} style={{ padding: '12px 0', background: 'none', border: 'none', fontSize: 15, color: 'var(--color-text)', cursor: 'pointer', textAlign: 'left' }}>
            Pricing
          </button>
          <button onClick={() => { trackClick('landing_mobile_faq'); scrollTo('faq'); }} style={{ padding: '12px 0', background: 'none', border: 'none', fontSize: 15, color: 'var(--color-text)', cursor: 'pointer', textAlign: 'left' }}>
            FAQ
          </button>
          <button onClick={() => { trackClick('landing_mobile_sign_in'); router.push('/login'); setMobileMenuOpen(false); }} style={{
            padding: '10px 20px', fontSize: 15, fontWeight: 600, marginTop: 4,
            backgroundColor: 'var(--color-primary)', color: '#fff',
            border: 'none', borderRadius: 'var(--radius-md)', cursor: 'pointer', textAlign: 'center',
          }}>
            Sign in
          </button>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════
          1. HERO
      ═══════════════════════════════════════════════════════════════ */}
      <section style={{
        paddingTop: showAsPublic ? (showAnnouncement ? 156 : 120) : 60, paddingBottom: 80, paddingLeft: 24, paddingRight: 24,
        background: 'linear-gradient(160deg, #0f1f33 0%, var(--color-primary-dark) 30%, var(--color-primary) 70%, var(--color-primary-light) 100%)',
        color: '#fff',
        position: 'relative',
        overflow: 'hidden',
      }}>
        <div style={{
          position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
          background: 'radial-gradient(ellipse at 70% 20%, rgba(63,167,163,0.12) 0%, transparent 60%)',
          pointerEvents: 'none',
        }} />
        <div style={{ maxWidth: 900, margin: '0 auto', textAlign: 'center', position: 'relative' }}>
          <div style={{ marginBottom: 28 }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/brand/covrabl-mark.svg"
              alt="Covrabl"
              width={64}
              height={64}
              style={{ display: 'inline-block', opacity: 0.9 }}
            />
            <div style={{
              fontSize: 22, fontWeight: 700, marginTop: 12,
              letterSpacing: 'var(--letter-spacing-tight)',
              fontFamily: 'var(--font-heading)',
            }}>
              COVRABL
            </div>
          </div>
          <h1 style={{
            fontSize: 48, fontWeight: 700, margin: '0 0 20px', lineHeight: 1.15,
            letterSpacing: 'var(--letter-spacing-tight)',
            fontFamily: 'var(--font-heading)',
          }}>
            Finally understand what your insurance actually covers.
          </h1>
          <p style={{ fontSize: 18, opacity: 0.95, margin: '0 0 8px', lineHeight: 1.7, maxWidth: 720, marginLeft: 'auto', marginRight: 'auto', fontWeight: 500 }}>
            Covrabl analyzes your policies and shows you what&apos;s covered, what isn&apos;t, and where you may still have risk.
          </p>
          <p style={{ fontSize: 15, opacity: 0.7, margin: '0 0 8px', lineHeight: 1.7, maxWidth: 650, marginLeft: 'auto', marginRight: 'auto', letterSpacing: 'var(--letter-spacing-wide)' }}>
            No legal jargon. No 200-page documents. Just clear explanations of what you&apos;re actually covered for.
          </p>
          <p style={{ fontSize: 15, opacity: 0.7, margin: '0 0 36px', lineHeight: 1.7, maxWidth: 600, marginLeft: 'auto', marginRight: 'auto', letterSpacing: 'var(--letter-spacing-wide)' }}>
            Free for up to 3 policies. No credit card required.
          </p>
          <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap', marginBottom: 36 }}>
            <button onClick={ctaAction} style={{
              padding: '14px 36px', fontSize: 16, fontWeight: 600,
              backgroundColor: 'var(--color-secondary)', color: '#fff',
              border: 'none', borderRadius: 'var(--radius-md)', cursor: 'pointer',
              boxShadow: '0 4px 14px rgba(63, 167, 163, 0.3)',
              transition: 'transform 0.15s, box-shadow 0.15s',
            }}>
              {ctaLabel}
            </button>
            <button onClick={() => { trackClick('landing_cta_how_it_works'); scrollTo('how-it-works'); }} style={{
              padding: '14px 32px', fontSize: 16, fontWeight: 500,
              backgroundColor: 'rgba(255,255,255,0.08)', color: '#fff',
              border: '1px solid rgba(255,255,255,0.2)', borderRadius: 'var(--radius-md)', cursor: 'pointer',
              backdropFilter: 'blur(4px)',
              transition: 'background 0.15s',
            }}>
              See how it works
            </button>
          </div>
          <div style={{ display: 'flex', gap: 32, justifyContent: 'center', flexWrap: 'wrap', fontSize: 13, opacity: 0.6, letterSpacing: 'var(--letter-spacing-wide)' }}>
            <span>Not an insurance company</span>
            <span>We never sell insurance</span>
            <span>Your data stays yours</span>
          </div>
          <div style={{ marginTop: 20, fontSize: 14, opacity: 0.5, letterSpacing: 'var(--letter-spacing-wide)' }}>
            Works across all your insurance — home, auto, umbrella, business, specialty, and more.
          </div>
        </div>
      </section>

      {/* ═══════════════════════════════════════════════════════════════
          1b. PRODUCT DEMO (auto-playing simulation)
      ═══════════════════════════════════════════════════════════════ */}
      <ProductDemo />

      {/* ═══════════════════════════════════════════════════════════════
          1c. STATIC COMPLIANCE PREVIEW
      ═══════════════════════════════════════════════════════════════ */}
      <section style={{ padding: '0 24px 80px', background: '#fff' }}>
        <div style={{ maxWidth: 520, margin: '0 auto' }}>
          <div style={{ textAlign: 'center', marginBottom: 20 }}>
            <h3 style={{ fontSize: 18, fontWeight: 700, color: 'var(--color-text)', margin: '0 0 6px' }}>Verify compliance in seconds</h3>
            <p style={{ fontSize: 13, color: 'var(--color-text-muted)', margin: 0 }}>
              Upload requirements from a lease, contract, or vendor agreement — Covrabl checks your policies automatically.
            </p>
          </div>
          <div style={{
            border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)',
            overflow: 'hidden', backgroundColor: '#fff',
            boxShadow: '0 2px 8px rgba(0,0,0,0.04)',
          }}>
            <div style={{ padding: '10px 16px', backgroundColor: 'var(--color-bg)', borderBottom: '1px solid var(--color-border)', fontSize: 12, fontWeight: 600, color: 'var(--color-text-secondary)' }}>
              Sample Compliance Output
            </div>
            {[
              { req: 'General Liability \u2265 $1,000,000', status: 'Pass', color: '#22c55e', bg: '#f0fdf4' },
              { req: 'Additional Insured endorsement', status: 'Pass', color: '#22c55e', bg: '#f0fdf4' },
              { req: 'Workers\u2019 Compensation coverage', status: 'Fail', color: '#ef4444', bg: '#fef2f2' },
              { req: 'Waiver of Subrogation', status: 'Unclear', color: '#f59e0b', bg: '#fffbeb' },
            ].map((item, i) => (
              <div key={i} style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                padding: '10px 16px', borderBottom: i < 3 ? '1px solid var(--color-border)' : 'none',
              }}>
                <span style={{ fontSize: 13, color: 'var(--color-text)' }}>{item.req}</span>
                <span style={{
                  fontSize: 11, fontWeight: 700, color: item.color, padding: '2px 10px',
                  borderRadius: 4, backgroundColor: item.bg,
                }}>{item.status}</span>
              </div>
            ))}
            <div style={{ padding: '8px 16px', backgroundColor: 'var(--color-bg)', fontSize: 11, color: 'var(--color-text-muted)' }}>
              <strong>Unclear</strong> means the uploaded documents did not provide definitive evidence.
            </div>
          </div>
        </div>
      </section>

      {/* ═══════════════════════════════════════════════════════════════
          REAL COVERAGE GAPS — concrete examples
      ═══════════════════════════════════════════════════════════════ */}
      <section style={{ padding: '72px 24px', background: 'var(--color-surface)' }}>
        <div style={{ maxWidth: 880, margin: '0 auto' }}>
          <h2 style={{ fontSize: 26, fontWeight: 700, margin: '0 0 8px', textAlign: 'center', color: 'var(--color-text)' }}>
            Gaps your policy won&apos;t tell you about
          </h2>
          <p style={{ fontSize: 15, color: 'var(--color-text-muted)', textAlign: 'center', margin: '0 0 40px' }}>
            These are real coverage gaps Covrabl users have discovered in their policies.
          </p>
          <div className="landing-trust" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 20 }}>
            {[
              {
                icon: '\u26A0\uFE0F',
                gap: 'Umbrella requires higher auto limits',
                detail: 'Your umbrella policy requires $500K auto liability, but your auto policy only has $300K. A claim over $300K would leave you exposed.',
                color: '#dc2626',
              },
              {
                icon: '\u{1F3E0}',
                gap: 'Home replacement below rebuild cost',
                detail: 'Your dwelling coverage is $320K, but construction costs in your area suggest $410K to rebuild. A total loss could leave a $90K gap.',
                color: '#d97706',
              },
              {
                icon: '\u{1F3E2}',
                gap: 'Rental property excluded from umbrella',
                detail: 'Your rental property liability isn\'t listed as an underlying policy on your umbrella. A tenant lawsuit could bypass your excess coverage entirely.',
                color: '#dc2626',
              },
            ].map(g => (
              <div key={g.gap} style={{
                backgroundColor: '#fff', border: '1px solid var(--color-border)',
                borderRadius: 'var(--radius-lg)', padding: '24px 20px',
                borderLeft: `4px solid ${g.color}`,
              }}>
                <div style={{ fontSize: 24, marginBottom: 10 }}>{g.icon}</div>
                <h4 style={{ fontSize: 14, fontWeight: 700, margin: '0 0 8px', color: 'var(--color-text)' }}>{g.gap}</h4>
                <p style={{ fontSize: 13, color: 'var(--color-text-secondary)', margin: 0, lineHeight: 1.6 }}>{g.detail}</p>
              </div>
            ))}
          </div>
          <div style={{ textAlign: 'center', marginTop: 32 }}>
            <button onClick={() => { trackClick('landing_gaps_cta'); router.push('/login'); }} style={{
              padding: '12px 28px', fontSize: 15, fontWeight: 600,
              backgroundColor: 'var(--color-primary)', color: '#fff',
              border: 'none', borderRadius: 'var(--radius-md)', cursor: 'pointer',
            }}>
              Check your coverage for gaps
            </button>
          </div>
        </div>
      </section>

      {/* ═══════════════════════════════════════════════════════════════
          2. HOW IT WORKS (4 steps — animated)
      ═══════════════════════════════════════════════════════════════ */}
      <section id="how-it-works" style={{ padding: '80px 24px', background: '#fff' }}>
        <div style={{ maxWidth: 960, margin: '0 auto' }}>
          <h2 style={{ fontSize: 28, fontWeight: 700, margin: '0 0 10px', textAlign: 'center', color: 'var(--color-text)' }}>
            How it works
          </h2>
          <p style={{ fontSize: 15, color: 'var(--color-text-secondary)', textAlign: 'center', margin: '0 0 56px', maxWidth: 580, marginLeft: 'auto', marginRight: 'auto' }}>
            Upload any policy — personal or business. Covrabl reads it, explains what it covers in plain English, and shows you where you may still be exposed.
          </p>

          {/* Timeline container — wraps all 4 steps */}
          <div ref={timelineContainer} style={{ position: 'relative' }}>
            {/* Vertical timeline line (desktop only) */}
            <div className="how-it-works-timeline">
              <div ref={timelineLine} className="timeline-line-fill" style={{ height: 0 }} />
              {/* 4 dots at 12.5%, 37.5%, 62.5%, 87.5% */}
              {[12.5, 37.5, 62.5, 87.5].map((pct, i) => (
                <div
                  key={i}
                  className={`timeline-dot${activeDots[i] ? ' active' : ''}`}
                  style={{ top: `${pct}%` }}
                />
              ))}
            </div>

            {/* ── Step 1: Add your insurance ─────────────────── */}
            <div ref={step1Ref} className="landing-steps" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 48, alignItems: 'center', marginBottom: 72 }}>
              <div>
                <div className="stagger-1" style={{ fontSize: 13, fontWeight: 700, color: 'var(--color-primary)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 12 }}>Step 1</div>
                <h3 className="stagger-2" style={{ fontSize: 22, fontWeight: 600, margin: '0 0 12px', color: 'var(--color-text)' }}>Add your insurance in seconds</h3>
                <p className="stagger-3" style={{ fontSize: 15, color: 'var(--color-text-secondary)', margin: 0, lineHeight: 1.7 }}>
                  Forward a policy email or upload a PDF. {APP_NAME} reads your documents and extracts carrier, limits, deductibles, renewal dates, and more — automatically.
                </p>
              </div>
              <div style={{
                backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)',
                borderRadius: 'var(--radius-lg)', minHeight: 280, padding: 16, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 10, boxSizing: 'border-box',
              }}>
                {/* Email forward card */}
                <div className="stagger-4" style={{
                  background: '#fff', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)',
                  padding: '10px 12px', display: 'flex', alignItems: 'center', gap: 10,
                }}>
                  <span style={{ fontSize: 20 }}>📧</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>Fwd: Your policy renewal</div>
                    <div style={{ fontSize: 10, color: 'var(--color-text-muted)', marginTop: 2 }}>From: insurance@statefarm.com</div>
                  </div>
                  <span style={{
                    fontSize: 10, fontWeight: 600, color: '#15803d', background: '#dcfce7',
                    padding: '2px 8px', borderRadius: 10, whiteSpace: 'nowrap',
                  }}>Extracted</span>
                </div>
                {/* PDF upload card */}
                <div style={{
                  background: '#fff', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)',
                  padding: '10px 12px', display: 'flex', alignItems: 'center', gap: 10,
                }}>
                  <span style={{ fontSize: 20 }}>📄</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>auto-policy-2026.pdf</div>
                    <div style={{ fontSize: 10, color: 'var(--color-text-muted)', marginTop: 2 }}>Uploaded just now</div>
                  </div>
                  <span style={{
                    fontSize: 10, fontWeight: 600, color: '#15803d', background: '#dcfce7',
                    padding: '2px 8px', borderRadius: 10, whiteSpace: 'nowrap',
                  }}>Extracted</span>
                </div>
                {/* Extracted fields */}
                <div className="stagger-5" style={{
                  background: '#fff', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)',
                  padding: '8px 12px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 14px',
                }}>
                  {[
                    { label: 'Carrier', value: 'State Farm' },
                    { label: 'Policy #', value: 'SF-8834201' },
                    { label: 'Coverage', value: '$500K / $1M' },
                    { label: 'Deductible', value: '$500' },
                    { label: 'Renewal', value: 'Mar 14, 2026' },
                    { label: 'Type', value: 'Auto' },
                  ].map(f => (
                    <div key={f.label}>
                      <div style={{ fontSize: 9, fontWeight: 600, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{f.label}</div>
                      <div style={{ fontSize: 11, fontWeight: 500, color: 'var(--color-text)', marginTop: 1 }}>{f.value}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* ── Step 2: Instant clarity ────────────────────── */}
            <div ref={step2Ref} className="landing-steps" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 48, alignItems: 'center', marginBottom: 72 }}>
              {/* Text — left side */}
              <div>
                <div className="stagger-1" style={{ fontSize: 13, fontWeight: 700, color: 'var(--color-primary)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 12 }}>Step 2</div>
                <h3 className="stagger-2" style={{ fontSize: 22, fontWeight: 600, margin: '0 0 12px', color: 'var(--color-text)' }}>AI insights you can act on</h3>
                <p className="stagger-3" style={{ fontSize: 15, color: 'var(--color-text-secondary)', margin: 0, lineHeight: 1.7 }}>
                  Complex policies are translated into clear, color-coded coverage you can actually understand. Your Coverage Overview shows where you&#39;re strong, where you&#39;re exposed, and gives you specific questions to ask your agent — without reading a single page of legalese.
                </p>
                <p className="stagger-3" style={{ fontSize: 13, color: 'var(--color-text-muted)', margin: '8px 0 0', lineHeight: 1.6 }}>
                  Every answer is based on your actual uploaded documents — not generic AI.
                </p>
              </div>
              {/* Visual — right side */}
              <div style={{
                backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)',
                borderRadius: 'var(--radius-lg)', minHeight: 280, padding: 16, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 10, boxSizing: 'border-box',
              }}>
                {/* Policy header */}
                <div className="stagger-3" style={{
                  background: '#fff', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)',
                  padding: '10px 12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                }}>
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--color-text)' }}>Auto — State Farm</div>
                    <div style={{ fontSize: 10, color: 'var(--color-text-muted)', marginTop: 2 }}>Policy SF-8834201</div>
                  </div>
                  <span style={{
                    fontSize: 10, fontWeight: 600, color: '#15803d', background: '#dcfce7',
                    padding: '3px 10px', borderRadius: 10,
                  }}>Active</span>
                </div>
                {/* Coverage breakdown cards */}
                <div className="stagger-4 landing-inner-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6 }}>
                  {[
                    { label: 'Liability', value: '$500K/$1M', status: 'Good', color: 'var(--color-success)' },
                    { label: 'Comprehensive', value: '$500 ded', status: 'Good', color: 'var(--color-success)' },
                    { label: 'Collision', value: '$500 ded', status: 'Good', color: 'var(--color-success)' },
                  ].map(c => (
                    <div key={c.label} style={{
                      background: '#fff', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)',
                      padding: '8px 8px', textAlign: 'center',
                    }}>
                      <div style={{ fontSize: 9, fontWeight: 600, color: 'var(--color-text-muted)', textTransform: 'uppercase', marginBottom: 3 }}>{c.label}</div>
                      <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--color-text)' }}>{c.value}</div>
                      <div style={{ fontSize: 9, color: c.color, marginTop: 2 }}>&#10003; {c.status}</div>
                    </div>
                  ))}
                </div>
                {/* AI Insights */}
                <div className="stagger-5" style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                  <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 2 }}>AI Insights</div>
                  <div style={{
                    background: '#fff', borderRadius: 'var(--radius-md)', padding: '7px 10px',
                    borderLeft: '3px solid #dc2626', display: 'flex', alignItems: 'flex-start', gap: 8,
                  }}>
                    <span style={{ fontSize: 10, flexShrink: 0, marginTop: 1, color: '#dc2626', fontWeight: 700 }}>GAP</span>
                    <span style={{ fontSize: 10, color: 'var(--color-text)', lineHeight: 1.4 }}>No umbrella policy — your $500K auto liability may not cover a serious lawsuit</span>
                  </div>
                  <div style={{
                    background: '#fff', borderRadius: 'var(--radius-md)', padding: '7px 10px',
                    borderLeft: '3px solid #d97706', display: 'flex', alignItems: 'flex-start', gap: 8,
                  }}>
                    <span style={{ fontSize: 10, flexShrink: 0, marginTop: 1, color: '#d97706', fontWeight: 700 }}>NOTE</span>
                    <span style={{ fontSize: 10, color: 'var(--color-text)', lineHeight: 1.4 }}>Your total coverage may not be sufficient for current replacement costs</span>
                  </div>
                  <div style={{
                    background: '#fff', borderRadius: 'var(--radius-md)', padding: '7px 10px',
                    borderLeft: '3px solid #2563eb', display: 'flex', alignItems: 'flex-start', gap: 8,
                  }}>
                    <span style={{ fontSize: 10, flexShrink: 0, marginTop: 1, color: '#2563eb', fontWeight: 700 }}>TIP</span>
                    <span style={{ fontSize: 10, color: 'var(--color-text)', lineHeight: 1.4 }}>Adding roadside assistance would cost ~$20/yr on your auto policy</span>
                  </div>
                </div>
              </div>
            </div>

            {/* ── Step 3: Ask anything ───────────────────────── */}
            <div ref={step3Ref} className="landing-steps" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 48, alignItems: 'center', marginBottom: 72 }}>
              {/* Text — left side */}
              <div>
                <div className="stagger-1" style={{ fontSize: 13, fontWeight: 700, color: 'var(--color-primary)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 12 }}>Step 3</div>
                <h3 className="stagger-2" style={{ fontSize: 22, fontWeight: 600, margin: '0 0 12px', color: 'var(--color-text)' }}>Your insurance expert, on demand</h3>
                <p className="stagger-3" style={{ fontSize: 15, color: 'var(--color-text-secondary)', margin: '0 0 16px', lineHeight: 1.7 }}>
                  Not a generic chatbot — it reads your actual policy documents and gives answers specific to your coverage. No more calling your agent for basic questions.
                </p>
                <div className="stagger-4" style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  {[
                    'Am I covered if my basement floods?',
                    'What\u2019s my deductible for a fender bender?',
                    'Does my policy cover rental cars?',
                    'What happens if I miss a payment?',
                  ].map(q => (
                    <span key={q} style={{
                      fontSize: 12, padding: '5px 12px', borderRadius: 20,
                      border: '1px solid var(--color-border)', background: 'var(--color-surface)',
                      color: 'var(--color-text-secondary)', whiteSpace: 'nowrap',
                    }}>{q}</span>
                  ))}
                </div>
              </div>
              {/* Visual — right side (chat mockup with staggered messages) */}
              <div style={{
                backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)',
                borderRadius: 'var(--radius-lg)', minHeight: 280, padding: 16, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 12, boxSizing: 'border-box',
              }}>
                {/* Chat header */}
                <div className="stagger-3" style={{
                  background: '#fff', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)',
                  padding: '8px 12px', display: 'flex', alignItems: 'center', gap: 8,
                }}>
                  <span style={{ fontSize: 14 }}>💬</span>
                  <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--color-text)' }}>Policy Insights</span>
                  <span style={{ fontSize: 10, color: 'var(--color-text-muted)', marginLeft: 'auto' }}>Based on your policies</span>
                </div>
                {/* User message — slides in from right */}
                <div className="slide-right stagger-4" style={{ display: 'flex', justifyContent: 'flex-end' }}>
                  <div style={{
                    background: 'var(--color-primary)', color: '#fff', borderRadius: '12px 12px 2px 12px',
                    padding: '10px 14px', fontSize: 12, lineHeight: 1.5, maxWidth: '80%',
                  }}>
                    Am I covered if a tree falls on my car?
                  </div>
                </div>
                {/* AI response — slides in from left */}
                <div className="slide-left stagger-5" style={{ display: 'flex', justifyContent: 'flex-start' }}>
                  <div style={{
                    background: '#fff', border: '1px solid var(--color-border)', borderRadius: '12px 12px 12px 2px',
                    padding: '10px 14px', fontSize: 12, lineHeight: 1.6, maxWidth: '85%', color: 'var(--color-text)',
                  }}>
                    <strong>Yes.</strong> Your State Farm auto policy includes comprehensive coverage with a $500 deductible. This covers damage from falling objects, including trees.
                    <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid var(--color-border)', fontSize: 11, color: 'var(--color-text-secondary)' }}>
                      File a claim: <span style={{ fontFamily: 'monospace', fontWeight: 600 }}>1-800-732-5246</span>
                    </div>
                  </div>
                </div>
                {/* Input bar */}
                <div className="stagger-6" style={{
                  background: '#fff', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)',
                  padding: '8px 12px', display: 'flex', alignItems: 'center', gap: 8,
                }}>
                  <span style={{ fontSize: 12, color: 'var(--color-text-muted)', flex: 1 }}>Ask about your coverage...</span>
                  <span style={{ fontSize: 14, color: 'var(--color-primary)' }}>&#10148;</span>
                </div>
              </div>
            </div>

            {/* ── Step 4: Stay ahead ─────────────────────────── */}
            <div ref={step4Ref} className="landing-steps" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 48, alignItems: 'center' }}>
              {/* Text — left side */}
              <div>
                <div className="stagger-1" style={{ fontSize: 13, fontWeight: 700, color: 'var(--color-primary)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 12 }}>Step 4</div>
                <h3 className="stagger-2" style={{ fontSize: 22, fontWeight: 600, margin: '0 0 12px', color: 'var(--color-text)' }}>Stay ahead automatically</h3>
                <p className="stagger-3" style={{ fontSize: 15, color: 'var(--color-text-secondary)', margin: 0, lineHeight: 1.7 }}>
                  Renewal reminders, premium changes, and coverage shifts — {APP_NAME} watches your policies so you don&#39;t have to. You&#39;ll know about changes before they become surprises.
                </p>
              </div>
              {/* Visual — right side */}
              <div style={{
                backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)',
                borderRadius: 'var(--radius-lg)', minHeight: 280, padding: 16, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 10, boxSizing: 'border-box',
              }}>
                {/* Renewal alert */}
                <div className="stagger-3" style={{
                  background: '#fff', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)',
                  padding: '10px 12px', display: 'flex', alignItems: 'center', gap: 10,
                }}>
                  <span style={{
                    width: 28, height: 28, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
                    backgroundColor: 'var(--color-info-light)', fontSize: 13, flexShrink: 0,
                  }}>🔔</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--color-text)' }}>Renewal in 18 days</div>
                    <div style={{ fontSize: 10, color: 'var(--color-text-muted)', marginTop: 1 }}>Home — Allstate · Renews Mar 14, 2026</div>
                  </div>
                  <span style={{
                    fontSize: 10, fontWeight: 600, color: 'var(--color-info)', background: 'var(--color-info-light)',
                    padding: '2px 8px', borderRadius: 10, whiteSpace: 'nowrap',
                  }}>Upcoming</span>
                </div>
                {/* Premium change alert */}
                <div className="stagger-4" style={{
                  background: '#fff', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)',
                  padding: '10px 12px', display: 'flex', alignItems: 'center', gap: 10,
                }}>
                  <span style={{
                    width: 28, height: 28, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
                    backgroundColor: 'var(--color-warning-light)', fontSize: 13, flexShrink: 0,
                  }}>&#9888;</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--color-text)' }}>Premium increased 12%</div>
                    <div style={{ fontSize: 10, color: 'var(--color-text-muted)', marginTop: 1 }}>Auto — State Farm · $1,840 → $2,060/yr</div>
                  </div>
                  <span style={{
                    fontSize: 10, fontWeight: 600, color: 'var(--color-warning)', background: 'var(--color-warning-light)',
                    padding: '2px 8px', borderRadius: 10, whiteSpace: 'nowrap',
                  }}>Changed</span>
                </div>
                {/* Status summary */}
                <div className="stagger-5" style={{
                  background: '#fff', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)',
                  padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 6,
                }}>
                  {[
                    { icon: '✓', text: 'All 5 policies active', color: 'var(--color-success)' },
                    { icon: '✓', text: 'No coverage gaps detected', color: 'var(--color-success)' },
                    { icon: '✓', text: 'Next renewal: 18 days', color: 'var(--color-success)' },
                  ].map(s => (
                    <div key={s.text} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontSize: 11, color: s.color, fontWeight: 700, flexShrink: 0 }}>{s.icon}</span>
                      <span style={{ fontSize: 11, color: 'var(--color-text)' }}>{s.text}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>{/* end timeline container */}
        </div>
      </section>

      {/* ═══════════════════════════════════════════════════════════════
          SOCIAL PROOF
      ═══════════════════════════════════════════════════════════════ */}
      <section style={{ padding: '72px 24px', background: 'var(--color-surface)' }}>
        <div style={{ maxWidth: 960, margin: '0 auto' }}>
          <h2 style={{ fontSize: 26, fontWeight: 700, margin: '0 0 8px', textAlign: 'center', color: 'var(--color-text)' }}>
            People are finding gaps they didn&apos;t know they had
          </h2>
          <p style={{ fontSize: 15, color: 'var(--color-text-muted)', textAlign: 'center', margin: '0 0 40px' }}>
            Real coverage insights from real users.
          </p>
          <div className="landing-trust" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 20, marginBottom: 40 }}>
            {[
              { quote: 'I had no idea my home policy excluded flood damage. Found it in 30 seconds.', who: 'Homeowner, 3 policies' },
              { quote: 'Saved $340/yr by spotting a duplicate coverage between my auto and umbrella policies.', who: 'Family, 5 policies' },
              { quote: 'My agent was impressed I could explain exactly what my coverage gaps were.', who: 'Small business, 7 policies' },
            ].map(t => (
              <div key={t.who} style={{
                backgroundColor: '#fff', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-lg)',
                padding: '24px 20px', position: 'relative',
              }}>
                <div style={{ fontSize: 28, color: 'var(--color-border)', lineHeight: 1, marginBottom: 8 }}>&ldquo;</div>
                <p style={{ fontSize: 14, color: 'var(--color-text)', lineHeight: 1.65, margin: '0 0 16px' }}>{t.quote}</p>
                <div style={{ fontSize: 12, color: 'var(--color-text-muted)', fontWeight: 500 }}>{t.who}</div>
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', justifyContent: 'center', gap: 40, flexWrap: 'wrap' }}>
            {[
              { value: '500+', label: 'Policies analyzed' },
              { value: '200+', label: 'Gaps identified' },
              { value: '15+', label: 'Policy types supported' },
            ].map(s => (
              <div key={s.label} style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 24, fontWeight: 700, color: 'var(--color-primary)' }}>{s.value}</div>
                <div style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>{s.label}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ═══════════════════════════════════════════════════════════════
          3. EMERGENCY SECTION
      ═══════════════════════════════════════════════════════════════ */}
      <section ref={emergencyRef} style={{
        padding: '80px 24px',
        background: 'linear-gradient(160deg, #fef2f2 0%, #fff1f2 50%, #fff 100%)',
      }}>
        <div style={{ maxWidth: 960, margin: '0 auto' }}>
          <div className="landing-steps" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 48, alignItems: 'center' }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#dc2626', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 12 }}>Emergency Access</div>
              <h2 style={{ fontSize: 28, fontWeight: 700, margin: '0 0 16px', color: 'var(--color-text)' }}>
                When something happens, instantly see everything you need.
              </h2>
              <p style={{ fontSize: 15, color: 'var(--color-text-secondary)', margin: '0 0 24px', lineHeight: 1.7 }}>
                Policy numbers. Claim phone numbers. Coverage summary. Next steps. All in one place — no digging through email or filing cabinets. This is the feature people keep the app installed for.
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {[
                  'Instant access — no login required in emergencies',
                  'Shareable with family via secure PIN',
                  'Step-by-step emergency checklists for every policy type',
                  'Works offline — even without cell service',
                ].map(item => (
                  <div key={item} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span style={{ color: 'var(--color-success)', fontSize: 16, lineHeight: '20px', flexShrink: 0 }}>&#10003;</span>
                    <span style={{ fontSize: 14, color: 'var(--color-text)' }}>{item}</span>
                  </div>
                ))}
              </div>
            </div>
            <div style={{
              backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius-lg)', minHeight: 280, padding: 16, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 8, boxSizing: 'border-box',
            }}>
              {/* Emergency Coverage Card header */}
              <div style={{
                background: '#fff', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)',
                padding: '10px 12px',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                  <span style={{ fontSize: 14 }}>🆘</span>
                  <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--color-text)' }}>Emergency Coverage Card</span>
                  <span style={{
                    fontSize: 10, fontWeight: 600, color: '#15803d', background: '#dcfce7',
                    padding: '2px 8px', borderRadius: 10, marginLeft: 'auto', whiteSpace: 'nowrap',
                  }}>Active</span>
                </div>
                <div style={{ fontSize: 10, color: 'var(--color-text-muted)' }}>Shared with Sarah M. · Last updated today</div>
              </div>
              {/* Policy quick-access rows */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {[
                  { icon: '🚗', type: 'Auto', carrier: 'State Farm', claims: '1-800-732-5246' },
                  { icon: '🏠', type: 'Home', carrier: 'Allstate', claims: '1-800-255-7828' },
                  { icon: '❤️', type: 'Health', carrier: 'Blue Cross', claims: '1-800-262-2583' },
                ].map(p => (
                  <div key={p.type} style={{
                    background: '#fff', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)',
                    padding: '7px 12px', display: 'flex', alignItems: 'center', gap: 8,
                  }}>
                    <span style={{ fontSize: 12 }}>{p.icon}</span>
                    <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--color-text)', minWidth: 36 }}>{p.type}</span>
                    <span style={{ fontSize: 10, color: 'var(--color-text-muted)' }}>{p.carrier}</span>
                    <span style={{ fontSize: 10, color: 'var(--color-text-secondary)', marginLeft: 'auto', fontFamily: 'monospace' }}>{p.claims}</span>
                  </div>
                ))}
              </div>
              {/* Checklist hint */}
              <div style={{
                background: '#fff', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)',
                padding: '7px 12px', display: 'flex', alignItems: 'center', gap: 8,
              }}>
                <span style={{ fontSize: 12 }}>📋</span>
                <span style={{ fontSize: 10, color: 'var(--color-text-secondary)' }}>Step-by-step emergency checklists included for each policy</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ═══════════════════════════════════════════════════════════════
          4. TRUST & SECURITY
      ═══════════════════════════════════════════════════════════════ */}
      <section style={{ padding: '72px 24px', background: 'var(--color-surface)' }}>
        <div style={{ maxWidth: 880, margin: '0 auto' }}>
          <h2 style={{ fontSize: 26, fontWeight: 700, margin: '0 0 8px', textAlign: 'center', color: 'var(--color-text)' }}>
            Built for privacy. Designed for clarity.
          </h2>
          <p style={{ fontSize: 15, color: 'var(--color-text-muted)', textAlign: 'center', margin: '0 0 40px' }}>
            Your insurance data is sensitive. We treat it that way.
          </p>
          <div className="landing-trust" style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 20 }}>
            {[
              { icon: '🔒', title: 'Encrypted everywhere', desc: 'Bank-level AES-256 encryption in transit and at rest. Your documents are always protected.' },
              { icon: '🛡️', title: 'Your data stays yours', desc: 'We never sell, share, or monetize your information. No ads, no data deals, no third parties.' },
              { icon: '📖', title: 'Plain-language extraction', desc: 'No insurance jargon. See what matters in words you actually understand.' },
              { icon: '🚫', title: 'No external data', desc: 'We only analyze documents you upload. No scraping, no assumptions, no outside sources.' },
            ].map(s => (
              <div key={s.title} style={{
                backgroundColor: '#fff',
                border: '1px solid var(--color-border)',
                borderRadius: 'var(--radius-lg)',
                padding: '24px 20px',
                textAlign: 'center',
              }}>
                <div style={{ fontSize: 28, marginBottom: 12, lineHeight: 1 }}>{s.icon}</div>
                <h4 style={{ fontSize: 14, fontWeight: 700, margin: '0 0 6px', color: 'var(--color-text)' }}>{s.title}</h4>
                <p style={{ fontSize: 13, color: 'var(--color-text-secondary)', margin: 0, lineHeight: 1.55 }}>{s.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ═══════════════════════════════════════════════════════════════
          5. WHY WE BUILT THIS
      ═══════════════════════════════════════════════════════════════ */}
      <section style={{ padding: '64px 24px', background: '#fff' }}>
        <div style={{ maxWidth: 640, margin: '0 auto', textAlign: 'center' }}>
          <h2 style={{ fontSize: 22, fontWeight: 700, margin: '0 0 24px', color: 'var(--color-text)' }}>
            Why we built {APP_NAME}
          </h2>
          <p style={{ fontSize: 16, color: 'var(--color-text-secondary)', lineHeight: 1.8, margin: '0 0 16px' }}>
            We got tired of the same experience everyone has:<br />
            Paying thousands each year for insurance and not really knowing what&apos;s covered.
          </p>
          <p style={{ fontSize: 16, color: 'var(--color-text-secondary)', lineHeight: 1.8, margin: '0 0 16px' }}>
            Digging through 40-page PDF policies written in legal language.<br />
            Calling your agent to ask basic questions.<br />
            Scrambling for a policy number during an emergency.
          </p>
          <p style={{ fontSize: 16, color: 'var(--color-text-secondary)', lineHeight: 1.8, margin: '0 0 16px', fontWeight: 500 }}>
            Insurance is too important to feel this unclear.
          </p>
          <p style={{ fontSize: 16, color: 'var(--color-text-secondary)', lineHeight: 1.8, margin: '0 0 20px' }}>
            {APP_NAME} exists to turn dense policy documents into an intelligent coverage picture — a clear health overview that shows where you stand, where the gaps are, and what to discuss with your agent.
          </p>
          <p style={{ fontSize: 15, color: 'var(--color-text)', fontWeight: 600, margin: '0 0 20px', letterSpacing: '0.01em' }}>
            Built for clarity. Built for emergencies. Built for peace of mind.
          </p>
          <p style={{ fontSize: 14, color: 'var(--color-text-muted)', margin: 0 }}>
            — The {APP_NAME} Team
          </p>
        </div>
      </section>

      {/* ═══════════════════════════════════════════════════════════════
          6. FAQ (top 5)
      ═══════════════════════════════════════════════════════════════ */}
      <section id="faq" style={{ padding: '80px 24px', background: '#fff' }}>
        <div style={{ maxWidth: 680, margin: '0 auto' }}>
          <h2 style={{ fontSize: 28, fontWeight: 700, margin: '0 0 40px', textAlign: 'center', color: 'var(--color-text)' }}>
            Frequently asked questions
          </h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
            {[
              {
                q: 'Is my data safe?',
                a: `Yes. All data is encrypted in transit and at rest. Your password is hashed with bcrypt. ${APP_NAME} is built with the same security standards used for financial applications.`,
              },
              {
                q: 'Do you sell my information?',
                a: `Never. Your policy data is never shared with carriers, agents, advertisers, or any third party. ${APP_NAME} is paid for by users, not by selling data.`,
              },
              {
                q: 'How does the document reading work?',
                a: `Upload a PDF or photo of any policy document. ${APP_NAME} uses AI to extract carrier, limits, deductibles, renewal dates, and more. You review everything before it's saved.`,
              },
              {
                q: `What types of insurance work with ${APP_NAME}?`,
                a: 'All of them. Auto, home, renters, life, health, umbrella, general liability, professional liability, cyber, workers\' comp, and more. Personal and business.',
              },
              {
                q: 'Does this replace my insurance agent?',
                a: `No — and we don't want to. ${APP_NAME} helps you understand what you have so conversations with your agent are better. You can even invite your agent to view your policies directly, giving them real-time access to your coverage details. Better-prepared clients make your agent's job easier too.`,
              },
            ].map((faq, i) => (
              <div key={i} style={{ borderBottom: '1px solid var(--color-border)' }}>
                <button
                  onClick={() => { trackClick('landing_faq_toggle', { index: i }); setOpenFaq(openFaq === i ? null : i); }}
                  style={{
                    width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    padding: '20px 0', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left',
                  }}
                >
                  <span style={{ fontSize: 16, fontWeight: 600, color: 'var(--color-text)', paddingRight: 16 }}>{faq.q}</span>
                  <span style={{
                    fontSize: 20, color: 'var(--color-text-muted)', flexShrink: 0, lineHeight: 1,
                    transform: openFaq === i ? 'rotate(45deg)' : 'none', transition: 'transform 0.2s',
                  }}>+</span>
                </button>
                {openFaq === i && (
                  <div style={{ padding: '0 0 20px', fontSize: 15, color: 'var(--color-text-secondary)', lineHeight: 1.7 }}>
                    {faq.a}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ═══════════════════════════════════════════════════════════════
          7. FINAL CTA
      ═══════════════════════════════════════════════════════════════ */}
      <section style={{
        padding: '80px 24px',
        background: 'linear-gradient(160deg, #0f1f33 0%, var(--color-primary-dark) 40%, var(--color-primary) 100%)',
        color: '#fff', textAlign: 'center',
        position: 'relative', overflow: 'hidden',
      }}>
        <div style={{
          position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
          background: 'radial-gradient(ellipse at 30% 80%, rgba(63,167,163,0.1) 0%, transparent 60%)',
          pointerEvents: 'none',
        }} />
        <div style={{ maxWidth: 600, margin: '0 auto', position: 'relative' }}>
          <h2 style={{ fontSize: 32, fontWeight: 700, margin: '0 0 16px', letterSpacing: 'var(--letter-spacing-tight)' }}>
            Stop guessing. Start knowing.
          </h2>
          <p style={{ fontSize: 18, opacity: 0.9, margin: '0 0 32px' }}>
            See what your insurance actually covers — and where you may still be exposed.
          </p>
          <button onClick={() => { trackClick('landing_cta_final'); ctaAction(); }} style={{
            padding: '16px 40px', fontSize: 18, fontWeight: 600,
            backgroundColor: 'var(--color-secondary)', color: '#fff',
            border: 'none', borderRadius: 'var(--radius-md)', cursor: 'pointer',
            boxShadow: '0 4px 14px rgba(63, 167, 163, 0.3)',
            transition: 'transform 0.15s, box-shadow 0.15s',
          }}>
            {ctaLabel}
          </button>
          <div style={{ marginTop: 16, fontSize: 13, opacity: 0.6, letterSpacing: 'var(--letter-spacing-wide)' }}>
            Free for up to 3 policies. No credit card required.
          </div>
        </div>
      </section>

      {/* ═══════════════════════════════════════════════════════════════
          FOOTER
      ═══════════════════════════════════════════════════════════════ */}
      <footer style={{ padding: '32px 24px', borderTop: '1px solid var(--color-border)', color: 'var(--color-text-muted)', fontSize: 13 }}>
        <div style={{ maxWidth: 700, margin: '0 auto' }}>
          <div style={{ display: 'flex', justifyContent: 'center', gap: 20, marginBottom: 12, fontSize: 11, color: 'var(--color-text-muted)' }}>
            <span>&#128274; Encrypted Storage</span>
            <span>&#128737;&#65039; Secure Infrastructure</span>
            <span>&#128272; Private Access</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'center', gap: 24, marginBottom: 16, flexWrap: 'wrap' }}>
            <span onClick={() => { trackClick('landing_footer_privacy'); router.push('/privacy'); }} style={{ cursor: 'pointer' }}>Privacy</span>
            <span onClick={() => { trackClick('landing_footer_terms'); router.push('/terms'); }} style={{ cursor: 'pointer' }}>Terms</span>
            <span onClick={() => { trackClick('landing_footer_security'); router.push('/security'); }} style={{ cursor: 'pointer' }}>Security</span>
            <span onClick={() => { trackClick('landing_footer_support'); router.push('/support'); }} style={{ cursor: 'pointer' }}>Support</span>
            <a href={`mailto:${APP_CONTACT_EMAIL}`} style={{ color: 'var(--color-text-muted)', textDecoration: 'none' }}>{APP_CONTACT_EMAIL}</a>
          </div>
          <div style={{ textAlign: 'center' }}>
            {APP_NAME} — {APP_TAGLINE}
          </div>
        </div>
      </footer>
    </div>
  );
}
