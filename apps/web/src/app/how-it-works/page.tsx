'use client';

import { Suspense, useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '../../../lib/auth';
import { APP_NAME, APP_TAGLINE, APP_CONTACT_EMAIL, ANNOUNCEMENT_BAR } from '../config';
import Logo from '../components/Logo';
import { trackClick, trackPageView } from '../../../lib/track';

/* ── Scroll-reveal hook (mirrors the one in /page.tsx) ──────────────── */
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

/* ── Timeline scroll tracker (4 dots) ───────────────────────────────── */
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
      const progress = Math.min(Math.max((windowH * 0.5 - rect.top) / rect.height, 0), 1);
      line.style.height = `${progress * 100}%`;
      const thresholds = [0.125, 0.375, 0.625, 0.875];
      setActiveDots(thresholds.map(t => progress >= t));
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener('scroll', onScroll);
  }, []);
  return { containerRef, lineRef, activeDots };
}

/* ── ProductDemo: auto-playing 6-scene browser mockup ───────────────────
   Lifted from the pre-rewrite landing (commit 64a58d5^). Six scenes loop:
   upload → extract → ask → compliance → emergency → summary. The demo
   starts when ~30% of the section enters the viewport and replays as
   long as the user has it in view. Scenes pause/resume implicitly via
   the IntersectionObserver. */
const DEMO_SCENES = [
  { id: 'upload', duration: 4500, label: 'Upload a policy — personal or business' },
  { id: 'extract', duration: 6000, label: 'Limits, terms, and dates extracted automatically' },
  { id: 'chat', duration: 7500, label: 'Ask plain questions, get grounded answers' },
  { id: 'compliance', duration: 6000, label: 'Check a lease or contract against your coverage' },
  { id: 'emergency', duration: 5000, label: 'Emergency access when it matters most' },
  { id: 'summary', duration: 5000, label: 'Everything in one place — for you and your agent' },
];
const TOTAL_DURATION = DEMO_SCENES.reduce((s, sc) => s + sc.duration, 0);

