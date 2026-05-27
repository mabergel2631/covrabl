'use client';

import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { APP_NAME, APP_CONTACT_EMAIL, APP_SECURITY_EMAIL } from '../config';

export default function SecurityPage() {
  const router = useRouter();

  const sections = [
    {
      icon: '\u{1F512}',
      title: 'Encryption in transit and at rest',
      body: `All traffic between your browser and Covrabl is encrypted with TLS. Uploaded documents and policy data are encrypted at rest using AES-256 in Cloudflare R2 (object storage) and Postgres (Railway, managed). No customer data is stored on the frontend host.`,
    },
    {
      icon: '\u{1F511}',
      title: 'Multi-factor authentication (MFA)',
      body: `${APP_NAME} supports TOTP-based two-factor authentication on every account. Once enabled, sign-in requires both your password and a code from an authenticator app (Authy, 1Password, Google Authenticator, etc.). Recovery codes are issued at setup. Agency owners can require MFA across their team.`,
    },
    {
      icon: '\u{1F6E1}️',
      title: 'Your data stays yours',
      body: `Customer data is never sold, rented, or shared with third parties for marketing or lead generation. Covrabl does not use customer data to train AI models. Aggregated, fully-anonymized analytics may be used internally to improve the product, never shared externally.`,
    },
    {
      icon: '\u{1F4DC}',
      title: 'Audit logging',
      body: `Significant actions on your account — sign-ins, document downloads, policy edits, share-link creation and revocation, agency-membership changes — are recorded in an audit log. Account owners and agency owners can review their log at any time. Coverage is expanding; gaps in events captured are tracked openly rather than glossed over.`,
    },
    {
      icon: '\u{1F465}',
      title: 'How an agency sees your data',
      body: `When an insurance agency invites you onto ${APP_NAME}, your data is yours by default. The agency sees only the policies and reviews you choose to share with them — what they share with you, and what you actively share back. You can revoke an agency's access from your profile at any time; revoking is immediate and irrevocable on the agency side.`,
    },
    {
      icon: '\u{1F468}‍\u{1F4BC}',
      title: 'How an agency sees its own clients',
      body: `Agencies (and their producers) see only clients explicitly assigned to them and only the policies those clients have chosen to share. Producer access can be scoped by their agency owner: who they can view, who they can edit, and which clients they can re-assign. All cross-agency access is logged.`,
    },
    {
      icon: '\u{1F5A5}️',
      title: 'Infrastructure and vendors',
      body: `${APP_NAME} is hosted on Railway (US — application + database) and Vercel (global edge — frontend assets only). Object storage is Cloudflare R2. Source code is on GitHub. The complete list of services that may process customer data, with what data each one handles and where, is published openly.`,
    },
  ];

  const complianceLine = `Covrabl is not yet SOC 2 audited. We are working toward Type I when our customer base makes the audit ROI work. In the meantime: TLS in transit, AES-256 at rest, MFA available on every account, audit logging, no third-party data sales, and no use of customer data for AI training.`;

  return (
    <div style={{ maxWidth: 760, margin: '0 auto', padding: '48px 24px 80px' }}>
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
      <p style={{ margin: '0 0 32px', fontSize: 15, color: 'var(--color-text-muted)', lineHeight: 1.6 }}>
        How {APP_NAME} protects customer and agency data — and an honest accounting of where we are.
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {sections.map((s) => (
          <div
            key={s.title}
            style={{
              background: 'var(--color-surface)',
              border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius-md)',
              padding: '20px 24px',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
              <span style={{ fontSize: 22 }}>{s.icon}</span>
              <h2 style={{ margin: 0, fontSize: 17, fontWeight: 700, color: 'var(--color-text)' }}>{s.title}</h2>
            </div>
            <p style={{ margin: 0, fontSize: 14, color: 'var(--color-text-secondary)', lineHeight: 1.65 }}>
              {s.body}
            </p>
          </div>
        ))}
      </div>

      {/* Compliance posture — honest, not aspirational */}
      <div style={{
        marginTop: 32,
        padding: '20px 24px',
        background: '#f8fafc',
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius-md)',
      }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>
          Compliance posture
        </div>
        <p style={{ margin: 0, fontSize: 14, color: 'var(--color-text-secondary)', lineHeight: 1.65 }}>
          {complianceLine}
        </p>
        <div style={{ marginTop: 12, fontSize: 13 }}>
          <Link href="/subprocessors" style={{ color: 'var(--color-primary)', fontWeight: 600, textDecoration: 'none' }}>
            View the full subprocessor list &rarr;
          </Link>
        </div>
      </div>

      {/* Security contact + vulnerability disclosure */}
      <div style={{
        marginTop: 24,
        padding: '20px 24px',
        background: '#f0f9ff',
        border: '1px solid #bae6fd',
        borderRadius: 'var(--radius-md)',
      }}>
        <h3 style={{ margin: '0 0 8px', fontSize: 16, fontWeight: 700, color: '#0c4a6e' }}>
          Found something? Tell us.
        </h3>
        <p style={{ margin: '0 0 8px', fontSize: 14, color: '#0c4a6e', lineHeight: 1.6 }}>
          If you believe you have found a security vulnerability in {APP_NAME}, please report it to{' '}
          <a href={`mailto:${APP_SECURITY_EMAIL}`} style={{ color: '#0369a1', fontWeight: 600 }}>{APP_SECURITY_EMAIL}</a>.
          We acknowledge reports within two business days and will work with you on a fix and a coordinated disclosure timeline. We do not pursue legal action against researchers acting in good faith.
        </p>
        <p style={{ margin: 0, fontSize: 13, color: '#0c4a6e', lineHeight: 1.6 }}>
          For non-security questions, contact{' '}
          <a href={`mailto:${APP_CONTACT_EMAIL}`} style={{ color: '#0369a1', fontWeight: 600 }}>{APP_CONTACT_EMAIL}</a>
          {' '}or read the full{' '}
          <Link href="/privacy" style={{ color: '#0369a1', fontWeight: 600 }}>Privacy Policy</Link>.
        </p>
      </div>

      <div style={{ textAlign: 'center', marginTop: 32, fontSize: 14 }}>
        <Link href="/commitments" style={{ color: 'var(--color-primary)', fontWeight: 600, textDecoration: 'underline', textUnderlineOffset: 3 }}>
          See our public commitments &rarr;
        </Link>
      </div>
    </div>
  );
}
