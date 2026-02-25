'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '../../lib/auth';
import { APP_NAME, APP_TAGLINE, APP_CONTACT_EMAIL } from './config';
import Logo from './components/Logo';

export default function Home() {
  const { token } = useAuth();
  const router = useRouter();
  const [openFaq, setOpenFaq] = useState<number | null>(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const scrollTo = (id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' });
    setMobileMenuOpen(false);
  };

  const ctaAction = () => router.push(token ? '/policies' : '/login');
  const ctaLabel = token ? 'View My Coverage' : 'Get Started Free';

  return (
    <div style={{ minHeight: '100vh', background: '#fff' }}>
      {/* ═══════════════════════════════════════════════════════════════
          NAVIGATION
      ═══════════════════════════════════════════════════════════════ */}
      {!token && (
        <header className="landing-header" style={{
          position: 'fixed', top: 0, left: 0, right: 0, zIndex: 100,
          background: 'rgba(255,255,255,0.95)', backdropFilter: 'blur(8px)',
          borderBottom: '1px solid var(--color-border)',
          padding: '12px 24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        }}>
          <div
            onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
            style={{ cursor: 'pointer' }}
          >
            <Logo size="md" variant="dark" />
          </div>
          <nav className="landing-nav-links">
            <span onClick={() => scrollTo('how-it-works')} style={{ fontSize: 14, color: 'var(--color-text-secondary)', cursor: 'pointer' }}>How it works</span>
            <span onClick={() => router.push('/pricing')} style={{ fontSize: 14, color: 'var(--color-text-secondary)', cursor: 'pointer' }}>Pricing</span>
            <span onClick={() => scrollTo('faq')} style={{ fontSize: 14, color: 'var(--color-text-secondary)', cursor: 'pointer' }}>FAQ</span>
            <button onClick={() => router.push('/login')} style={{
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
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
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
      {!token && mobileMenuOpen && (
        <div className="mobile-menu-dropdown" style={{
          position: 'fixed', top: 52, left: 0, right: 0, zIndex: 99,
          background: '#fff', borderBottom: '1px solid var(--color-border)',
          boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
          padding: '12px 24px',
          display: 'flex', flexDirection: 'column', gap: 4,
        }}>
          <button onClick={() => scrollTo('how-it-works')} style={{ padding: '12px 0', background: 'none', border: 'none', fontSize: 15, color: 'var(--color-text)', cursor: 'pointer', textAlign: 'left' }}>
            How it works
          </button>
          <button onClick={() => { router.push('/pricing'); setMobileMenuOpen(false); }} style={{ padding: '12px 0', background: 'none', border: 'none', fontSize: 15, color: 'var(--color-text)', cursor: 'pointer', textAlign: 'left' }}>
            Pricing
          </button>
          <button onClick={() => scrollTo('faq')} style={{ padding: '12px 0', background: 'none', border: 'none', fontSize: 15, color: 'var(--color-text)', cursor: 'pointer', textAlign: 'left' }}>
            FAQ
          </button>
          <button onClick={() => { router.push('/login'); setMobileMenuOpen(false); }} style={{
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
        paddingTop: token ? 60 : 120, paddingBottom: 80, paddingLeft: 24, paddingRight: 24,
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
            Do you actually know what your insurance covers?
          </h1>
          <p style={{ fontSize: 18, opacity: 0.95, margin: '0 0 8px', lineHeight: 1.7, maxWidth: 720, marginLeft: 'auto', marginRight: 'auto', fontWeight: 500 }}>
            Upload your policies. See your real coverage, spot the gaps, and be ready when something goes wrong.
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
            <button onClick={() => scrollTo('how-it-works')} style={{
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
            <span>Not a lead generator</span>
            <span>Your data stays yours</span>
          </div>
        </div>
      </section>

      {/* ═══════════════════════════════════════════════════════════════
          2. HOW IT WORKS (2 steps)
      ═══════════════════════════════════════════════════════════════ */}
      <section id="how-it-works" style={{ padding: '80px 24px', background: '#fff' }}>
        <div style={{ maxWidth: 960, margin: '0 auto' }}>
          <h2 style={{ fontSize: 28, fontWeight: 700, margin: '0 0 48px', textAlign: 'center', color: 'var(--color-text)' }}>
            How it works
          </h2>

          {/* Step 1 */}
          <div className="landing-steps" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 48, alignItems: 'center', marginBottom: 64 }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--color-primary)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 12 }}>Step 1</div>
              <h3 style={{ fontSize: 22, fontWeight: 600, margin: '0 0 12px', color: 'var(--color-text)' }}>Add your policies</h3>
              <p style={{ fontSize: 15, color: 'var(--color-text-secondary)', margin: 0, lineHeight: 1.7 }}>
                Upload a PDF or forward an email. {APP_NAME} reads your documents and extracts carrier, limits, deductibles, renewal dates, and more — automatically.
              </p>
            </div>
            <div style={{
              backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius-lg)', minHeight: 280, padding: 16, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 10, boxSizing: 'border-box',
            }}>
              {/* Fake document card */}
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
              <div style={{
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

          {/* Step 2 */}
          <div className="landing-steps" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 48, alignItems: 'center' }}>
            <div style={{
              backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius-lg)', minHeight: 280, padding: 16, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 8, boxSizing: 'border-box',
              order: 0,
            }}>
              {/* Stat cards row */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
                {[
                  { label: 'Annual Premium', value: '$4,850' },
                  { label: 'Active Policies', value: '5' },
                  { label: 'Upcoming Renewals', value: '2' },
                ].map(s => (
                  <div key={s.label} style={{
                    background: '#fff', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)',
                    padding: '8px 8px', textAlign: 'center',
                  }}>
                    <div style={{ fontSize: 9, fontWeight: 600, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{s.label}</div>
                    <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--color-text)', marginTop: 2 }}>{s.value}</div>
                  </div>
                ))}
              </div>
              {/* Mini policy tiles */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {[
                  { icon: '🚗', name: 'Auto', carrier: 'State Farm', color: '#15803d' },
                  { icon: '🏠', name: 'Home', carrier: 'Allstate', color: '#15803d' },
                  { icon: '☂️', name: 'Umbrella', carrier: 'USAA', color: '#15803d' },
                ].map(p => (
                  <div key={p.name} style={{
                    background: '#fff', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)',
                    padding: '8px 12px', display: 'flex', alignItems: 'center', gap: 8,
                  }}>
                    <span style={{ fontSize: 14 }}>{p.icon}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--color-text)' }}>{p.name}</span>
                      <span style={{ fontSize: 11, color: 'var(--color-text-muted)', marginLeft: 6 }}>· {p.carrier}</span>
                    </div>
                    <span style={{ width: 7, height: 7, borderRadius: '50%', backgroundColor: p.color, flexShrink: 0 }} />
                  </div>
                ))}
              </div>
            </div>
            <div style={{ order: 1 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--color-primary)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 12 }}>Step 2</div>
              <h3 style={{ fontSize: 22, fontWeight: 600, margin: '0 0 12px', color: 'var(--color-text)' }}>See your full picture</h3>
              <p style={{ fontSize: 15, color: 'var(--color-text-secondary)', margin: 0, lineHeight: 1.7 }}>
                Your dashboard shows annual premium, active policies, upcoming renewals, and gaps — all at a glance. No more guessing what you have.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ═══════════════════════════════════════════════════════════════
          3. EMERGENCY SECTION (elevated from Step 3)
      ═══════════════════════════════════════════════════════════════ */}
      <section style={{
        padding: '80px 24px',
        background: 'linear-gradient(160deg, #fef2f2 0%, #fff1f2 50%, #fff 100%)',
      }}>
        <div style={{ maxWidth: 960, margin: '0 auto' }}>
          <div className="landing-steps" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 48, alignItems: 'center' }}>
            <div>
              <h2 style={{ fontSize: 28, fontWeight: 700, margin: '0 0 16px', color: 'var(--color-text)' }}>
                Ready when something goes wrong.
              </h2>
              <p style={{ fontSize: 15, color: 'var(--color-text-secondary)', margin: '0 0 24px', lineHeight: 1.7 }}>
                Your Emergency Coverage Card puts critical policy details, claims numbers, and step-by-step guidance in one place — accessible offline and shareable with family.
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {[
                  'Offline access',
                  'Shareable via secure PIN',
                  'Step-by-step emergency checklists',
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
            {APP_NAME} exists to turn dense policy documents into simple, understandable coverage — so you can see exactly what you have, what you&apos;re missing, and what&apos;s coming up next.
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
                  onClick={() => setOpenFaq(openFaq === i ? null : i)}
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
            Know where you stand.
          </h2>
          <p style={{ fontSize: 18, opacity: 0.9, margin: '0 0 32px' }}>
            Your coverage is too important to guess about.
          </p>
          <button onClick={ctaAction} style={{
            padding: '16px 40px', fontSize: 18, fontWeight: 600,
            backgroundColor: 'var(--color-secondary)', color: '#fff',
            border: 'none', borderRadius: 'var(--radius-md)', cursor: 'pointer',
            boxShadow: '0 4px 14px rgba(63, 167, 163, 0.3)',
            transition: 'transform 0.15s, box-shadow 0.15s',
          }}>
            {ctaLabel}
          </button>
          <div style={{ marginTop: 16, fontSize: 13, opacity: 0.6, letterSpacing: 'var(--letter-spacing-wide)' }}>
            Free for up to 3 policies, forever. No credit card required.
          </div>
        </div>
      </section>

      {/* ═══════════════════════════════════════════════════════════════
          FOOTER
      ═══════════════════════════════════════════════════════════════ */}
      <footer style={{ padding: '32px 24px', borderTop: '1px solid var(--color-border)', color: 'var(--color-text-muted)', fontSize: 13 }}>
        <div style={{ maxWidth: 700, margin: '0 auto' }}>
          <div style={{ display: 'flex', justifyContent: 'center', gap: 24, marginBottom: 16 }}>
            <span onClick={() => router.push('/privacy')} style={{ cursor: 'pointer' }}>Privacy</span>
            <span onClick={() => router.push('/terms')} style={{ cursor: 'pointer' }}>Terms</span>
            <span onClick={() => router.push('/support')} style={{ cursor: 'pointer' }}>Support</span>
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