function ProductDemo() {
  const [elapsed, setElapsed] = useState(0);
  const [isVisible, setIsVisible] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      ([e]) => { if (e.isIntersecting) setIsVisible(true); },
      { threshold: 0.3 }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  useEffect(() => {
    if (!isVisible) return;
    const tick = setInterval(() => setElapsed(p => (p + 50) % TOTAL_DURATION), 50);
    return () => clearInterval(tick);
  }, [isVisible]);

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
    <section ref={containerRef} style={{ padding: '64px 24px 80px', background: '#fff' }} aria-label="Product demo">
      <div style={{ maxWidth: 720, margin: '0 auto' }}>
        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-text-muted)', letterSpacing: '0.04em' }}>
            A 30-second look at the experience
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

              {/* Scene 1: Upload */}
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
                          {'✓'} Uploaded &mdash; reading coverage...
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

              {/* Scene 2: Extract */}
              {activeIdx === 1 && (
                <div style={{ maxWidth: 400, margin: '0 auto' }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: '#111827', marginBottom: 3 }}>Reading your policy...</div>
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
                            <span style={{ fontSize: 12, fontWeight: 600, color: isRevealed ? '#111827' : '#d1d5db', transition: 'color 0.3s' }}>{isRevealed ? f.value : '—'}</span>
                            {isRevealed && !isAnimating && <span style={{ color: '#16a34a', fontSize: 13, fontWeight: 700 }}>{'✓'}</span>}
                            {isAnimating && <span style={{ color: '#2563eb', fontSize: 10 }}>{'●'}</span>}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Scene 3: Ask */}
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
                            ? (<>Your Hartford GL policy (<strong>HF-GL-440291</strong>) provides <strong>$1M per occurrence</strong> for bodily injury on your premises. Worth confirming with your agent that contractors carry their own workers&apos; comp.</>)
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
                            ? (<>It looks that way. Your Chubb umbrella (<strong>$2M</strong>) lists your Hartford GL as an underlying policy. Your agent can confirm the layering for your specific scenario.</>)
                            : (<span style={{ color: '#9ca3af' }}>Checking across your policies...</span>)}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Scene 4: Compliance */}
              {activeIdx === 3 && (
                <div style={{ maxWidth: 420, margin: '0 auto' }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: '#111827', marginBottom: 3 }}>Requirement Check</div>
                  <div style={{ fontSize: 11, color: '#9ca3af', marginBottom: 14 }}>Comparing your coverage to lease requirements</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {[
                      { req: 'General Liability ≥ $1,000,000', status: 'PASS', color: '#22c55e', bg: '#f0fdf4', delay: 0.1 },
                      { req: 'Additional Insured endorsement', status: 'PASS', color: '#22c55e', bg: '#f0fdf4', delay: 0.25 },
                      { req: 'Workers’ Comp coverage', status: 'NOT FOUND', color: '#ef4444', bg: '#fef2f2', delay: 0.4 },
                      { req: 'Waiver of Subrogation', status: 'UNCLEAR', color: '#f59e0b', bg: '#fffbeb', delay: 0.55 },
                      { req: 'Property Damage ≥ $500,000', status: 'PASS', color: '#22c55e', bg: '#f0fdf4', delay: 0.7 },
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
                          {sceneProgress > item.delay ? item.status : '—'}
                        </span>
                      </div>
                    ))}
                  </div>
                  {sceneProgress > 0.8 && (
                    <div style={{
                      marginTop: 10, padding: '8px 12px', backgroundColor: '#fef2f2', borderRadius: 6,
                      borderLeft: '3px solid #ef4444', fontSize: 11, color: '#991b1b', lineHeight: 1.4,
                    }}>
                      1 requirement not met. Worth a conversation with your agent before signing.
                    </div>
                  )}
                </div>
              )}

              {/* Scene 5: Emergency Card */}
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
                            <div style={{ fontSize: 10, color: '#9ca3af' }}>{p.type} {'·'} {p.number}</div>
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
                        Share with family via secure link
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Scene 6: Summary */}
              {activeIdx === 5 && (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: 252, textAlign: 'center' }}>
                  <div style={{ fontSize: 20, fontWeight: 700, color: '#111827', marginBottom: 20 }}>
                    Everything in one place
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10, alignItems: 'flex-start' }}>
                    {[
                      { text: 'See what you actually have — across every policy', delay: 0.05 },
                      { text: 'Check coverage against any lease or contract', delay: 0.2 },
                      { text: 'Stay ahead of renewals and changes', delay: 0.35 },
                      { text: 'Reach your agent and your coverage in an emergency', delay: 0.5 },
                    ].map((item, i) => (
                      <div key={i} style={{
                        display: 'flex', alignItems: 'center', gap: 10,
                        opacity: sceneProgress > item.delay ? 1 : 0,
                        transform: sceneProgress > item.delay ? 'translateX(0)' : 'translateX(-10px)',
                        transition: 'all 0.4s ease',
                      }}>
                        <span style={{ color: '#16a34a', fontSize: 16, fontWeight: 700 }}>{'✓'}</span>
                        <span style={{ fontSize: 14, fontWeight: 500, color: '#374151' }}>{item.text}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Bottom bar: label + scene indicators + progress */}
          <div style={{ backgroundColor: '#111827' }}>
            <div style={{ padding: '12px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
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
            <div style={{ height: 3, backgroundColor: '#1f2937' }}>
              <div style={{
                height: '100%', width: `${overallProgress * 100}%`,
                backgroundColor: '#3fa7a3', transition: 'width 0.05s linear',
              }} />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function HowItWorksInner() {
  const { token } = useAuth();
  const router = useRouter();
  const params = useSearchParams();
  const inviteToken = params.get('invite');
  const hasInvite = !!inviteToken;

  const [openFaq, setOpenFaq] = useState<number | null>(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [announcementDismissed, setAnnouncementDismissed] = useState(false);
  const showAsPublic = !token;
  const showAnnouncement = ANNOUNCEMENT_BAR.enabled && showAsPublic && !announcementDismissed;

  useEffect(() => { trackPageView('how_it_works'); }, []);

  const scrollTo = (id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' });
    setMobileMenuOpen(false);
  };

  // Audience-aware primary CTA. An invited client (token in URL) gets sent
  // straight into the login/register flow with their invite preserved. A
  // curious prospect gets sent to the agent-pitch landing.
  const primaryCtaLabel = hasInvite ? 'Continue to your account' : 'See the public demo';
  const primaryCtaAction = () => {
    if (hasInvite) {
      trackClick('hiw_cta_continue_invite');
      router.push(`/login?invite=${encodeURIComponent(inviteToken!)}`);
    } else {
      trackClick('hiw_cta_try_demo');
      router.push('/login?email=demo%40covrabl.com');
    }
  };
  const secondaryCtaAction = () => {
    if (hasInvite) {
      trackClick('hiw_cta_learn_more');
      scrollTo('how-it-works');
    } else {
      trackClick('hiw_cta_for_agencies');
      router.push('/');
    }
  };
  const secondaryCtaLabel = hasInvite ? 'See what happens next ↓' : 'For insurance agencies →';

  const { containerRef: timelineContainer, lineRef: timelineLine, activeDots } = useTimelineFill();
  const step1Ref = useScrollReveal();
  const step2Ref = useScrollReveal();
  const step3Ref = useScrollReveal();
  const step4Ref = useScrollReveal();
  const emergencyRef = useScrollReveal();
  const trustRef = useScrollReveal();

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
          <button onClick={() => { trackClick('hiw_announcement_dismiss'); setAnnouncementDismissed(true); }} style={{
            position: 'absolute', right: 12, background: 'none', border: 'none',
            color: '#fff', fontSize: 16, cursor: 'pointer', opacity: 0.8, padding: 4,
          }} aria-label="Dismiss announcement">&times;</button>
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
          <div onClick={() => { trackClick('hiw_logo_click'); router.push('/'); }} style={{ cursor: 'pointer' }}>
            <Logo size="md" variant="dark" />
          </div>
          <nav className="landing-nav-links">
            <span onClick={() => { trackClick('hiw_nav_steps'); scrollTo('how-it-works'); }} style={{ fontSize: 14, color: 'var(--color-text-secondary)', cursor: 'pointer' }}>How it works</span>
            <span onClick={() => { trackClick('hiw_nav_more_tools'); scrollTo('more-tools'); }} style={{ fontSize: 14, color: 'var(--color-text-secondary)', cursor: 'pointer' }}>More tools</span>
            <span onClick={() => { trackClick('hiw_nav_security'); scrollTo('trust'); }} style={{ fontSize: 14, color: 'var(--color-text-secondary)', cursor: 'pointer' }}>Security</span>
            <span onClick={() => { trackClick('hiw_nav_faq'); scrollTo('faq'); }} style={{ fontSize: 14, color: 'var(--color-text-secondary)', cursor: 'pointer' }}>FAQ</span>
            <button onClick={() => { trackClick('hiw_nav_sign_in'); router.push(hasInvite ? `/login?invite=${encodeURIComponent(inviteToken!)}` : '/login'); }} style={{
              padding: '8px 20px', fontSize: 14, fontWeight: 600,
              backgroundColor: 'var(--color-primary)', color: '#fff',
              border: 'none', borderRadius: 'var(--radius-md)', cursor: 'pointer',
            }}>{hasInvite ? 'Continue' : 'Sign in'}</button>
          </nav>
          <button className="hamburger-btn" onClick={() => { trackClick('hiw_hamburger_toggle'); setMobileMenuOpen(!mobileMenuOpen); }} aria-label="Toggle navigation menu" style={{
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
          <button onClick={() => { trackClick('hiw_mobile_steps'); scrollTo('how-it-works'); }} style={{ padding: '12px 0', background: 'none', border: 'none', fontSize: 15, color: 'var(--color-text)', cursor: 'pointer', textAlign: 'left' }}>How it works</button>
          <button onClick={() => { trackClick('hiw_mobile_more_tools'); scrollTo('more-tools'); }} style={{ padding: '12px 0', background: 'none', border: 'none', fontSize: 15, color: 'var(--color-text)', cursor: 'pointer', textAlign: 'left' }}>More tools</button>
          <button onClick={() => { trackClick('hiw_mobile_security'); scrollTo('trust'); }} style={{ padding: '12px 0', background: 'none', border: 'none', fontSize: 15, color: 'var(--color-text)', cursor: 'pointer', textAlign: 'left' }}>Security</button>
          <button onClick={() => { trackClick('hiw_mobile_faq'); scrollTo('faq'); }} style={{ padding: '12px 0', background: 'none', border: 'none', fontSize: 15, color: 'var(--color-text)', cursor: 'pointer', textAlign: 'left' }}>FAQ</button>
          <button onClick={() => { trackClick('hiw_mobile_sign_in'); router.push(hasInvite ? `/login?invite=${encodeURIComponent(inviteToken!)}` : '/login'); setMobileMenuOpen(false); }} style={{
            padding: '10px 20px', fontSize: 15, fontWeight: 600, marginTop: 4,
            backgroundColor: 'var(--color-primary)', color: '#fff',
            border: 'none', borderRadius: 'var(--radius-md)', cursor: 'pointer', textAlign: 'center',
          }}>{hasInvite ? 'Continue' : 'Sign in'}</button>
        </div>
      )}

      {/* ── HERO ─────────────────────────────────────────────────────── */}
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
        <div style={{ maxWidth: 820, margin: '0 auto', textAlign: 'center', position: 'relative' }}>
          <div style={{ fontSize: 11, fontWeight: 600, opacity: 0.7, marginBottom: 16, letterSpacing: 'var(--letter-spacing-wide)', textTransform: 'uppercase' }}>
            {hasInvite ? 'Welcome' : 'How it works'}
          </div>
          <h1 style={{
            fontSize: 42, fontWeight: 700, margin: '0 0 18px', lineHeight: 1.15,
            letterSpacing: 'var(--letter-spacing-tight)', fontFamily: 'var(--font-heading)',
          }}>
            {hasInvite
              ? 'Your agent invited you. Here’s what happens next.'
              : 'How Covrabl works for you and your agent.'}
          </h1>
          <p style={{ fontSize: 17, opacity: 0.95, margin: '0 0 12px', lineHeight: 1.7, maxWidth: 680, marginLeft: 'auto', marginRight: 'auto', fontWeight: 500 }}>
            {hasInvite
              ? 'A secure place to review your coverage, keep your documents organized, and stay in touch with your agent between renewals. Your data stays between you and them.'
              : 'A secure place where you and your agent review your coverage, keep your documents organized, and stay in touch between renewals. Used by your agent — and built around you.'}
          </p>
          <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap', marginTop: 28, marginBottom: 16 }}>
            <button onClick={primaryCtaAction} style={{
              padding: '14px 32px', fontSize: 16, fontWeight: 600,
              backgroundColor: 'var(--color-secondary)', color: '#fff',
              border: 'none', borderRadius: 'var(--radius-md)', cursor: 'pointer',
              boxShadow: '0 4px 14px rgba(63, 167, 163, 0.3)',
            }}>{primaryCtaLabel}</button>
            <button onClick={secondaryCtaAction} style={{
              padding: '14px 28px', fontSize: 16, fontWeight: 500,
              backgroundColor: 'rgba(255,255,255,0.08)', color: '#fff',
              border: '1px solid rgba(255,255,255,0.2)', borderRadius: 'var(--radius-md)', cursor: 'pointer',
              backdropFilter: 'blur(4px)',
            }}>{secondaryCtaLabel}</button>
          </div>
          <div style={{ fontSize: 13, opacity: 0.6, letterSpacing: 'var(--letter-spacing-wide)', marginTop: 12 }}>
            Encrypted at rest and in transit · You control what your agent sees
          </div>
        </div>
      </section>

      {/* ── PRODUCT DEMO ─────────────────────────────────────────────── */}
      <ProductDemo />

      {/* ── 4 STEPS (HOW IT WORKS) ────────────────────────────────────── */}
      <section id="how-it-works" style={{ padding: '80px 24px', background: '#fff' }}>
        <div style={{ maxWidth: 960, margin: '0 auto' }}>
          <h2 style={{ fontSize: 28, fontWeight: 700, margin: '0 0 10px', textAlign: 'center', color: 'var(--color-text)' }}>
            What you&apos;ll do here
          </h2>
          <p style={{ fontSize: 15, color: 'var(--color-text-secondary)', textAlign: 'center', margin: '0 0 56px', maxWidth: 620, marginLeft: 'auto', marginRight: 'auto' }}>
            Four things, each in plain language. None of them require insurance expertise — that&apos;s what your agent is for.
          </p>

          <div ref={timelineContainer} style={{ position: 'relative' }}>
            <div className="how-it-works-timeline">
              <div ref={timelineLine} className="timeline-line-fill" style={{ height: 0 }} />
              {[12.5, 37.5, 62.5, 87.5].map((pct, i) => (
                <div key={i} className={`timeline-dot${activeDots[i] ? ' active' : ''}`} style={{ top: `${pct}%` }} />
              ))}
            </div>

            {/* Step 1 — Add your insurance */}
            <div ref={step1Ref} className="landing-steps" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 48, alignItems: 'center', marginBottom: 72 }}>
              <div>
                <div className="stagger-1" style={{ fontSize: 13, fontWeight: 700, color: 'var(--color-primary)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 12 }}>Step 1</div>
                <h3 className="stagger-2" style={{ fontSize: 22, fontWeight: 600, margin: '0 0 12px', color: 'var(--color-text)' }}>Add your policies in seconds</h3>
                <p className="stagger-3" style={{ fontSize: 15, color: 'var(--color-text-secondary)', margin: 0, lineHeight: 1.7 }}>
                  Forward a renewal email or upload a PDF. {APP_NAME} reads your documents and pulls out the carrier, limits, deductibles, and renewal dates — so you don&apos;t have to retype any of it.
                </p>
              </div>
              <div style={{
                backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)',
                borderRadius: 'var(--radius-lg)', minHeight: 280, padding: 16, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 10, boxSizing: 'border-box',
              }}>
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

            {/* Step 2 — Plain-language overview */}
            <div ref={step2Ref} className="landing-steps" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 48, alignItems: 'center', marginBottom: 72 }}>
              <div>
                <div className="stagger-1" style={{ fontSize: 13, fontWeight: 700, color: 'var(--color-primary)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 12 }}>Step 2</div>
                <h3 className="stagger-2" style={{ fontSize: 22, fontWeight: 600, margin: '0 0 12px', color: 'var(--color-text)' }}>See your coverage in plain language</h3>
                <p className="stagger-3" style={{ fontSize: 15, color: 'var(--color-text-secondary)', margin: 0, lineHeight: 1.7 }}>
                  Your Coverage Overview shows what each policy covers in words you actually understand — color-coded by what&apos;s strong, what&apos;s worth a question, and what to bring up at your next review.
                </p>
                <p className="stagger-3" style={{ fontSize: 13, color: 'var(--color-text-muted)', margin: '8px 0 0', lineHeight: 1.6 }}>
                  These are observations from your documents, not advice. Your agent stays the one who decides.
                </p>
              </div>
              <div style={{
                backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)',
                borderRadius: 'var(--radius-lg)', minHeight: 280, padding: 16, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 10, boxSizing: 'border-box',
              }}>
                <div className="stagger-3" style={{
                  background: '#fff', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)',
                  padding: '10px 12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                }}>
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--color-text)' }}>Auto — State Farm</div>
                    <div style={{ fontSize: 10, color: 'var(--color-text-muted)', marginTop: 2 }}>Policy SF-8834201</div>
                  </div>
                  <span style={{ fontSize: 10, fontWeight: 600, color: '#15803d', background: '#dcfce7', padding: '3px 10px', borderRadius: 10 }}>Active</span>
                </div>
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
                <div className="stagger-5" style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                  <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 2 }}>Worth a question</div>
                  <div style={{ background: '#fff', borderRadius: 'var(--radius-md)', padding: '7px 10px', borderLeft: '3px solid #d97706', display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                    <span style={{ fontSize: 10, flexShrink: 0, marginTop: 1, color: '#d97706', fontWeight: 700 }}>NOTE</span>
                    <span style={{ fontSize: 10, color: 'var(--color-text)', lineHeight: 1.4 }}>Your auto liability limit may be worth reviewing with your agent at renewal</span>
                  </div>
                  <div style={{ background: '#fff', borderRadius: 'var(--radius-md)', padding: '7px 10px', borderLeft: '3px solid #2563eb', display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                    <span style={{ fontSize: 10, flexShrink: 0, marginTop: 1, color: '#2563eb', fontWeight: 700 }}>TIP</span>
                    <span style={{ fontSize: 10, color: 'var(--color-text)', lineHeight: 1.4 }}>Roadside assistance is a common add-on; ask your agent if it&apos;s a fit</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Step 3 — Ask anything */}
            <div ref={step3Ref} className="landing-steps" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 48, alignItems: 'center', marginBottom: 72 }}>
              <div>
                <div className="stagger-1" style={{ fontSize: 13, fontWeight: 700, color: 'var(--color-primary)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 12 }}>Step 3</div>
                <h3 className="stagger-2" style={{ fontSize: 22, fontWeight: 600, margin: '0 0 12px', color: 'var(--color-text)' }}>Ask plain questions, get plain answers</h3>
                <p className="stagger-3" style={{ fontSize: 15, color: 'var(--color-text-secondary)', margin: '0 0 16px', lineHeight: 1.7 }}>
                  Not a generic chatbot. {APP_NAME} reads your actual documents and gives answers grounded in what you&apos;re covered for — so you walk into the conversation with your agent already prepared.
                </p>
                <div className="stagger-4" style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  {[
                    'Am I covered if my basement floods?',
                    'What’s my deductible on a fender bender?',
                    'Does my policy cover rental cars?',
                    'When does my home policy renew?',
                  ].map(q => (
                    <span key={q} style={{
                      fontSize: 12, padding: '5px 12px', borderRadius: 20,
                      border: '1px solid var(--color-border)', background: 'var(--color-surface)',
                      color: 'var(--color-text-secondary)', whiteSpace: 'nowrap',
                    }}>{q}</span>
                  ))}
                </div>
              </div>
              <div style={{
                backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)',
                borderRadius: 'var(--radius-lg)', minHeight: 280, padding: 16, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 12, boxSizing: 'border-box',
              }}>
                <div className="stagger-3" style={{
                  background: '#fff', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)',
                  padding: '8px 12px', display: 'flex', alignItems: 'center', gap: 8,
                }}>
                  <span style={{ fontSize: 14 }}>💬</span>
                  <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--color-text)' }}>Ask Covrabl</span>
                  <span style={{ fontSize: 10, color: 'var(--color-text-muted)', marginLeft: 'auto' }}>Grounded in your policies</span>
                </div>
                <div className="slide-right stagger-4" style={{ display: 'flex', justifyContent: 'flex-end' }}>
                  <div style={{ background: 'var(--color-primary)', color: '#fff', borderRadius: '12px 12px 2px 12px', padding: '10px 14px', fontSize: 12, lineHeight: 1.5, maxWidth: '80%' }}>
                    Am I covered if a tree falls on my car?
                  </div>
                </div>
                <div className="slide-left stagger-5" style={{ display: 'flex', justifyContent: 'flex-start' }}>
                  <div style={{ background: '#fff', border: '1px solid var(--color-border)', borderRadius: '12px 12px 12px 2px', padding: '10px 14px', fontSize: 12, lineHeight: 1.6, maxWidth: '85%', color: 'var(--color-text)' }}>
                    <strong>It looks that way.</strong> Your State Farm auto policy includes comprehensive coverage with a $500 deductible, which typically covers damage from falling objects.
                    <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid var(--color-border)', fontSize: 11, color: 'var(--color-text-secondary)' }}>
                      Your agent is the right person to confirm before you file. Claims line: <span style={{ fontFamily: 'monospace', fontWeight: 600 }}>1-800-732-5246</span>
                    </div>
                  </div>
                </div>
                <div className="stagger-6" style={{
                  background: '#fff', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)',
                  padding: '8px 12px', display: 'flex', alignItems: 'center', gap: 8,
                }}>
                  <span style={{ fontSize: 12, color: 'var(--color-text-muted)', flex: 1 }}>Ask about your coverage...</span>
                  <span style={{ fontSize: 14, color: 'var(--color-primary)' }}>&#10148;</span>
                </div>
              </div>
            </div>

            {/* Step 4 — Stay in touch */}
            <div ref={step4Ref} className="landing-steps" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 48, alignItems: 'center' }}>
              <div>
                <div className="stagger-1" style={{ fontSize: 13, fontWeight: 700, color: 'var(--color-primary)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 12 }}>Step 4</div>
                <h3 className="stagger-2" style={{ fontSize: 22, fontWeight: 600, margin: '0 0 12px', color: 'var(--color-text)' }}>Stay in the loop between renewals</h3>
                <p className="stagger-3" style={{ fontSize: 15, color: 'var(--color-text-secondary)', margin: 0, lineHeight: 1.7 }}>
                  Renewal reminders, premium changes, coverage shifts. {APP_NAME} watches your policies so the next call with your agent is a real conversation — not a scramble.
                </p>
              </div>
              <div style={{
                backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)',
                borderRadius: 'var(--radius-lg)', minHeight: 280, padding: 16, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 10, boxSizing: 'border-box',
              }}>
                <div className="stagger-3" style={{
                  background: '#fff', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)',
                  padding: '10px 12px', display: 'flex', alignItems: 'center', gap: 10,
                }}>
                  <span style={{ width: 28, height: 28, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: 'var(--color-info-light)', fontSize: 13, flexShrink: 0 }}>🔔</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--color-text)' }}>Renewal in 18 days</div>
                    <div style={{ fontSize: 10, color: 'var(--color-text-muted)', marginTop: 1 }}>Home — Allstate · Renews Mar 14, 2026</div>
                  </div>
                  <span style={{ fontSize: 10, fontWeight: 600, color: 'var(--color-info)', background: 'var(--color-info-light)', padding: '2px 8px', borderRadius: 10, whiteSpace: 'nowrap' }}>Upcoming</span>
                </div>
                <div className="stagger-4" style={{
                  background: '#fff', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)',
                  padding: '10px 12px', display: 'flex', alignItems: 'center', gap: 10,
                }}>
                  <span style={{ width: 28, height: 28, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: 'var(--color-warning-light)', fontSize: 13, flexShrink: 0 }}>&#9888;</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--color-text)' }}>Premium increased 12%</div>
                    <div style={{ fontSize: 10, color: 'var(--color-text-muted)', marginTop: 1 }}>Auto — State Farm · $1,840 → $2,060/yr</div>
                  </div>
                  <span style={{ fontSize: 10, fontWeight: 600, color: 'var(--color-warning)', background: 'var(--color-warning-light)', padding: '2px 8px', borderRadius: 10, whiteSpace: 'nowrap' }}>Changed</span>
                </div>
                <div className="stagger-5" style={{
                  background: '#fff', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)',
                  padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 6,
                }}>
                  {[
                    { icon: '✓', text: 'All 5 policies on file', color: 'var(--color-success)' },
                    { icon: '✓', text: 'Documents organized in one place', color: 'var(--color-success)' },
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
          </div>
        </div>
      </section>

      {/* ── EMERGENCY ACCESS ─────────────────────────────────────────── */}
      {/* Moved above "More you can do here": Emergency is universally
          relevant (every client has an emergency scenario, not every
          client needs to compare quotes or check a lease), and the red
          gradient breaks the visual monotony between two white-bg
          sections (timeline above, More-tools below). */}
      <section ref={emergencyRef} style={{
        padding: '80px 24px',
        background: 'linear-gradient(160deg, #fef2f2 0%, #fff1f2 50%, #fff 100%)',
      }}>
        <div style={{ maxWidth: 960, margin: '0 auto' }}>
          <div className="landing-steps" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 48, alignItems: 'center' }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#dc2626', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 12 }}>Emergency Access</div>
              <h2 style={{ fontSize: 28, fontWeight: 700, margin: '0 0 16px', color: 'var(--color-text)' }}>
                When something happens, everything you need is in one place.
              </h2>
              <p style={{ fontSize: 15, color: 'var(--color-text-secondary)', margin: '0 0 24px', lineHeight: 1.7 }}>
                Policy numbers. Claims phone numbers. Coverage summary. Next steps. No digging through email or filing cabinets — and shareable with the people who matter when it matters.
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {[
                  'Instant access — no login required in emergencies',
                  'Shareable with family via secure PIN',
                  'Step-by-step checklists for every policy type',
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
              <div style={{
                background: '#fff', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)',
                padding: '10px 12px',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                  <span style={{ fontSize: 14 }}>🆘</span>
                  <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--color-text)' }}>Emergency Coverage Card</span>
                  <span style={{ fontSize: 10, fontWeight: 600, color: '#15803d', background: '#dcfce7', padding: '2px 8px', borderRadius: 10, marginLeft: 'auto', whiteSpace: 'nowrap' }}>Active</span>
                </div>
                <div style={{ fontSize: 10, color: 'var(--color-text-muted)' }}>Shared with Sarah M. · Last updated today</div>
              </div>
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

      {/* ── MORE YOU CAN DO HERE (Compare + Requirement Check) ───────── */}
      {/* Background flipped to #fff after the swap so we don't have two
          surface-colored sections back-to-back (Trust below is surface). */}
      <section id="more-tools" style={{ padding: '80px 24px', background: '#fff' }}>
        <div style={{ maxWidth: 960, margin: '0 auto' }}>
          <h2 style={{ fontSize: 28, fontWeight: 700, margin: '0 0 10px', textAlign: 'center', color: 'var(--color-text)' }}>
            More you can do here
          </h2>
          <p style={{ fontSize: 15, color: 'var(--color-text-secondary)', textAlign: 'center', margin: '0 0 48px', maxWidth: 620, marginLeft: 'auto', marginRight: 'auto' }}>
            Two everyday situations Covrabl makes simpler — for you and the agent who reviews them with you.
          </p>

          <div className="landing-steps" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>
            {/* ── Compare side-by-side ─────────────────────────────── */}
            <div style={{
              backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius-lg)', padding: 24, display: 'flex', flexDirection: 'column', gap: 14,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ fontSize: 22, lineHeight: 1 }}>⚖️</span>
                <h3 style={{ fontSize: 18, fontWeight: 700, margin: 0, color: 'var(--color-text)' }}>Compare policies side-by-side</h3>
              </div>
              <p style={{ fontSize: 14, color: 'var(--color-text-secondary)', margin: 0, lineHeight: 1.6 }}>
                Got a renewal quote, or shopping a second carrier? Drop both in and see the differences in plain language — limits, deductibles, what&apos;s covered, what changed.
              </p>
              {/* Mini comparison mock */}
              <div style={{
                backgroundColor: '#fff', border: '1px solid var(--color-border)',
                borderRadius: 'var(--radius-md)', padding: 12,
              }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, alignItems: 'center' }}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--color-text-muted)', textTransform: 'uppercase' }}>Coverage</div>
                  <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--color-text-muted)', textTransform: 'uppercase', textAlign: 'center' }}>Current</div>
                  <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--color-text-muted)', textTransform: 'uppercase', textAlign: 'center' }}>Quote</div>
                </div>
                {[
                  { label: 'Liability', current: '$300K', quote: '$500K', changed: true, direction: 'up' },
                  { label: 'Deductible', current: '$500', quote: '$1,000', changed: true, direction: 'up' },
                  { label: 'Premium', current: '$1,840', quote: '$1,720', changed: true, direction: 'down' },
                ].map(row => (
                  <div key={row.label} style={{
                    display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, alignItems: 'center',
                    padding: '8px 0', borderTop: '1px solid var(--color-border)',
                  }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text)' }}>{row.label}</div>
                    <div style={{ fontSize: 12, color: 'var(--color-text-secondary)', textAlign: 'center' }}>{row.current}</div>
                    <div style={{
                      fontSize: 12, fontWeight: 600, textAlign: 'center',
                      color: row.changed
                        ? (row.direction === 'up' ? 'var(--color-success)' : 'var(--color-info)')
                        : 'var(--color-text-secondary)',
                    }}>
                      {row.quote}{row.changed && (row.direction === 'up' ? ' ↑' : ' ↓')}
                    </div>
                  </div>
                ))}
              </div>
              <div style={{ fontSize: 12, color: 'var(--color-text-muted)', lineHeight: 1.5 }}>
                Used for renewals, quote shopping, and the &ldquo;is this actually the same coverage?&rdquo; question.
              </div>
            </div>

            {/* ── Requirement / lease check ────────────────────────── */}
            <div style={{
              backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius-lg)', padding: 24, display: 'flex', flexDirection: 'column', gap: 14,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ fontSize: 22, lineHeight: 1 }}>📜</span>
                <h3 style={{ fontSize: 18, fontWeight: 700, margin: 0, color: 'var(--color-text)' }}>Check a lease or requirement</h3>
              </div>
              <p style={{ fontSize: 14, color: 'var(--color-text-secondary)', margin: 0, lineHeight: 1.6 }}>
                Landlord, lender, or contract requiring specific coverage? Upload it and Covrabl compares the requirements against the policy you have on file — line by line.
              </p>
              {/* Mini compliance mock */}
              <div style={{
                backgroundColor: '#fff', border: '1px solid var(--color-border)',
                borderRadius: 'var(--radius-md)', padding: 12, display: 'flex', flexDirection: 'column', gap: 6,
              }}>
                {[
                  { req: 'General Liability ≥ $1M', status: 'Meets', color: '#16a34a' },
                  { req: 'Additional Insured', status: 'Meets', color: '#16a34a' },
                  { req: 'Workers’ Comp', status: 'Not found', color: '#dc2626' },
                  { req: 'Waiver of Subrogation', status: 'Unclear', color: '#d97706' },
                ].map(r => (
                  <div key={r.req} style={{
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    padding: '8px 10px', backgroundColor: '#fff', border: '1px solid var(--color-border)',
                    borderRadius: 'var(--radius-md)',
                  }}>
                    <span style={{ fontSize: 12, color: 'var(--color-text)', fontWeight: 500 }}>{r.req}</span>
                    <span style={{ fontSize: 11, fontWeight: 700, color: r.color }}>{r.status}</span>
                  </div>
                ))}
              </div>
              <div style={{ fontSize: 12, color: 'var(--color-text-muted)', lineHeight: 1.5 }}>
                A certificate says you have coverage. Covrabl shows whether the actual policy meets the terms.
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── TRUST & SECURITY ─────────────────────────────────────────── */}
      <section id="trust" ref={trustRef} style={{ padding: '72px 24px', background: 'var(--color-surface)' }}>
        <div style={{ maxWidth: 980, margin: '0 auto' }}>
          <h2 style={{ fontSize: 26, fontWeight: 700, margin: '0 0 8px', textAlign: 'center', color: 'var(--color-text)' }}>
            Built for privacy. Designed for clarity.
          </h2>
          <p style={{ fontSize: 15, color: 'var(--color-text-muted)', textAlign: 'center', margin: '0 0 40px' }}>
            Your insurance data is sensitive. We treat it that way.
          </p>
          <div className="landing-trust" style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 20 }}>
            {[
              { icon: '🔒', title: 'Encrypted everywhere', desc: 'AES-256 encryption in transit and at rest. Two-factor authentication available on every account.' },
              { icon: '🛡️', title: 'Your data stays yours', desc: 'We never sell, share, or monetize your information. No ads, no data deals.' },
              { icon: '👥', title: 'You control who sees what', desc: 'Your agent sees only what you choose to share. You can revoke access at any time.' },
              { icon: '📋', title: 'Transparent vendors', desc: 'Every third-party service we use is listed publicly on our subprocessors page.' },
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
          <div style={{ textAlign: 'center', marginTop: 24 }}>
            <span onClick={() => { trackClick('hiw_trust_security_link'); router.push('/security'); }} style={{ fontSize: 13, color: 'var(--color-primary)', cursor: 'pointer', textDecoration: 'underline' }}>
              Read our full security overview &rarr;
            </span>
          </div>
        </div>
      </section>

      {/* ── TESTIMONIALS (relational quotes only) ────────────────────── */}
      <section style={{ padding: '72px 24px', background: '#fff' }}>
        <div style={{ maxWidth: 960, margin: '0 auto' }}>
          <h2 style={{ fontSize: 26, fontWeight: 700, margin: '0 0 8px', textAlign: 'center', color: 'var(--color-text)' }}>
            What clients say
          </h2>
          <p style={{ fontSize: 15, color: 'var(--color-text-muted)', textAlign: 'center', margin: '0 0 40px' }}>
            Real conversations, in their own words.
          </p>
          <div className="landing-trust" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 20 }}>
            {[
              { quote: 'I finally understand what’s on my policy without having to call my agent for every little question.', who: 'Homeowner, 3 policies' },
              { quote: 'When my pipe burst at 11pm I had the claims number on my phone in 5 seconds. That alone is worth it.', who: 'Family, 5 policies' },
              { quote: 'My agent and I are on the same page now. Renewal calls are 10 minutes instead of an hour.', who: 'Small business owner' },
            ].map(t => (
              <div key={t.who} style={{
                backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-lg)',
                padding: '24px 20px', position: 'relative',
              }}>
                <div style={{ fontSize: 28, color: 'var(--color-border)', lineHeight: 1, marginBottom: 8 }}>&ldquo;</div>
                <p style={{ fontSize: 14, color: 'var(--color-text)', lineHeight: 1.65, margin: '0 0 16px' }}>{t.quote}</p>
                <div style={{ fontSize: 12, color: 'var(--color-text-muted)', fontWeight: 500 }}>{t.who}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── FAQ ──────────────────────────────────────────────────────── */}
      <section id="faq" style={{ padding: '80px 24px', background: 'var(--color-surface)' }}>
        <div style={{ maxWidth: 680, margin: '0 auto' }}>
          <h2 style={{ fontSize: 28, fontWeight: 700, margin: '0 0 40px', textAlign: 'center', color: 'var(--color-text)' }}>
            Frequently asked questions
          </h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
            {[
              {
                q: 'Why did my agent invite me here?',
                a: `Your agent uses ${APP_NAME} to keep coverage organized between renewals and to help spot things worth talking about before they become surprises. Inviting you in means you both see the same picture — so renewal conversations are quicker and more useful.`,
              },
              {
                q: 'What does my agent see?',
                a: 'Your agent can see the policies and documents you choose to share with them. You stay in control of that — and you can revoke access at any time from your account settings.',
              },
              {
                q: 'Is this required? Can I leave?',
                a: `No, it’s not required. You’re welcome to use ${APP_NAME} as long as it’s useful and stop using it whenever you want. You can export your data or delete your account from your profile at any time.`,
              },
              {
                q: 'Is my data safe?',
                a: `Yes. All data is encrypted in transit and at rest. Passwords are hashed with bcrypt, and two-factor authentication is available on every account. ${APP_NAME} is built to financial-application security standards.`,
              },
              {
                q: 'Do you sell my information?',
                a: `Never. Your policy data isn’t shared with carriers, advertisers, or any third party. ${APP_NAME} is paid for by the agencies that use it — not by selling your data.`,
              },
              {
                q: 'How does the document reading work?',
                a: `Upload a PDF or photo of any policy. ${APP_NAME} uses AI to pull out the carrier, limits, deductibles, renewal dates, and more. You review everything before it’s saved, and the original document stays on file.`,
              },
              {
                q: `What types of insurance work with ${APP_NAME}?`,
                a: 'Most of them. Auto, home, renters, life, health, umbrella, general liability, professional liability, cyber, workers’ comp, and more. Personal and business.',
              },
              {
                q: `Does ${APP_NAME} give me insurance advice?`,
                a: `No. ${APP_NAME} surfaces observations from your documents — things to ask about, things to confirm — so your conversation with your agent is more informed. Your agent is the one who advises you.`,
              },
            ].map((faq, i) => (
              <div key={i} style={{ borderBottom: '1px solid var(--color-border)' }}>
                <button
                  onClick={() => { trackClick('hiw_faq_toggle', { index: i }); setOpenFaq(openFaq === i ? null : i); }}
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

      {/* ── FINAL CTA ────────────────────────────────────────────────── */}
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
        <div style={{ maxWidth: 620, margin: '0 auto', position: 'relative' }}>
          <h2 style={{ fontSize: 30, fontWeight: 700, margin: '0 0 16px', letterSpacing: 'var(--letter-spacing-tight)' }}>
            {hasInvite ? 'Ready when you are.' : 'See it from the client side.'}
          </h2>
          <p style={{ fontSize: 17, opacity: 0.9, margin: '0 0 32px', lineHeight: 1.6 }}>
            {hasInvite
              ? 'Finish setting up your account and pick up where your agent left off.'
              : 'Walk through the same experience your clients see — no commitment, just a look around.'}
          </p>
          <button onClick={() => { trackClick('hiw_cta_final'); primaryCtaAction(); }} style={{
            padding: '16px 40px', fontSize: 18, fontWeight: 600,
            backgroundColor: 'var(--color-secondary)', color: '#fff',
            border: 'none', borderRadius: 'var(--radius-md)', cursor: 'pointer',
            boxShadow: '0 4px 14px rgba(63, 167, 163, 0.3)',
          }}>
            {primaryCtaLabel}
          </button>
          <div style={{ marginTop: 16, fontSize: 13, opacity: 0.6, letterSpacing: 'var(--letter-spacing-wide)' }}>
            Encrypted at rest and in transit · You control what your agent sees
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
              <span key={b.label} onClick={() => { trackClick('hiw_footer_trust_badge', { label: b.label }); router.push('/security'); }} style={{
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
            <span onClick={() => { trackClick('hiw_footer_for_agencies'); router.push('/'); }} style={{ cursor: 'pointer' }}>For agencies</span>
            <span onClick={() => { trackClick('hiw_footer_privacy'); router.push('/privacy'); }} style={{ cursor: 'pointer' }}>Privacy</span>
            <span onClick={() => { trackClick('hiw_footer_terms'); router.push('/terms'); }} style={{ cursor: 'pointer' }}>Terms</span>
            <span onClick={() => { trackClick('hiw_footer_security'); router.push('/security'); }} style={{ cursor: 'pointer' }}>Security</span>
            <span onClick={() => { trackClick('hiw_footer_subprocessors'); router.push('/subprocessors'); }} style={{ cursor: 'pointer' }}>Subprocessors</span>
            <span onClick={() => { trackClick('hiw_footer_support'); router.push('/support'); }} style={{ cursor: 'pointer' }}>Support</span>
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

export default function HowItWorksPage() {
  return (
    <Suspense fallback={<div style={{ padding: 64, textAlign: 'center', color: 'var(--color-text-secondary)' }}>Loading…</div>}>
      <HowItWorksInner />
    </Suspense>
  );
}
