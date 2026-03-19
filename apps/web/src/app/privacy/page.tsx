'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { APP_NAME, APP_PRIVACY_EMAIL, APP_CONTACT_EMAIL } from '../config';
import { useAuth } from '../../../lib/auth';
import { exportApi } from '../../../lib/api';

export default function PrivacyPage() {
  const router = useRouter();
  const { token } = useAuth();
  const [exporting, setExporting] = useState(false);
  const effectiveDate = 'February 12, 2026';

  const handleExport = async () => {
    setExporting(true);
    try {
      await exportApi.allPolicies();
    } catch {
      alert('Export failed. Please try again.');
    } finally {
      setExporting(false);
    }
  };

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
        Privacy Policy
      </h1>
      <p style={{ margin: '0 0 40px', fontSize: 14, color: 'var(--color-text-muted)' }}>
        Effective date: {effectiveDate}
      </p>

      <div style={{ fontSize: 15, color: 'var(--color-text)', lineHeight: 1.8 }}>

        {/* Preamble */}
        <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 8, padding: '20px 24px', marginBottom: 40 }}>
          <p style={{ margin: 0, fontWeight: 600, fontSize: 16, lineHeight: 1.7 }}>
            The short version: Your individual coverage data belongs to you and is never shared
            with third parties without your explicit permission. We collect only what we need
            to run {APP_NAME}, and we treat your information accordingly.
          </p>
        </div>

        <h2 style={{ fontSize: 20, fontWeight: 700, margin: '40px 0 12px', color: 'var(--color-text)' }}>
          Our commitment
        </h2>
        <p>
          Covrabl, LLC (&quot;Covrabl,&quot; &quot;we,&quot; &quot;us,&quot; or &quot;our&quot;) operates {APP_NAME}. {APP_NAME} handles sensitive personal and financial information. We take that responsibility
          seriously. This policy describes what we collect, why we collect it, and what we do (and
          don&apos;t do) with your information. We have written it in plain language because we believe
          you should be able to understand how your data is handled without a law degree.
        </p>

        <h2 style={{ fontSize: 20, fontWeight: 700, margin: '40px 0 12px', color: 'var(--color-text)' }}>
          What we collect
        </h2>

        <h3 style={{ fontSize: 16, fontWeight: 600, margin: '24px 0 8px', color: 'var(--color-text)' }}>
          Information you provide directly
        </h3>
        <ul style={{ paddingLeft: 24, margin: '8px 0 16px' }}>
          <li style={{ marginBottom: 8 }}><strong>Account information:</strong> Your email address and password (stored as a one-way hash — we cannot see your password)</li>
          <li style={{ marginBottom: 8 }}><strong>Insurance documents:</strong> Policy PDFs, declarations pages, and other documents you upload</li>
          <li style={{ marginBottom: 8 }}><strong>Policy information:</strong> Carrier names, policy numbers, coverage amounts, deductibles, renewal dates, premium amounts, claims data, and other details you enter or that are extracted from your documents</li>
          <li style={{ marginBottom: 8 }}><strong>Contact information:</strong> Names, phone numbers, and email addresses of insurance agents, brokers, or other contacts you choose to store</li>
          <li style={{ marginBottom: 8 }}><strong>Emergency card information:</strong> Names and phone numbers of emergency contacts you choose to include on your emergency access card</li>
        </ul>

        <h3 style={{ fontSize: 16, fontWeight: 600, margin: '24px 0 8px', color: 'var(--color-text)' }}>
          Information collected automatically
        </h3>
        <ul style={{ paddingLeft: 24, margin: '8px 0 16px' }}>
          <li style={{ marginBottom: 8 }}><strong>Log data:</strong> When you use the Service, our servers automatically record information including your IP address, browser type, and the pages you visit. This is standard for all web services and is used solely for security and debugging purposes.</li>
        </ul>

        <h3 style={{ fontSize: 16, fontWeight: 600, margin: '24px 0 8px', color: 'var(--color-text)' }}>
          What we do NOT collect
        </h3>
        <ul style={{ paddingLeft: 24, margin: '8px 0 16px' }}>
          <li style={{ marginBottom: 8 }}>Social Security numbers</li>
          <li style={{ marginBottom: 8 }}>Bank account or credit card numbers (payment processing is handled by secure third-party processors)</li>
          <li style={{ marginBottom: 8 }}>Location data</li>
          <li style={{ marginBottom: 8 }}>Data from third-party tracking or advertising networks</li>
        </ul>

        <h2 style={{ fontSize: 20, fontWeight: 700, margin: '40px 0 12px', color: 'var(--color-text)' }}>
          How we use your information
        </h2>
        <p>We use your information for the following purposes and no others:</p>
        <ul style={{ paddingLeft: 24, margin: '8px 0 16px' }}>
          <li style={{ marginBottom: 8 }}>To provide the Service — storing, organizing, and displaying your insurance information</li>
          <li style={{ marginBottom: 8 }}>To extract data from documents you upload, so you don&apos;t have to enter it manually</li>
          <li style={{ marginBottom: 8 }}>To send you transactional emails (password resets, account notifications)</li>
          <li style={{ marginBottom: 8 }}>To send you renewal reminders and alerts you have opted into</li>
          <li style={{ marginBottom: 8 }}>To maintain the security and integrity of the Service</li>
        </ul>

        <h2 style={{ fontSize: 20, fontWeight: 700, margin: '40px 0 12px', color: 'var(--color-text)' }}>
          How we protect your data
        </h2>
        <p>
          Your individual coverage data belongs to you and is never shared with third parties
          without your explicit permission.
        </p>
        <p>
          We may use aggregated, anonymized insights to improve our services and better understand
          coverage trends. These insights cannot identify you.
        </p>
        <p>We will <strong>never</strong>:</p>
        <ul style={{ paddingLeft: 24, margin: '8px 0 16px' }}>
          <li style={{ marginBottom: 8 }}><strong>Sell your personal information</strong> — your name, email, and individual policy details are never sold to third parties</li>
          <li style={{ marginBottom: 8 }}><strong>Share your data with advertisers</strong> or use it for targeted advertising</li>
          <li style={{ marginBottom: 8 }}><strong>Use your information for unsolicited insurance marketing or lead generation</strong></li>
        </ul>
        <p>
          If we ever introduce features that involve sharing information with partners, you will
          always choose whether to participate.
        </p>

        <h2 style={{ fontSize: 20, fontWeight: 700, margin: '40px 0 12px', color: 'var(--color-text)' }}>
          How we share your information
        </h2>
        <p>We share your information only in these limited circumstances:</p>
        <ul style={{ paddingLeft: 24, margin: '8px 0 16px' }}>
          <li style={{ marginBottom: 8 }}><strong>When you choose to share:</strong> When you use our sharing features (policy sharing, emergency cards), the information you designate is made available to the people you choose. You control this entirely.</li>
          <li style={{ marginBottom: 8 }}><strong>Service providers:</strong> We use a small number of third-party services to operate {APP_NAME} (cloud hosting, file storage, payment processing). These providers access your data only to perform services on our behalf and are contractually obligated to protect it.</li>
          <li style={{ marginBottom: 8 }}><strong>Legal requirements:</strong> We may disclose information if required by law, regulation, legal process, or governmental request. We will notify you before doing so unless legally prohibited.</li>
        </ul>
        <p>We do not share your individual data with insurance companies, brokers, agents, or advertisers without your explicit consent.</p>

        <h2 style={{ fontSize: 20, fontWeight: 700, margin: '40px 0 12px', color: 'var(--color-text)' }}>
          Document extraction and AI processing
        </h2>
        <p>
          When you upload a document, we use artificial intelligence to extract key information
          (carrier, policy number, coverage amounts, etc.) so you don&apos;t have to type it manually.
          We also use AI to analyze your coverage — including scoring your protection level, detecting
          gaps in your insurance, identifying policy changes between terms, and generating renewal
          alerts. All of this processing is performed solely to provide the Service to you. Your data
          is stored in your account and is not used to train AI models, build datasets, or for any
          purpose other than serving you.
        </p>

        <h2 style={{ fontSize: 20, fontWeight: 700, margin: '40px 0 12px', color: 'var(--color-text)' }}>
          Data security
        </h2>
        <p>We protect your data with industry-standard security practices:</p>
        <ul style={{ paddingLeft: 24, margin: '8px 0 16px' }}>
          <li style={{ marginBottom: 8 }}><strong>Encryption in transit:</strong> All data transmitted between your device and our servers is encrypted using TLS (Transport Layer Security)</li>
          <li style={{ marginBottom: 8 }}><strong>Password security:</strong> Your password is hashed using bcrypt with a high work factor. We never store or have access to your plain-text password</li>
          <li style={{ marginBottom: 8 }}><strong>Authentication:</strong> Sessions are managed via secure, time-limited JWT tokens</li>
          <li style={{ marginBottom: 8 }}><strong>Access controls:</strong> Your data is isolated to your account. Other users cannot access your information unless you explicitly grant them permission</li>
          <li style={{ marginBottom: 8 }}><strong>Audit logging:</strong> All significant actions are logged so you can review access and changes to your data</li>
        </ul>
        <p>
          No system is perfectly secure. While we implement strong protections, we cannot guarantee
          absolute security. We will notify you promptly if we become aware of a breach affecting your data.
        </p>

        <h2 style={{ fontSize: 20, fontWeight: 700, margin: '40px 0 12px', color: 'var(--color-text)' }}>
          Data retention and deletion
        </h2>
        <p>
          We retain your data for as long as your account is active. When you delete a policy,
          document, or other content, it is permanently removed from our systems.
        </p>
        <p>
          When you delete your account, all of your data — including policies, documents, contacts,
          emergency cards, and personal information — is permanently deleted. This action is
          irreversible. We recommend exporting your data before deleting your account.
        </p>
        <p>
          We may retain anonymized, aggregated data (such as total number of users) that cannot
          be used to identify you.
        </p>

        <h2 style={{ fontSize: 20, fontWeight: 700, margin: '40px 0 12px', color: 'var(--color-text)' }}>
          Your rights
        </h2>
        <p>You have the right to:</p>
        <ul style={{ paddingLeft: 24, margin: '8px 0 16px' }}>
          <li style={{ marginBottom: 8 }}><strong>Access your data:</strong> You can view all information stored in your account at any time</li>
          <li style={{ marginBottom: 8 }}><strong>Export your data:</strong> You can export your policy data in standard formats</li>
          <li style={{ marginBottom: 8 }}><strong>Correct your data:</strong> You can edit any information in your account at any time</li>
          <li style={{ marginBottom: 8 }}><strong>Delete your data:</strong> You can delete individual items or your entire account at any time</li>
          <li style={{ marginBottom: 8 }}><strong>Revoke sharing:</strong> You can revoke any sharing permissions you have granted at any time</li>
        </ul>
        <p>
          If you are a resident of the European Economic Area (EEA), you have additional rights under
          GDPR, including the right to data portability and the right to lodge a complaint with a
          supervisory authority. If you are a California resident, you have additional rights under
          the CCPA, including the right to know what personal information is collected and the right
          to request deletion.
        </p>
        <p>
          To exercise any of these rights, contact us at{' '}
          <a href={`mailto:${APP_PRIVACY_EMAIL}`} style={{ color: 'var(--color-accent)' }}>{APP_PRIVACY_EMAIL}</a>.
        </p>

        <h2 style={{ fontSize: 20, fontWeight: 700, margin: '40px 0 12px', color: 'var(--color-text)' }}>
          Cookies
        </h2>
        <p>
          {APP_NAME} uses only essential cookies and local storage required for the Service to function
          (such as keeping you logged in). We do not use tracking cookies, advertising cookies, or
          third-party analytics cookies.
        </p>

        <h2 style={{ fontSize: 20, fontWeight: 700, margin: '40px 0 12px', color: 'var(--color-text)' }}>
          Children&apos;s privacy
        </h2>
        <p>
          {APP_NAME} is not directed to children under 18. We do not knowingly collect personal
          information from children. If you believe a child has provided us with personal information,
          please contact us and we will delete it promptly.
        </p>

        <h2 style={{ fontSize: 20, fontWeight: 700, margin: '40px 0 12px', color: 'var(--color-text)' }}>
          Third-party services
        </h2>
        <p>We use the following third-party services to operate {APP_NAME}:</p>
        <ul style={{ paddingLeft: 24, margin: '8px 0 16px' }}>
          <li style={{ marginBottom: 8 }}><strong>Cloud hosting and infrastructure</strong> — for running the application and storing data</li>
          <li style={{ marginBottom: 8 }}><strong>Object storage</strong> — for securely storing uploaded documents</li>
          <li style={{ marginBottom: 8 }}><strong>Payment processors</strong> — Payments are processed through secure third-party payment processors (such as Stripe). {APP_NAME} does not store full payment card details on its own servers. Payment providers may collect and process information in accordance with their own privacy policies.</li>
          <li style={{ marginBottom: 8 }}><strong>AI providers</strong> — for document extraction (documents are processed and not retained by the provider)</li>
        </ul>
        <p>
          Each of these providers is bound by their own privacy policies and contractual obligations
          to protect your data.
        </p>

        {/* Export your data — visible when logged in */}
        {token && (
          <div style={{ margin: '40px 0', padding: '24px', background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 8 }}>
            <h3 style={{ fontSize: 16, fontWeight: 700, margin: '0 0 8px', color: 'var(--color-text)' }}>
              Export your data
            </h3>
            <p style={{ fontSize: 14, color: 'var(--color-text-secondary)', margin: '0 0 16px', lineHeight: 1.6 }}>
              Download all your policy data as a CSV file. This includes policy details, coverage amounts, deductibles, and renewal dates.
            </p>
            <button
              onClick={handleExport}
              disabled={exporting}
              style={{
                padding: '10px 20px', fontSize: 14, fontWeight: 600,
                backgroundColor: 'var(--color-primary)', color: '#fff',
                border: 'none', borderRadius: 'var(--radius-md)', cursor: exporting ? 'not-allowed' : 'pointer',
                opacity: exporting ? 0.7 : 1,
              }}
            >
              {exporting ? 'Exporting...' : 'Download CSV'}
            </button>
          </div>
        )}

        <h2 style={{ fontSize: 20, fontWeight: 700, margin: '40px 0 12px', color: 'var(--color-text)' }}>
          Changes to this policy
        </h2>
        <p>
          We may update this Privacy Policy from time to time. When we make material changes,
          we will notify you by email or through the Service at least 30 days before the changes
          take effect. We will always keep the prior version available for your review.
        </p>

        <h2 style={{ fontSize: 20, fontWeight: 700, margin: '40px 0 12px', color: 'var(--color-text)' }}>
          Contact
        </h2>
        <p>
          If you have questions about this Privacy Policy or how your data is handled, please contact us:
        </p>
        <ul style={{ paddingLeft: 24, margin: '8px 0 16px', listStyle: 'none' }}>
          <li style={{ marginBottom: 8 }}>Email: <a href={`mailto:${APP_PRIVACY_EMAIL}`} style={{ color: 'var(--color-accent)' }}>{APP_PRIVACY_EMAIL}</a></li>
          <li style={{ marginBottom: 8 }}>General: <a href={`mailto:${APP_CONTACT_EMAIL}`} style={{ color: 'var(--color-accent)' }}>{APP_CONTACT_EMAIL}</a></li>
        </ul>
      </div>

      <div style={{ marginTop: 48, paddingTop: 24, borderTop: '1px solid var(--color-border)', display: 'flex', gap: 24, fontSize: 13, color: 'var(--color-text-muted)' }}>
        <button onClick={() => router.back()} style={{ background: 'none', border: 'none', fontSize: 13, color: 'var(--color-accent)', cursor: 'pointer', padding: 0 }}>&larr; Back</button>
        <Link href="/terms" style={{ color: 'var(--color-accent)', textDecoration: 'none' }}>Terms of Service</Link>
        <Link href="/" style={{ color: 'var(--color-accent)', textDecoration: 'none' }}>Home</Link>
      </div>
    </div>
  );
}
