'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import Logo from '../../components/Logo';

// ── Demo Data ──────────────────────────────────────

const SAMPLE_LEASE_TEXT = `8.2 Liability Insurance.
(a) Lessee shall obtain and keep in force a Commercial General Liability policy protecting Lessee and Lessor as an additional insured against claims for bodily injury, personal injury and property damage. Such insurance shall be on an occurrence basis providing single limit coverage in an amount not less than $1,000,000 per occurrence with an annual aggregate of not less than $2,000,000.

Lessee shall add Lessor as an additional insured by means of an endorsement at least as broad as the ISO "Additional Insured-Managers or Lessors of Premises" Endorsement. The policy shall not contain any intra-insured exclusions. Lessee's insurance shall be primary to and not contributory with any similar insurance carried by Lessor.

8.4 Worker's Compensation Insurance.
Lessee shall obtain and maintain Worker's Compensation Insurance in such amount as may be required by Applicable Requirements. Such policy shall include a 'Waiver of Subrogation' endorsement.

8.3 Property Insurance.
Lessor shall obtain and keep in force a policy of insurance insuring loss or damage to the Building. Lessee Owned Alterations and Utility Installations shall be insured by Lessee at full replacement cost with a deductible not to exceed $5,000 per occurrence.

8.5 Insurance Policies.
Insurance shall be by companies maintaining a "General Policyholders Rating" of at least A-, VII. No policy shall be cancelable except after 10 days prior written notice to Lessor. Lessee shall, at least 30 days prior to expiration, furnish Lessor with evidence of renewals.`;

const CATEGORY_LABELS: Record<string, string> = {
  general_liability: 'General Liability',
  commercial_auto: 'Commercial Auto',
  umbrella: 'Umbrella / Excess',
  workers_comp: "Workers' Comp",
  property: 'Property',
  professional_liability: 'Professional Liability',
  cyber: 'Cyber',
  other: 'Other',
};

const CATEGORY_COLORS: Record<string, { bg: string; fg: string }> = {
  general_liability: { bg: '#dbeafe', fg: '#1e40af' },
  commercial_auto: { bg: '#fce7f3', fg: '#9d174d' },
  umbrella: { bg: '#ede9fe', fg: '#5b21b6' },
  workers_comp: { bg: '#fef3c7', fg: '#92400e' },
  property: { bg: '#dcfce7', fg: '#166534' },
  professional_liability: { bg: '#e0e7ff', fg: '#3730a3' },
  cyber: { bg: '#f0fdfa', fg: '#115e59' },
  other: { bg: '#f3f4f6', fg: '#374151' },
};

const EXTRACTED_REQUIREMENTS = [
  { category: 'general_liability', label: 'CGL \u2014 $1M per occurrence / $2M aggregate', notes: 'Bodily injury, property damage, personal & advertising injury' },
  { category: 'general_liability', label: 'Additional Insured endorsement required', notes: 'Landlord + managing agent as additional insured' },
  { category: 'general_liability', label: 'Primary & Non-Contributory', notes: "Must be primary over Landlord's own coverage" },
  { category: 'property', label: 'Property Insurance \u2014 full replacement cost', notes: 'Personal property, fixtures, improvements; max $5K deductible' },
  { category: 'workers_comp', label: "Workers' Comp \u2014 statutory limits", notes: 'Waiver of Subrogation in favor of Landlord' },
  { category: 'other', label: 'Business Interruption \u2014 12 months minimum', notes: 'Fixed expenses and continuing obligations' },
  { category: 'other', label: "Carrier rating: A-VII Best's minimum", notes: 'All policies must meet this rating' },
  { category: 'other', label: 'Waiver of Subrogation \u2014 mutual', notes: 'Both parties waive subrogation for property losses' },
  { category: 'other', label: '30-day advance renewal notice', notes: 'Certificates due 30 days before renewal' },
  { category: 'other', label: '10-day cancellation notice to Landlord', notes: 'Written notice required prior to cancellation' },
];

