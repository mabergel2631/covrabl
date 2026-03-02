'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { APP_NAME, APP_CONTACT_EMAIL, APP_PRIVACY_EMAIL } from '../config';
import Logo from '../components/Logo';

const FAQ_ITEMS = [
  {
    q: 'I can\'t log in to my account',
    a: `Try resetting your password from the login page. If you still can't access your account, email ${APP_CONTACT_EMAIL} with the email address you registered with and we'll help you get back in.`,
  },
  {
    q: 'How do I export my data?',
    a: 'You can download individual policy documents from each policy\'s detail page. For a full data export, email us at ' + APP_CONTACT_EMAIL + ' and we\'ll send you everything we have on file.',
  },
  {
    q: 'How do I delete my account?',
    a: 'Go to your Profile page, scroll to the "Danger Zone" section, and click "Delete Account." You\'ll need to confirm with your password. This permanently removes all your data and cannot be undone.',
  },
  {
    q: 'I was charged incorrectly or need a refund',
    a: `Email ${APP_CONTACT_EMAIL} with your account email and a description of the issue. We'll review and respond within one business day.`,
  },
  {
    q: 'How is my data protected?',
    a: `All data is encrypted in transit (TLS) and at rest (AES-256). Passwords are hashed with bcrypt. We never sell or share your information with third parties. See our Privacy Policy for full details.`,
  },
  {
    q: 'I found a bug or have a feature request',
    a: `We'd love to hear from you. Email ${APP_CONTACT_EMAIL} with as much detail as possible — screenshots help! We read every message.`,
  },
];

export default function SupportPage() {
  const router = useRouter();
  const [openFaq, setOpenFaq] = useState<number | null>(null);

  return (
    <div style={{ minHeight: '100vh', background: '#fff' }}>
      {/* Header */}
      <header style={{
        borderBottom: '1px solid var(--color-border)',
        padding: '12px 24px',
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <button onClick={() => router.back()} style={{ background: 'none', border: 'none', fontSize: 14, color: 'var(--color-text-secondary)', cursor: 'pointer' }}>
            &larr; Back
          </button>
          <div onClick={() => router.push('/')} style={{ cursor: 'pointer' }}>
            <Logo size="md" variant="dark" />
          </div>
        </div>
        <button
          onClick={() => router.push('/login')}
          style={{
            padding: '8px 20px', fontSize: 14, fontWeight: 600,
            backgroundColor: 'var(--color-primary)', color: '#fff',
            border: 'none', borderRadius: 'var(--radius-md)', cursor: 'pointer',
          }}
        >
          Sign in
        </button>
      </header>

      {/* Content */}
      <div style={{ maxWidth: 680, margin: '0 auto', padding: '48px 24px' }}>
        <h1 style={{ fontSize: 32, fontWeight: 700, margin: '0 0 8px', color: 'var(--color-text)' }}>
          Support
        </h1>
        <p style={{ fontSize: 16, color: 'var(--color-text-secondary)', margin: '0 0 40px', lineHeight: 1.6 }}>
          Need help? We&apos;re here for you. Check the common questions below or reach out directly.
        </p>

        {/* Contact Cards */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 48 }}>
          <a
            href={`mailto:${APP_CONTACT_EMAIL}`}
            style={{
              display: 'block', padding: '20px 20px',
              border: '1px solid var(--color-border)', borderRadius: 'var(--radius-lg)',
              textDecoration: 'none', color: 'inherit',
              transition: 'border-color 0.15s',
            }}
          >
            <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--color-text)', marginBottom: 4 }}>
              General Support
            </div>
            <div style={{ fontSize: 14, color: 'var(--color-primary)' }}>{APP_CONTACT_EMAIL}</div>
            <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 8 }}>
              Account issues, billing, bugs, feature requests
            </div>
          </a>
          <a
            href={`mailto:${APP_PRIVACY_EMAIL}`}
            style={{
              display: 'block', padding: '20px 20px',
              border: '1px solid var(--color-border)', borderRadius: 'var(--radius-lg)',
              textDecoration: 'none', color: 'inherit',
              transition: 'border-color 0.15s',
            }}
          >
            <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--color-text)', marginBottom: 4 }}>
              Privacy &amp; Data
            </div>
            <div style={{ fontSize: 14, color: 'var(--color-primary)' }}>{APP_PRIVACY_EMAIL}</div>
            <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 8 }}>
              Data requests, deletion, privacy concerns
            </div>
          </a>
        </div>

        {/* FAQ */}
        <h2 style={{ fontSize: 22, fontWeight: 700, margin: '0 0 24px', color: 'var(--color-text)' }}>
          Common Questions
        </h2>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
          {FAQ_ITEMS.map((faq, i) => (
            <div key={i} style={{ borderBottom: '1px solid var(--color-border)' }}>
              <button
                onClick={() => setOpenFaq(openFaq === i ? null : i)}
                style={{
                  width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  padding: '18px 0', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left',
                }}
              >
                <span style={{ fontSize: 15, fontWeight: 600, color: 'var(--color-text)', paddingRight: 16 }}>
                  {faq.q}
                </span>
                <span style={{
                  fontSize: 20, color: 'var(--color-text-muted)', flexShrink: 0, lineHeight: 1,
                  transform: openFaq === i ? 'rotate(45deg)' : 'none', transition: 'transform 0.2s',
                }}>+</span>
              </button>
              {openFaq === i && (
                <div style={{ padding: '0 0 18px', fontSize: 14, color: 'var(--color-text-secondary)', lineHeight: 1.7 }}>
                  {faq.a}
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Bottom note */}
        <div style={{ marginTop: 48, textAlign: 'center' }}>
          <p style={{ fontSize: 14, color: 'var(--color-text-muted)', lineHeight: 1.6 }}>
            We typically respond within one business day.<br />
            {APP_NAME} &mdash; Coverage Clarity
          </p>
          <button
            onClick={() => router.back()}
            style={{
              background: 'none', border: 'none', fontSize: 14, color: 'var(--color-text-secondary)',
              cursor: 'pointer', marginTop: 12,
            }}
          >
            &larr; Back
          </button>
        </div>
      </div>
    </div>
  );
}
