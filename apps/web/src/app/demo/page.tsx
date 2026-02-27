'use client';

import { useRouter } from 'next/navigation';
import { APP_NAME } from '../config';

const SAMPLE_POLICIES = [
  {
    id: 1,
    type: 'Auto',
    icon: '\u{1F697}',
    carrier: 'State Farm',
    policyNumber: 'SF-8834201',
    coverage: '$500K / $1M',
    deductible: '$500',
    premium: '$1,840/yr',
    renewal: 'Mar 14, 2026',
    statusLabel: 'Active',
    statusColor: '#16a34a',
    statusBg: '#dcfce7',
  },
  {
    id: 2,
    type: 'Homeowners',
    icon: '\u{1F3E0}',
    carrier: 'Allstate',
    policyNumber: 'AL-7729104',
    coverage: '$450K dwelling',
    deductible: '$2,500',
    premium: '$2,180/yr',
    renewal: 'Jun 1, 2026',
    statusLabel: 'Review',
    statusColor: '#d97706',
    statusBg: '#fef3c7',
  },
];

const SAMPLE_GAPS = [
  { severity: 'high', name: 'No umbrella liability policy', description: 'Your auto liability is capped at $500K/$1M. A serious accident could exceed this. An umbrella policy adds $1M+ of extra protection for ~$200/yr.' },
  { severity: 'medium', name: 'Coverage may not match replacement costs', description: 'Your $450K dwelling coverage may fall short of current rebuilding costs in your area. Consider reviewing your limits with your agent.' },
  { severity: 'low', name: 'No roadside assistance', description: 'Adding roadside assistance to your auto policy would cost approximately $20/yr and covers towing, flat tires, and lockouts.' },
];

const SAMPLE_CHAT = [
  { role: 'user', text: 'Am I covered if a tree falls on my car?' },
  { role: 'ai', text: 'Yes. Your State Farm auto policy (SF-8834201) includes comprehensive coverage with a $500 deductible. Falling objects, including trees, are covered under comprehensive. You would pay the $500 deductible and State Farm covers the rest up to your policy limit.' },
];

