'use client';

import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { APP_NAME } from '../config';

export default function TermsPage() {
  const router = useRouter();
  const effectiveDate = 'February 12, 2026';

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
        Terms of Service
      </h1>
      <p style={{ margin: '0 0 40px', fontSize: 14, color: 'var(--color-text-muted)' }}>
        Effective date: {effectiveDate}
      </p>

      <div style={{ fontSize: 15, color: 'var(--color-text)', lineHeight: 1.8 }}>
        <p>
          These Terms of Service (&quot;Terms&quot;) govern your use of {APP_NAME} and any related services
          (collectively, the &quot;Service&quot;) operated by Covrabl, LLC (&quot;Covrabl,&quot; &quot;we,&quot; &quot;us,&quot; or &quot;our&quot;).
          By accessing or using the Service, you agree to be bound by these Terms. If you do not agree, do not use the Service.
        </p>

        <h2 style={{ fontSize: 20, fontWeight: 700, margin: '40px 0 12px', color: 'var(--color-text)' }}>
          What {APP_NAME} is
        </h2>
        <p>
          {APP_NAME} is an intelligent insurance analysis platform. We use AI to help you organize your
          policies, score your protection, detect coverage gaps, track renewal deadlines, and explain
          policy changes — so you always know where you stand. We are <strong>not</strong> an insurance company,
          broker, agent, or financial advisor. We do not sell, recommend, or underwrite insurance products.
          We do not provide insurance advice.
        </p>

        <h2 style={{ fontSize: 20, fontWeight: 700, margin: '40px 0 12px', color: 'var(--color-text)' }}>
          Your account
        </h2>
        <p>
          You must provide a valid email address and create a password to use {APP_NAME}. You are responsible
          for maintaining the security of your account and password. We cannot and will not be liable for
          any loss or damage from your failure to maintain the security of your account.
        </p>
        <p>
          You must be at least 18 years old to use the Service. By using {APP_NAME}, you represent that
          you are at least 18 years of age.
        </p>

        <h2 style={{ fontSize: 20, fontWeight: 700, margin: '40px 0 12px', color: 'var(--color-text)' }}>
          Your data and content
        </h2>
        <p>
          You retain full ownership of all data, documents, and content you upload to {APP_NAME}
          (&quot;Your Content&quot;). We do not claim any intellectual property rights over Your Content.
        </p>
        <p>
          You grant us a limited license to host, store, and process Your Content for the purpose
          of providing the Service to you. We may also use aggregated, anonymized data derived from
          Your Content to improve our services and understand coverage trends — this data cannot
          identify you. Your individual coverage data is never shared with third parties without
          your explicit permission. If we ever offer services that involve sharing your information
          with partners, you will always choose whether to participate.
        </p>
        <p>
          You are responsible for the accuracy of information you enter. {APP_NAME} uses automated
          extraction to read policy documents, but this process is not perfect. You should always verify
          extracted information against your original documents. We are not liable for errors in automated extraction.
        </p>

        <h2 style={{ fontSize: 20, fontWeight: 700, margin: '40px 0 12px', color: 'var(--color-text)' }}>
          Acceptable use
        </h2>
        <p>You agree not to:</p>
        <ul style={{ paddingLeft: 24, margin: '8px 0 16px' }}>
          <li style={{ marginBottom: 8 }}>Use the Service for any unlawful purpose or to violate any laws</li>
          <li style={{ marginBottom: 8 }}>Upload content that you do not have the right to store or share</li>
          <li style={{ marginBottom: 8 }}>Attempt to access another user&apos;s account or data</li>
          <li style={{ marginBottom: 8 }}>Reverse engineer, decompile, or attempt to extract the source code of the Service</li>
          <li style={{ marginBottom: 8 }}>Use the Service to store content unrelated to insurance or financial documents</li>
          <li style={{ marginBottom: 8 }}>Interfere with the proper functioning of the Service</li>
        </ul>

        <h2 style={{ fontSize: 20, fontWeight: 700, margin: '40px 0 12px', color: 'var(--color-text)' }}>
          Sharing and emergency access
        </h2>
        <p>
          {APP_NAME} allows you to share policy information with other people and create emergency
          access cards. When you share information, you are choosing to make that information available
          to the people you designate. You are responsible for who you share with and the permissions you grant.
          We are not responsible for how recipients use information you choose to share.
        </p>

        <h2 style={{ fontSize: 20, fontWeight: 700, margin: '40px 0 12px', color: 'var(--color-text)' }}>
          Service availability
        </h2>
        <p>
          We strive to keep {APP_NAME} available at all times, but we do not guarantee uninterrupted
          access. The Service may be temporarily unavailable due to maintenance, updates, or circumstances
          beyond our control. We will make reasonable efforts to provide advance notice of planned downtime.
        </p>

        <h2 style={{ fontSize: 20, fontWeight: 700, margin: '40px 0 12px', color: 'var(--color-text)' }}>
          Payments and subscriptions
        </h2>
        <p>
          Some features of {APP_NAME} require a paid subscription. Paid plans are billed in advance
          on a monthly or annual basis. You can cancel your subscription at any time. Upon cancellation,
          you will retain access to paid features through the end of your current billing period.
          Refunds are handled on a case-by-case basis at our discretion.
        </p>
        <p>
          We reserve the right to change subscription pricing with 30 days&apos; advance notice.
          Price changes will not affect your current billing period.
        </p>

        <h2 style={{ fontSize: 20, fontWeight: 700, margin: '40px 0 12px', color: 'var(--color-text)' }}>
          Cancellation and termination
        </h2>
        <p>
          You may cancel your account at any time. Upon cancellation, your data will be permanently
          deleted. We recommend exporting your data before cancelling.
        </p>
        <p>
          We may suspend or terminate your account if you violate these Terms or engage in conduct
          that we reasonably believe is harmful to other users, us, or third parties. We will provide
          notice and an opportunity to export your data when reasonably possible.
        </p>

        <h2 style={{ fontSize: 20, fontWeight: 700, margin: '40px 0 12px', color: 'var(--color-text)' }}>
          Disclaimer of warranties
        </h2>
        <p>
          The Service is provided &quot;as is&quot; and &quot;as available&quot; without warranties
          of any kind, either express or implied. We do not warrant that the Service will be error-free
          or uninterrupted. We do not warrant the accuracy of automated document extraction.
        </p>
        <p>
          {APP_NAME} is not a substitute for professional insurance, legal, or financial advice.
          You should consult qualified professionals for decisions about your insurance coverage.
        </p>

        <h2 style={{ fontSize: 20, fontWeight: 700, margin: '40px 0 12px', color: 'var(--color-text)' }}>
          Limitation of liability
        </h2>
        <p>
          To the maximum extent permitted by law, {APP_NAME} shall not be liable for any indirect,
          incidental, special, consequential, or punitive damages, or any loss of profits or revenue,
          whether incurred directly or indirectly, or any loss of data, use, goodwill, or other
          intangible losses resulting from your use of the Service.
        </p>
        <p>
          Our total liability for any claim arising from or related to the Service shall not exceed
          the amount you paid us in the twelve (12) months preceding the claim.
        </p>

        <h2 style={{ fontSize: 20, fontWeight: 700, margin: '40px 0 12px', color: 'var(--color-text)' }}>
          Changes to these Terms
        </h2>
        <p>
          We may update these Terms from time to time. When we make material changes, we will notify
          you by email or through the Service. Your continued use of {APP_NAME} after changes take
          effect constitutes your acceptance of the revised Terms.
        </p>

        <h2 style={{ fontSize: 20, fontWeight: 700, margin: '40px 0 12px', color: 'var(--color-text)' }}>
          Governing law
        </h2>
        <p>
          These Terms shall be governed by and construed in accordance with the laws of the
          United States. Any disputes arising from these Terms will be resolved through good-faith
          negotiation first, and if necessary, through binding arbitration.
        </p>

        <h2 style={{ fontSize: 20, fontWeight: 700, margin: '40px 0 12px', color: 'var(--color-text)' }}>
          Contact
        </h2>
        <p>
          If you have questions about these Terms, please contact us at{' '}
          <a href="mailto:support@covrabl.com" style={{ color: 'var(--color-accent)' }}>support@covrabl.com</a>.
        </p>
      </div>

      <div style={{ marginTop: 48, paddingTop: 24, borderTop: '1px solid var(--color-border)', display: 'flex', gap: 24, fontSize: 13, color: 'var(--color-text-muted)' }}>
        <button onClick={() => router.back()} style={{ background: 'none', border: 'none', fontSize: 13, color: 'var(--color-accent)', cursor: 'pointer', padding: 0 }}>&larr; Back</button>
        <Link href="/privacy" style={{ color: 'var(--color-accent)', textDecoration: 'none' }}>Privacy Policy</Link>
        <Link href="/" style={{ color: 'var(--color-accent)', textDecoration: 'none' }}>Home</Link>
      </div>
    </div>
  );
}
