'use client';

import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { APP_NAME, APP_CONTACT_EMAIL } from '../config';

export default function SecurityPage() {
  const router = useRouter();

  const sections = [
    {
      icon: '\u{1F512}',
      title: 'Your Documents Are Protected',
      body: `Every document you upload is encrypted in storage. Access is limited strictly to your account — no one else can view your policies, certificates, or personal information. ${APP_NAME} uses industry-standard encryption to keep your files safe at rest and in transit.`,
    },
    {
      icon: '\u{1F6E1}\uFE0F',
      title: 'Your Data Stays Private',
      body: `Your insurance data is never sold, rented, or shared with third parties. ${APP_NAME} uses your documents only to provide you with coverage analysis, gap detection, and renewal tracking. We do not monetize your data in any way.`,
    },
    {
      icon: '\u{1F511}',
      title: 'You Control Your Data',
      body: 'You can delete any document or policy at any time. You decide what stays in your vault and what gets removed. If you ever want to export or delete your entire account, you can do so from your profile settings.',
    },
    {
      icon: '\u{1F5A5}\uFE0F',
      title: 'Our Infrastructure',
      body: `${APP_NAME} is hosted on secure cloud infrastructure with encrypted databases, secure API connections, and regular security updates. All communication between your browser and our servers is encrypted with TLS. We follow security best practices to protect your information.`,
    },
  ];

  return (
    <div style={{ maxWidth: 700, margin: '0 auto', padding: '48px 24px 80px' }}>
      <div style={{ marginBottom: 40, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <Link href="/" style={{ fontSize: 20, fontWeight: 700, color: 'var(--color-primary)', textDecoration: 'none' }}>
          {APP_NAME}
        </Link>
        <button onClick={() => router.back()} style={{ background: 'none', border: 'none', fontSize: 14, color: 'var(--color-text-secondary)', cursor: 'pointer' }}>
          &larr; Back
        </button>
      </div>

      <h1 style={{ fontSize: 32, fontWeight: 700, margin: '0 0 8px', color: 'var(--color-text)' }}>
        Security &amp; Privacy
      </h1>
      <p style={{ margin: '0 0 40px', fontSize: 15, color: 'var(--color-text-muted)', lineHeight: 1.6 }}>
        Your insurance documents are sensitive. Here&apos;s how {APP_NAME} keeps them safe.
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
        {sections.map((s) => (
          <div
            key={s.title}
            style={{
              background: 'var(--color-surface)',
              border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius-md)',
              padding: '24px 28px',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
              <span style={{ fontSize: 22 }}>{s.icon}</span>
              <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: 'var(--color-text)' }}>{s.title}</h2>
            </div>
            <p style={{ margin: 0, fontSize: 14, color: 'var(--color-text-secondary)', lineHeight: 1.7 }}>
              {s.body}
            </p>
          </div>
        ))}
      </div>

      {/* Questions / Contact */}
      <div style={{
        marginTop: 40, padding: '24px 28px',
        background: '#f0fdf4', border: '1px solid #bbf7d0',
        borderRadius: 'var(--radius-md)', textAlign: 'center',
      }}>
        <h3 style={{ margin: '0 0 8px', fontSize: 16, fontWeight: 700, color: '#166534' }}>Questions?</h3>
        <p style={{ margin: 0, fontSize: 14, color: '#166534', lineHeight: 1.6 }}>
          If you have questions about how we handle your data, reach out at{' '}
          <a href={`mailto:${APP_CONTACT_EMAIL}`} style={{ color: '#15803d', fontWeight: 600 }}>{APP_CONTACT_EMAIL}</a>
          {' '}or visit our{' '}
          <span onClick={() => router.push('/privacy')} style={{ color: '#15803d', fontWeight: 600, cursor: 'pointer', textDecoration: 'underline' }}>Privacy Policy</span>.
        </p>
      </div>
    </div>
  );
}
