'use client';

import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { APP_NAME, APP_PRIVACY_EMAIL } from '../config';

const SUBPROCESSORS: Array<{
  vendor: string;
  category: string;
  data: string;
  location: string;
  website: string;
}> = [
  {
    vendor: 'Cloudflare',
    category: 'Object storage (R2)',
    data: 'Uploaded policy documents (PDFs, images). Stored encrypted at rest.',
    location: 'Global (Cloudflare network)',
    website: 'https://www.cloudflare.com/privacypolicy/',
  },
  {
    vendor: 'Railway',
    category: 'Application hosting + managed PostgreSQL',
    data: 'Application database (user accounts, policies, agency relationships, audit logs). Encrypted at rest by default.',
    location: 'United States',
    website: 'https://railway.com/legal/privacy',
  },
  {
    vendor: 'Vercel',
    category: 'Frontend (Next.js) hosting',
    data: 'Static frontend assets only. No customer data is stored on Vercel — all customer data flows directly between the browser and the Railway-hosted API.',
    location: 'Global edge network',
    website: 'https://vercel.com/legal/privacy-policy',
  },
  {
    vendor: 'OpenAI',
    category: 'AI document extraction',
    data: 'Text extracted from uploaded policy documents is sent to OpenAI for structured-field extraction (carrier, premium, deductible, etc.). Per OpenAI’s API policy, this data is NOT used to train models. Documents themselves are not sent — only the extracted text.',
    location: 'United States',
    website: 'https://openai.com/policies/privacy-policy',
  },
  {
    vendor: 'Resend',
    category: 'Transactional email delivery',
    data: 'Recipient email addresses and email body content (renewal reminders, invitation emails, password resets, share notifications).',
    location: 'United States',
    website: 'https://resend.com/legal/privacy-policy',
  },
  {
    vendor: 'Stripe',
    category: 'Payment processing',
    data: 'Billing information (customer ID, subscription state). Card details are never stored on Covrabl servers — they are tokenized by Stripe.',
    location: 'United States',
    website: 'https://stripe.com/privacy',
  },
  {
    vendor: 'GitHub',
    category: 'Source code hosting',
    data: 'Application source code only. No customer data.',
    location: 'United States',
    website: 'https://docs.github.com/en/site-policy/privacy-policies/github-general-privacy-statement',
  },
];

export default function SubprocessorsPage() {
  const router = useRouter();
  const lastUpdated = 'May 8, 2026';

  return (
    <div style={{ maxWidth: 860, margin: '0 auto', padding: '48px 24px 80px' }}>
      <div style={{ marginBottom: 40, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <Link href="/" style={{ fontSize: 20, fontWeight: 700, color: 'var(--color-primary)', textDecoration: 'none' }}>
          {APP_NAME}
        </Link>
        <button onClick={() => router.back()} style={{ background: 'none', border: 'none', fontSize: 14, color: 'var(--color-text-secondary)', cursor: 'pointer' }}>
          &larr; Back
        </button>
      </div>

      <h1 style={{ fontSize: 32, fontWeight: 700, margin: '0 0 8px', color: 'var(--color-text)' }}>
        Subprocessors
      </h1>
      <p style={{ fontSize: 14, color: 'var(--color-text-muted)', margin: '0 0 32px' }}>
        Last updated: {lastUpdated}
      </p>

      <div style={{ marginBottom: 32, lineHeight: 1.7, color: 'var(--color-text-secondary)' }}>
        <p style={{ fontSize: 15 }}>
          A <strong>subprocessor</strong> is a third-party service that {APP_NAME} relies on to operate the platform. This page lists every subprocessor that may process customer data, what data they handle, and where they’re located.
        </p>
        <p style={{ fontSize: 15 }}>
          We commit to keeping this list current. When a subprocessor is added or removed we update this page; significant changes are also announced to active customers via email.
        </p>
      </div>

      <div style={{
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius-md)',
        overflow: 'hidden',
        marginBottom: 32,
        backgroundColor: 'var(--color-surface)',
      }}>
        {SUBPROCESSORS.map((sp, i) => (
          <div
            key={sp.vendor}
            style={{
              padding: '18px 20px',
              borderTop: i === 0 ? 'none' : '1px solid var(--color-border)',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: 8, marginBottom: 8 }}>
              <div style={{ fontSize: 17, fontWeight: 700, color: 'var(--color-text)' }}>{sp.vendor}</div>
              <a href={sp.website} target="_blank" rel="noopener noreferrer" style={{ fontSize: 12, color: 'var(--color-primary)', textDecoration: 'none' }}>
                Privacy policy &rarr;
              </a>
            </div>
            <div style={{ fontSize: 13, color: 'var(--color-text-muted)', marginBottom: 6, fontWeight: 500 }}>
              {sp.category} &middot; {sp.location}
            </div>
            <div style={{ fontSize: 14, color: 'var(--color-text-secondary)', lineHeight: 1.55 }}>
              {sp.data}
            </div>
          </div>
        ))}
      </div>

      <div style={{
        padding: '14px 18px',
        backgroundColor: '#f0f9ff',
        border: '1px solid #bae6fd',
        borderRadius: 'var(--radius-md)',
        fontSize: 13,
        lineHeight: 1.6,
        color: '#0c4a6e',
        marginBottom: 24,
      }}>
        <strong>What we don’t do:</strong> We do not sell, rent, or trade customer data. We do not use customer data to train AI models. Aggregated, fully-anonymized analytics may be used internally to improve the product but never shared externally.
      </div>

      <p style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>
        Questions about our subprocessors? Email <a href={`mailto:${APP_PRIVACY_EMAIL}`} style={{ color: 'var(--color-primary)' }}>{APP_PRIVACY_EMAIL}</a>.
      </p>
    </div>
  );
}