const COMPLIANCE_RESULTS = [
  { label: 'CGL \u2014 $1M / $2M', category: 'general_liability', status: 'pass', note: 'Policy shows $1,000,000 per occurrence and $2,000,000 aggregate \u2014 meets requirement.' },
  { label: 'Additional Insured endorsement', category: 'general_liability', status: 'pass', note: 'Additional Insured endorsement (CG 20 26) found on policy.' },
  { label: 'Primary & Non-Contributory', category: 'general_liability', status: 'pass', note: 'Primary and non-contributory language confirmed.' },
  { label: 'Property Insurance \u2014 replacement cost', category: 'property', status: 'pass', note: 'Property coverage at replacement cost with $2,500 deductible (under $5K max).' },
  { label: "Workers' Comp \u2014 statutory", category: 'workers_comp', status: 'pass', note: "Workers' Compensation confirmed at statutory limits." },
  { label: 'Business Interruption \u2014 12 months', category: 'other', status: 'fail', note: 'Coverage shows 6-month limit \u2014 lease requires 12 months minimum.' },
  { label: "Carrier rating: A-VII Best's", category: 'other', status: 'pass', note: 'Hartford rated A+ (Superior) XV \u2014 exceeds A-VII requirement.' },
  { label: 'Waiver of Subrogation', category: 'other', status: 'unclear', note: 'Waiver of subrogation endorsement not found in uploaded documents. Verify with carrier.' },
  { label: '30-day renewal notice', category: 'other', status: 'pass', note: 'Policy includes 30-day notice provision.' },
  { label: '10-day cancellation notice', category: 'other', status: 'unclear', note: 'Standard 10-day notice for non-payment confirmed, but general cancellation notice period not explicitly stated.' },
];

const STATUS_CONFIG: Record<string, { icon: string; color: string; bg: string }> = {
  pass: { icon: '\u2713', color: '#166534', bg: '#dcfce7' },
  fail: { icon: '\u2717', color: '#991b1b', bg: '#fee2e2' },
  unclear: { icon: '?', color: '#92400e', bg: '#fef3c7' },
};

const WALKTHROUGH_STEPS = [
  { title: 'Paste your lease clause', description: 'Copy the insurance requirements section from your commercial lease and paste it in \u2014 or upload the lease as a PDF. Works with any lease format.', accent: '#2563eb', duration: 7000 },
  { title: 'AI extracts every requirement', description: 'Our AI reads the lease language and identifies each insurance requirement \u2014 coverage types, minimum limits, endorsements, carrier ratings, notice periods, and more.', accent: '#7c3aed', duration: 7000 },
  { title: 'Instant compliance check', description: 'Each requirement is checked against your actual policy. You see exactly what passes, what fails, and what needs clarification \u2014 with explanations for each.', accent: '#059669', duration: 7000 },
  { title: 'Share results & notify broker', description: 'Generate a shareable link for your landlord or tenant. Send a pre-written email to your broker highlighting exactly what needs attention.', accent: '#d97706', duration: 6000 },
];

const FEATURES = [
  { icon: '\uD83D\uDD0D', title: 'AI-Powered Extraction', description: 'Paste lease language or upload a PDF. AI identifies every insurance requirement \u2014 limits, endorsements, ratings, notice periods.' },
  { icon: '\u2705', title: 'Instant Compliance Check', description: 'Check requirements against your actual policy data. See pass, fail, and unclear results with plain-language explanations.' },
  { icon: '\uD83D\uDCE4', title: 'Share & Collaborate', description: 'Generate a public link for your landlord or tenant. Email your broker a summary of exactly what needs attention.' },
];

// ── Walkthrough Component ──────────────────────────