export default function DemoPage() {
  const router = useRouter();

  return (
    <div style={{ minHeight: '100vh', background: '#f8f9fa' }}>
      {/* Demo Banner */}
      <div style={{
        background: 'linear-gradient(90deg, #2563eb, #7c3aed)',
        color: '#fff', padding: '10px 24px', textAlign: 'center',
        fontSize: 13, fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12,
      }}>
        <span>This is sample data — not a real account</span>
        <button onClick={() => router.push('/login')} style={{
          padding: '4px 16px', fontSize: 12, fontWeight: 600,
          backgroundColor: '#fff', color: '#2563eb', border: 'none', borderRadius: 6, cursor: 'pointer',
        }}>Create your free account</button>
      </div>

      <div style={{ maxWidth: 900, margin: '0 auto', padding: '32px 24px' }}>
        {/* Back link */}
        <button onClick={() => router.push('/')} style={{
          background: 'none', border: 'none', cursor: 'pointer', fontSize: 14,
          color: '#6b7280', padding: '4px 0', marginBottom: 24, display: 'inline-flex', alignItems: 'center', gap: 6,
        }}>
          &larr; Back to home
        </button>

        {/* Header */}
        <div style={{ marginBottom: 32 }}>
          <h1 style={{ fontSize: 24, fontWeight: 700, margin: '0 0 4px', color: '#111827' }}>
            Sample Dashboard
          </h1>
          <p style={{ fontSize: 14, color: '#6b7280', margin: 0 }}>
            2 policies &middot; Last updated today
          </p>
        </div>

        {/* Policies */}
        <h2 style={{ fontSize: 18, fontWeight: 600, margin: '0 0 16px', color: '#111827' }}>Your Policies</h2>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 40 }}>
          {SAMPLE_POLICIES.map(p => (
            <div key={p.id} style={{
              backgroundColor: '#fff', border: '1px solid #e5e7eb', borderRadius: 12, padding: 20,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
                <span style={{ fontSize: 28 }}>{p.icon}</span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 16, fontWeight: 600, color: '#111827' }}>{p.carrier}</div>
                  <div style={{ fontSize: 12, color: '#6b7280' }}>{p.type} &middot; {p.policyNumber}</div>
                </div>
                <span style={{
                  fontSize: 11, fontWeight: 600, color: p.statusColor,
                  background: p.statusBg, padding: '3px 10px', borderRadius: 10,
                }}>{p.statusLabel}</span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                {[
                  { label: 'Coverage', value: p.coverage },
                  { label: 'Deductible', value: p.deductible },
                  { label: 'Premium', value: p.premium },
                  { label: 'Renewal', value: p.renewal },
                ].map(f => (
                  <div key={f.label}>
                    <div style={{ fontSize: 10, fontWeight: 600, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{f.label}</div>
                    <div style={{ fontSize: 13, fontWeight: 500, color: '#111827', marginTop: 2 }}>{f.value}</div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* Coverage Gaps */}
        <h2 style={{ fontSize: 18, fontWeight: 600, margin: '0 0 16px', color: '#111827' }}>Coverage Gaps &amp; Insights</h2>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 40 }}>
          {SAMPLE_GAPS.map((gap, i) => {
            const colors = {
              high: { bg: '#fef2f2', border: '#fecaca', fg: '#991b1b', label: 'HIGH' },
              medium: { bg: '#fffbeb', border: '#fde68a', fg: '#92400e', label: 'MEDIUM' },
              low: { bg: '#eff6ff', border: '#bfdbfe', fg: '#1e40af', label: 'LOW' },
            }[gap.severity]!;
            return (
              <div key={i} style={{
                padding: '16px 20px', borderRadius: 12,
                backgroundColor: colors.bg, border: `1px solid ${colors.border}`,
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
                  <span style={{
                    fontSize: 10, fontWeight: 700, textTransform: 'uppercase',
                    color: colors.fg, padding: '2px 8px', borderRadius: 6,
                    backgroundColor: `${colors.fg}15`,
                  }}>{colors.label}</span>
                  <span style={{ fontSize: 14, fontWeight: 600, color: colors.fg }}>{gap.name}</span>
                </div>
                <p style={{ fontSize: 13, color: colors.fg, margin: 0, opacity: 0.85, lineHeight: 1.6 }}>
                  {gap.description}
                </p>
              </div>
            );
          })}
        </div>

        {/* AI Chat Preview */}
        <h2 style={{ fontSize: 18, fontWeight: 600, margin: '0 0 16px', color: '#111827' }}>AI Coverage Chat</h2>
        <div style={{
          backgroundColor: '#fff', border: '1px solid #e5e7eb', borderRadius: 12,
          padding: 20, marginBottom: 40,
        }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {SAMPLE_CHAT.map((msg, i) => (
              <div key={i} style={{ display: 'flex', justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start' }}>
                <div style={{
                  maxWidth: '80%', padding: '12px 16px', borderRadius: 12, fontSize: 14, lineHeight: 1.6,
                  ...(msg.role === 'user'
                    ? { backgroundColor: '#2563eb', color: '#fff', borderBottomRightRadius: 4 }
                    : { backgroundColor: '#f3f4f6', color: '#111827', borderBottomLeftRadius: 4 }),
                }}>
                  {msg.text}
                </div>
              </div>
            ))}
          </div>
          <div style={{
            marginTop: 16, padding: '10px 14px', border: '1px solid #e5e7eb', borderRadius: 8,
            display: 'flex', alignItems: 'center', gap: 8, color: '#9ca3af', fontSize: 14,
          }}>
            <span style={{ flex: 1 }}>Ask about your coverage...</span>
            <span style={{ color: '#2563eb' }}>&#10148;</span>
          </div>
        </div>

        {/* CTA */}
        <div style={{
          textAlign: 'center', padding: '48px 32px',
          background: 'linear-gradient(160deg, #0f1f33 0%, #1e3a5f 100%)',
          borderRadius: 16, color: '#fff',
        }}>
          <h2 style={{ fontSize: 24, fontWeight: 700, margin: '0 0 8px' }}>
            See this for your own policies
          </h2>
          <p style={{ fontSize: 15, opacity: 0.85, margin: '0 0 24px' }}>
            Upload your first policy and get insights in under a minute. Free for up to 3 policies.
          </p>
          <button onClick={() => router.push('/login')} style={{
            padding: '14px 36px', fontSize: 16, fontWeight: 600,
            backgroundColor: '#3fa7a3', color: '#fff',
            border: 'none', borderRadius: 8, cursor: 'pointer',
            boxShadow: '0 4px 14px rgba(63, 167, 163, 0.3)',
          }}>
            Get Started Free
          </button>
          <div style={{ marginTop: 12, fontSize: 13, opacity: 0.6 }}>
            No credit card required
          </div>
        </div>

        {/* Footer note */}
        <div style={{ textAlign: 'center', padding: '24px 0', fontSize: 12, color: '#9ca3af' }}>
          Powered by {APP_NAME}
        </div>
      </div>
    </div>
  );
}