function LeaseCheckWalkthrough() {
  const [activeStep, setActiveStep] = useState(0);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    const step = WALKTHROUGH_STEPS[activeStep];
    const timer = setInterval(() => {
      setActiveStep(prev => (prev + 1) % WALKTHROUGH_STEPS.length);
      setProgress(0);
    }, step.duration);
    const progressTimer = setInterval(() => {
      setProgress(prev => Math.min(prev + 2, 100));
    }, step.duration / 50);
    return () => { clearInterval(timer); clearInterval(progressTimer); };
  }, [activeStep]);

  const step = WALKTHROUGH_STEPS[activeStep];

  return (
    <div style={{
      backgroundColor: '#fff', border: '1px solid #e5e7eb', borderRadius: 16,
      overflow: 'hidden', marginBottom: 48,
    }}>
      {/* Header */}
      <div style={{
        padding: '20px 24px', borderBottom: '1px solid #f3f4f6',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12,
      }}>
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#9ca3af', marginBottom: 4 }}>
            How it works
          </div>
          <div style={{ fontSize: 18, fontWeight: 700, color: '#111827' }}>
            From lease clause to compliance report
          </div>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          {WALKTHROUGH_STEPS.map((_, i) => (
            <button
              key={i}
              onClick={() => { setActiveStep(i); setProgress(0); }}
              style={{
                width: 32, height: 32, borderRadius: '50%', border: 'none', cursor: 'pointer',
                fontSize: 13, fontWeight: 700,
                backgroundColor: i === activeStep ? WALKTHROUGH_STEPS[i].accent : '#f3f4f6',
                color: i === activeStep ? '#fff' : '#9ca3af',
                transition: 'all 0.2s',
              }}
            >{i + 1}</button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="mobile-grid-1" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', minHeight: 340 }}>
        {/* Left \u2014 description */}
        <div style={{ padding: '32px 28px', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
          <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: step.accent, marginBottom: 8 }}>
            Step {activeStep + 1}
          </div>
          <h3 style={{ fontSize: 20, fontWeight: 700, margin: '0 0 10px', color: '#111827' }}>
            {step.title}
          </h3>
          <p style={{ fontSize: 14, color: '#6b7280', margin: 0, lineHeight: 1.7 }}>
            {step.description}
          </p>
        </div>

        {/* Right \u2014 visual */}
        <div style={{
          padding: '20px 24px', backgroundColor: '#fafbfc', borderLeft: '1px solid #f3f4f6',
          display: 'flex', flexDirection: 'column', justifyContent: 'flex-start', gap: 6,
          maxHeight: 400, overflowY: 'auto',
        }}>
          {/* Step 1: Typing animation */}
          {activeStep === 0 && (
            <>
              <div style={{
                backgroundColor: '#fff', border: '1px solid #e5e7eb', borderRadius: 10,
                padding: 16, fontFamily: 'monospace', fontSize: 11, lineHeight: 1.6,
                color: '#374151', whiteSpace: 'pre-wrap', minHeight: 200, maxHeight: 260, overflow: 'hidden',
                position: 'relative',
              }}>
                {SAMPLE_LEASE_TEXT.substring(0, Math.floor((progress / 100) * SAMPLE_LEASE_TEXT.length * 0.7))}
                <span style={{ borderRight: '2px solid #2563eb', animation: 'blink 1s step-end infinite', paddingRight: 1 }} />
              </div>
              <button style={{
                marginTop: 8, padding: '10px 20px', border: 'none', borderRadius: 8,
                fontWeight: 600, fontSize: 13, cursor: 'default',
                backgroundColor: progress > 40 ? '#2563eb' : '#e5e7eb',
                color: progress > 40 ? '#fff' : '#9ca3af',
                transition: 'all 0.3s',
              }}>
                {progress > 40 ? 'Extract Requirements \u2192' : 'Paste or upload lease clause...'}
              </button>
            </>
          )}

          {/* Step 2: Requirements appearing */}
          {activeStep === 1 && (
            <>
              <div style={{
                fontSize: 12, fontWeight: 600, color: progress > 80 ? '#059669' : '#7c3aed',
                marginBottom: 4, transition: 'color 0.3s',
              }}>
                {progress > 80
                  ? `\u2713 ${EXTRACTED_REQUIREMENTS.length} requirements found`
                  : '\u2026 Analyzing lease clause'}
              </div>
              {EXTRACTED_REQUIREMENTS.map((req, i) => {
                const isVisible = progress > (i * 8) + 5;
                const cc = CATEGORY_COLORS[req.category] || CATEGORY_COLORS.other;
                return (
                  <div key={i} style={{
                    display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px',
                    backgroundColor: '#fff', border: '1px solid #e5e7eb', borderRadius: 8,
                    opacity: isVisible ? 1 : 0.12,
                    transform: isVisible ? 'translateY(0)' : 'translateY(6px)',
                    transition: 'all 0.3s ease',
                  }}>
                    <span style={{
                      padding: '1px 6px', borderRadius: 10, fontSize: 9, fontWeight: 700,
                      backgroundColor: cc.bg, color: cc.fg, whiteSpace: 'nowrap', flexShrink: 0,
                    }}>
                      {CATEGORY_LABELS[req.category] || req.category}
                    </span>
                    <span style={{ fontSize: 12, fontWeight: 500, color: '#111827', flex: 1 }}>{req.label}</span>
                    {isVisible && progress > (i * 8) + 12 && (
                      <span style={{ color: '#16a34a', fontSize: 12, flexShrink: 0 }}>{'\u2713'}</span>
                    )}
                  </div>
                );
              })}
            </>
          )}

          {/* Step 3: Compliance results */}
          {activeStep === 2 && (
            <>
              {/* Summary counts */}
              <div style={{ display: 'flex', gap: 8, marginBottom: 8, opacity: progress > 8 ? 1 : 0, transition: 'opacity 0.4s' }}>
                {[
                  { label: 'Pass', count: 7, ...STATUS_CONFIG.pass },
                  { label: 'Fail', count: 1, ...STATUS_CONFIG.fail },
                  { label: 'Unclear', count: 2, ...STATUS_CONFIG.unclear },
                ].map(s => (
                  <div key={s.label} style={{
                    padding: '6px 14px', borderRadius: 8, backgroundColor: s.bg,
                    textAlign: 'center', flex: 1,
                  }}>
                    <div style={{ fontSize: 18, fontWeight: 700, color: s.color }}>{s.count}</div>
                    <div style={{ fontSize: 10, fontWeight: 600, color: s.color }}>{s.label}</div>
                  </div>
                ))}
              </div>
              {/* Results list */}
              {COMPLIANCE_RESULTS.map((r, i) => {
                const isVisible = progress > (i * 7) + 10;
                const si = STATUS_CONFIG[r.status] || STATUS_CONFIG.unclear;
                const cc = CATEGORY_COLORS[r.category] || CATEGORY_COLORS.other;
                return (
                  <div key={i} style={{
                    padding: '8px 12px', backgroundColor: '#fff', border: '1px solid #e5e7eb', borderRadius: 8,
                    opacity: isVisible ? 1 : 0.12,
                    transform: isVisible ? 'translateY(0)' : 'translateY(6px)',
                    transition: 'all 0.3s ease',
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{
                        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                        width: 18, height: 18, borderRadius: '50%',
                        backgroundColor: si.bg, color: si.color, fontSize: 10, fontWeight: 700, flexShrink: 0,
                      }}>{si.icon}</span>
                      <span style={{
                        padding: '1px 5px', borderRadius: 8, fontSize: 8, fontWeight: 700,
                        backgroundColor: cc.bg, color: cc.fg, flexShrink: 0,
                      }}>
                        {CATEGORY_LABELS[r.category] || r.category}
                      </span>
                      <span style={{ fontSize: 11, fontWeight: 600, color: '#111827' }}>{r.label}</span>
                    </div>
                    {isVisible && r.note && (
                      <p style={{ fontSize: 10, color: '#6b7280', margin: '3px 0 0 24px', lineHeight: 1.4 }}>{r.note}</p>
                    )}
                  </div>
                );
              })}
            </>
          )}

          {/* Step 4: Share */}
          {activeStep === 3 && (
            <>
              {/* Public link card */}
              <div style={{
                padding: 14, backgroundColor: '#fff', border: '1px solid #e5e7eb', borderRadius: 10,
                opacity: progress > 5 ? 1 : 0, transition: 'opacity 0.4s',
              }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: '#6b7280', marginBottom: 6 }}>Shareable Link</div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <div style={{
                    flex: 1, padding: '8px 10px', backgroundColor: '#f9fafb', border: '1px solid #e5e7eb',
                    borderRadius: 6, fontSize: 12, fontFamily: 'monospace', color: '#374151',
                  }}>
                    covrabl.com/lease-compliance/abc123
                  </div>
                  <div style={{
                    padding: '8px 14px', borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: 'default',
                    backgroundColor: progress > 30 ? '#dcfce7' : '#f3f4f6',
                    color: progress > 30 ? '#166534' : '#6b7280',
                    border: '1px solid', borderColor: progress > 30 ? '#bbf7d0' : '#e5e7eb',
                    transition: 'all 0.3s',
                  }}>
                    {progress > 30 ? '\u2713 Copied!' : 'Copy'}
                  </div>
                </div>
                <p style={{ fontSize: 11, color: '#9ca3af', margin: '6px 0 0' }}>
                  Tenant can view requirements and submit their COI for automated checking.
                </p>
              </div>

              {/* Broker email card */}
              <div style={{
                padding: 14, backgroundColor: '#fff', border: '1px solid #e5e7eb', borderRadius: 10,
                opacity: progress > 25 ? 1 : 0, transition: 'opacity 0.4s',
              }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: '#6b7280', marginBottom: 6 }}>Send to Broker</div>
                <div style={{ padding: 10, backgroundColor: '#f9fafb', borderRadius: 6, fontSize: 11, color: '#374151', lineHeight: 1.6 }}>
                  <div style={{ fontWeight: 600, marginBottom: 4 }}>Subject: Action needed \u2014 lease insurance gap</div>
                  <div style={{ color: '#6b7280' }}>
                    Hi Sarah,<br />
                    Our lease at 123 Main St requires 12-month business interruption coverage but our current policy only provides 6 months. Can we get this updated before the next renewal?
                  </div>
                </div>
                <div style={{
                  marginTop: 8, padding: '6px 14px', display: 'inline-block',
                  backgroundColor: '#2563eb', color: '#fff', borderRadius: 6,
                  fontSize: 11, fontWeight: 600,
                }}>
                  Open in Email
                </div>
              </div>

              {/* Notification */}
              <div style={{
                padding: '10px 14px', backgroundColor: '#dcfce7', borderRadius: 8,
                display: 'flex', alignItems: 'center', gap: 8,
                opacity: progress > 60 ? 1 : 0, transition: 'opacity 0.4s',
                transform: progress > 60 ? 'translateY(0)' : 'translateY(8px)',
              }}>
                <span style={{ fontSize: 14 }}>{'\u2709'}</span>
                <span style={{ fontSize: 12, fontWeight: 500, color: '#166534' }}>
                  Requirements sent to tenant@example.com
                </span>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Progress bar */}
      <div style={{ height: 3, backgroundColor: '#f3f4f6' }}>
        <div style={{
          height: '100%', width: `${progress}%`, backgroundColor: step.accent,
          transition: 'width 0.1s linear',
        }} />
      </div>
    </div>
  );
}

// ── Page Component ─────────────────────────────────

export default function LeaseCheckFeaturePage() {
  const router = useRouter();
  const walkthroughRef = useRef<HTMLDivElement>(null);

  function scrollToDemo() {
    walkthroughRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  return (
    <div style={{ minHeight: '100vh', backgroundColor: '#f8f9fa' }}>
      {/* Blink cursor animation */}
      <style>{`
        @keyframes blink { 50% { border-color: transparent; } }
      `}</style>

      {/* Header */}
      <div style={{ backgroundColor: '#1e3a5f', padding: '12px 24px' }}>
        <div style={{ maxWidth: 960, margin: '0 auto', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div onClick={() => router.push('/')} style={{ cursor: 'pointer' }}>
            <Logo size="md" variant="light" />
          </div>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <button
              onClick={() => router.push('/')}
              style={{
                background: 'none', border: '1px solid rgba(255,255,255,0.25)', color: '#fff',
                padding: '7px 16px', borderRadius: 6, fontSize: 13, fontWeight: 500, cursor: 'pointer',
              }}
            >
              Home
            </button>
            <button
              onClick={() => router.push('/login')}
              style={{
                backgroundColor: '#3FA7A3', color: '#fff', border: 'none',
                padding: '8px 18px', borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: 'pointer',
              }}
            >
              Get Started Free
            </button>
          </div>
        </div>
      </div>

      {/* Hero */}
      <section style={{
        padding: '72px 24px 56px',
        background: 'linear-gradient(160deg, #0f1f33 0%, #1e3a5f 70%, #2a4d7a 100%)',
        color: '#fff', textAlign: 'center',
      }}>
        <div style={{ maxWidth: 720, margin: '0 auto' }}>
          <div style={{
            display: 'inline-block', padding: '4px 14px', borderRadius: 20,
            backgroundColor: 'rgba(255,255,255,0.12)', fontSize: 12, fontWeight: 600,
            letterSpacing: '0.06em', marginBottom: 20, textTransform: 'uppercase',
          }}>
            Requirement Check
          </div>
          <h1 style={{ fontSize: 38, fontWeight: 700, margin: '0 0 16px', lineHeight: 1.2 }}>
            Know if your insurance meets every lease requirement
          </h1>
          <p style={{ fontSize: 17, opacity: 0.88, margin: '0 0 32px', lineHeight: 1.7 }}>
            Paste your commercial lease clause. AI extracts every insurance requirement,
            checks your policy against each one, and generates a shareable compliance report
            &mdash; in under 60 seconds.
          </p>
          <button
            onClick={scrollToDemo}
            style={{
              padding: '14px 32px', fontSize: 15, fontWeight: 600,
              backgroundColor: '#3FA7A3', color: '#fff', border: 'none', borderRadius: 8,
              cursor: 'pointer', boxShadow: '0 4px 14px rgba(63, 167, 163, 0.3)',
            }}
          >
            See How It Works
          </button>
        </div>
      </section>

      {/* Walkthrough */}
      <div ref={walkthroughRef} style={{ maxWidth: 960, margin: '0 auto', padding: '48px 24px 0' }}>
        <LeaseCheckWalkthrough />
      </div>

      {/* Use Cases */}
      <div style={{ maxWidth: 960, margin: '0 auto', padding: '0 24px 48px' }}>
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <h2 style={{ fontSize: 24, fontWeight: 700, color: '#111827', margin: '0 0 8px' }}>
            Built for both sides of the lease
          </h2>
          <p style={{ fontSize: 15, color: '#6b7280', margin: 0 }}>
            Whether you&apos;re a tenant proving compliance or a landlord verifying coverage.
          </p>
        </div>

        <div className="mobile-grid-1" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginBottom: 48 }}>
          {/* Tenant card */}
          <div style={{
            backgroundColor: '#fff', border: '1px solid #e5e7eb', borderRadius: 12, padding: 24,
          }}>
            <div style={{ fontSize: 28, marginBottom: 12 }}>{'\uD83C\uDFE2'}</div>
            <h3 style={{ fontSize: 17, fontWeight: 700, color: '#111827', margin: '0 0 8px' }}>For Tenants</h3>
            <ul style={{ margin: 0, padding: '0 0 0 18px', fontSize: 14, color: '#6b7280', lineHeight: 2 }}>
              <li>Paste your lease&apos;s insurance clause</li>
              <li>See exactly what your lease requires</li>
              <li>Check your policy against each requirement</li>
              <li>Send gaps directly to your broker</li>
            </ul>
          </div>
          {/* Landlord card */}
          <div style={{
            backgroundColor: '#fff', border: '1px solid #e5e7eb', borderRadius: 12, padding: 24,
          }}>
            <div style={{ fontSize: 28, marginBottom: 12 }}>{'\uD83D\uDD11'}</div>
            <h3 style={{ fontSize: 17, fontWeight: 700, color: '#111827', margin: '0 0 8px' }}>For Landlords</h3>
            <ul style={{ margin: 0, padding: '0 0 0 18px', fontSize: 14, color: '#6b7280', lineHeight: 2 }}>
              <li>Define your insurance requirements</li>
              <li>Share a link with your tenant</li>
              <li>Tenant uploads COI for automated checking</li>
              <li>Get notified with pass/fail results</li>
            </ul>
          </div>
        </div>

        {/* Feature cards */}
        <div className="mobile-grid-1" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 20, marginBottom: 48 }}>
          {FEATURES.map((f, i) => (
            <div key={i} style={{
              backgroundColor: '#fff', border: '1px solid #e5e7eb', borderRadius: 12, padding: 24,
              textAlign: 'center',
            }}>
              <div style={{ fontSize: 36, marginBottom: 12 }}>{f.icon}</div>
              <h3 style={{ fontSize: 15, fontWeight: 700, color: '#111827', margin: '0 0 8px' }}>{f.title}</h3>
              <p style={{ fontSize: 13, color: '#6b7280', margin: 0, lineHeight: 1.7 }}>{f.description}</p>
            </div>
          ))}
        </div>

        {/* Sample Output */}
        <div style={{ marginBottom: 48 }}>
          <div style={{ textAlign: 'center', marginBottom: 24 }}>
            <h2 style={{ fontSize: 24, fontWeight: 700, color: '#111827', margin: '0 0 8px' }}>
              What you get
            </h2>
            <p style={{ fontSize: 15, color: '#6b7280', margin: 0 }}>
              A clear compliance report for every requirement in your lease.
            </p>
          </div>
          <div style={{ backgroundColor: '#fff', border: '1px solid #e5e7eb', borderRadius: 12, overflow: 'hidden' }}>
            <div style={{ padding: '16px 20px', borderBottom: '1px solid #f3f4f6', fontSize: 13, fontWeight: 600, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              Sample Compliance Output
            </div>
            {[
              { label: 'General Liability \u2265 $1,000,000', status: 'pass' as const, evidence: 'COI shows $1,000,000 per occurrence and $2,000,000 aggregate.' },
              { label: 'Landlord named as Additional Insured', status: 'unclear' as const, evidence: 'COI references written contract; endorsement page not provided. Ask your broker to confirm.' },
              { label: 'AM Best Rating A- or better', status: 'fail' as const, evidence: 'Carrier rating not confirmed in uploaded documents.' },
            ].map((item, i) => {
              const si = STATUS_CONFIG[item.status];
              return (
                <div key={i} style={{ padding: '14px 20px', borderBottom: i < 2 ? '1px solid #f3f4f6' : 'none', display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                  <span style={{
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                    width: 22, height: 22, borderRadius: '50%', flexShrink: 0, marginTop: 1,
                    backgroundColor: si.bg, color: si.color, fontSize: 12, fontWeight: 700,
                  }}>{si.icon}</span>
                  <div style={{ flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
                      <span style={{ fontSize: 14, fontWeight: 600, color: '#111827' }}>{item.label}</span>
                      <span style={{ fontSize: 11, fontWeight: 600, color: si.color, textTransform: 'uppercase' }}>{item.status}</span>
                    </div>
                    <p style={{ fontSize: 13, color: '#6b7280', margin: 0, lineHeight: 1.5 }}>{item.evidence}</p>
                  </div>
                </div>
              );
            })}
          </div>
          <p style={{ fontSize: 13, color: '#6b7280', marginTop: 12, lineHeight: 1.6, textAlign: 'center' }}>
            <strong style={{ color: '#92400e' }}>Unclear</strong> means the uploaded documents don&apos;t provide
            definitive evidence for a requirement. The report explains exactly what to ask your broker to clarify.
          </p>
        </div>

        {/* CTA */}
        <div style={{
          textAlign: 'center', padding: '48px 32px',
          background: 'linear-gradient(160deg, #0f1f33 0%, #1e3a5f 100%)',
          borderRadius: 16, color: '#fff', marginBottom: 40,
        }}>
          <h2 style={{ fontSize: 24, fontWeight: 700, margin: '0 0 8px' }}>
            Check your first requirement in under a minute
          </h2>
          <p style={{ fontSize: 15, opacity: 0.85, margin: '0 0 24px' }}>
            Upload a commercial policy and paste your lease clause.
          </p>
          <button onClick={() => router.push('/login')} style={{
            padding: '14px 36px', fontSize: 16, fontWeight: 600,
            backgroundColor: '#3fa7a3', color: '#fff',
            border: 'none', borderRadius: 8, cursor: 'pointer',
            boxShadow: '0 4px 14px rgba(63, 167, 163, 0.3)',
          }}>
            Run Requirement Check
          </button>
          <div style={{ marginTop: 12, fontSize: 13, opacity: 0.6 }}>
            No credit card required
          </div>
        </div>

        {/* Disclaimer */}
        <p style={{ fontSize: 12, color: '#9ca3af', lineHeight: 1.7, textAlign: 'center', maxWidth: 640, margin: '0 auto 32px', padding: '0 16px' }}>
          Covrabl analyzes uploaded documents and summarizes insurance requirements. Results are informational
          and should be confirmed with your insurance broker or legal counsel before relying on them for
          contractual compliance.
        </p>

        {/* Footer */}
        <div style={{ textAlign: 'center', padding: '0 0 32px', fontSize: 12, color: '#9ca3af' }}>
          Powered by <a href="https://covrabl.com" style={{ color: '#6b7280', textDecoration: 'underline' }}>Covrabl</a>
        </div>
      </div>
    </div>
  );
}
