'use client';

import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { APP_NAME, APP_CONTACT_EMAIL } from '../config';

const LAST_UPDATED = 'May 26, 2026';
const FOUNDER = 'Mike Abergel';

const COMMITMENTS: Array<{ heading: string; body: string }> = [
  {
    heading: 'We will not build a carrier marketplace.',
    body: `Covrabl will never let a client request, receive, or compare quotes from carriers inside our product. We will never serve advertising or sponsored placements from carriers. We will never refer a client conversation to a carrier without the agent's explicit involvement. The agent is the relationship. We exist to strengthen that relationship, not to disintermediate it.`,
  },
  {
    heading: 'We will not sell or share client data.',
    body: `Client data uploaded to Covrabl by an agency is the agency's data and the client's data. It is not ours to monetize. We will not sell it to data brokers, lead aggregators, marketing firms, or any third party. We will not use it to train models that benefit anyone other than the agency that uploaded it. Our subprocessors are listed publicly and we will notify agencies before adding new ones with data access.`,
  },
  {
    heading: 'We will not market to your clients.',
    body: `When a client opens a shared Coverage Review or accesses their policy portal, they will not see an offer for life insurance, an upsell for an umbrella policy from a third party, or any other promotion not authored by their agent. We do not have a clients-as-leads business model and we will not develop one. The portal carries your agency's branding, not ours, and the conversation belongs to you.`,
  },
  {
    heading: 'We will not become an AMS or a CRM.',
    body: `Covrabl is an engagement layer that sits on top of the systems agencies already use to run their business. We will not build policy administration, billing reconciliation, commission management, or pipeline tracking. The companies that build those things are not our competitors — they are our context. We make their data more useful at the moment of client conversation. We will not duplicate their work.`,
  },
  {
    heading: `We will not replace the agent's judgment.`,
    body: `Covrabl surfaces signals — renewals approaching, documents uploaded, share-links viewed, clients gone quiet. We add context to renewal reviews. We do not advise. We do not recommend coverage levels. We do not generate language that positions Covrabl as the authority. The agent is the authority. Every feature is designed to make the agent more present in the relationship, not less. This is non-negotiable and it shapes every product decision we make.`,
  },
  {
    heading: 'We will not chase features that pull us off-center.',
    body: `Agencies will ask us to build many things. Some of them will be excellent ideas. Some will come from agencies we'd very much like to keep as customers. We will say no to the features that move us away from "identify the conversation, make the conversation beautiful." These commitments shape what we build, and sometimes what we decline to build — even when a customer asks for it.`,
  },
];

export default function CommitmentsPage() {
  const router = useRouter();

  return (
    <div style={{ maxWidth: 680, margin: '0 auto', padding: '48px 24px 80px' }}>
      <div style={{ marginBottom: 40, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <Link href="/" style={{ fontSize: 20, fontWeight: 700, color: 'var(--color-primary)', textDecoration: 'none' }}>
          {APP_NAME}
        </Link>
        <button onClick={() => router.back()} style={{ background: 'none', border: 'none', fontSize: 14, color: 'var(--color-text-secondary)', cursor: 'pointer' }}>
          &larr; Back
        </button>
      </div>

      <h1 style={{ fontSize: 32, fontWeight: 700, margin: '0 0 8px', color: 'var(--color-text)' }}>
        Our Commitments
      </h1>
      <p style={{ fontSize: 14, color: 'var(--color-text-muted)', margin: '0 0 40px' }}>
        Last updated: {LAST_UPDATED}
      </p>

      <div style={{ fontSize: 16, color: 'var(--color-text-secondary)', lineHeight: 1.75, marginBottom: 48 }}>
        <p style={{ margin: '0 0 18px' }}>
          {APP_NAME} is built to support the relationship between an agent and their client. Everything on this page is in service of that. The clearest way to explain how we think about trust is to be specific about what we will not do.
        </p>
        <p style={{ margin: '0 0 18px' }}>
          {APP_NAME} was built to do two things well: help agents identify the conversations worth having with their book, and make those conversations beautiful. Everything else is secondary to that.
        </p>
        <p style={{ margin: 0 }}>
          This page exists because the insurance industry has been burned, repeatedly, by vendors that started as tools and became competitors. We don&apos;t want to be that vendor. So we&apos;re saying — in writing, publicly, with a date on it — what we will not build.
        </p>
      </div>

      <h2 style={{ fontSize: 22, fontWeight: 700, margin: '0 0 32px', color: 'var(--color-text)', letterSpacing: 'var(--letter-spacing-tight)' }}>
        What we will not build
      </h2>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 40 }}>
        {COMMITMENTS.map((c) => (
          <div key={c.heading}>
            <h3 style={{ fontSize: 18, fontWeight: 700, margin: '0 0 12px', color: 'var(--color-text)', lineHeight: 1.4 }}>
              {c.heading}
            </h3>
            <p style={{ margin: 0, fontSize: 16, color: 'var(--color-text-secondary)', lineHeight: 1.75 }}>
              {c.body}
            </p>
          </div>
        ))}
      </div>

      <h2 style={{ fontSize: 22, fontWeight: 700, margin: '56px 0 20px', color: 'var(--color-text)', letterSpacing: 'var(--letter-spacing-tight)' }}>
        How this page can change
      </h2>
      <p style={{ margin: '0 0 56px', fontSize: 16, color: 'var(--color-text-secondary)', lineHeight: 1.75 }}>
        The wording on this page may evolve as our product matures and as we encounter situations we haven&apos;t yet imagined. The substance will not. If we ever amend this page in a way that meaningfully changes any commitment above, we will explain what changed and why — visibly, on this page, with the date.
      </p>

      <div style={{ textAlign: 'center', color: 'var(--color-text-muted)', fontSize: 18, margin: '0 0 24px' }}>
        &mdash;
      </div>

      <div style={{ paddingLeft: 16, borderLeft: '2px solid var(--color-border)' }}>
        <p style={{ margin: '0 0 12px', fontSize: 15, color: 'var(--color-text-secondary)', fontStyle: 'italic', lineHeight: 1.65 }}>
          This commitment is dated {LAST_UPDATED} and signed by {FOUNDER}, Founder, {APP_NAME}.
        </p>
        <p style={{ margin: 0, fontSize: 14, color: 'var(--color-text-muted)', lineHeight: 1.65 }}>
          Questions, concerns, or scenarios you think we haven&apos;t considered:{' '}
          <a href={`mailto:${APP_CONTACT_EMAIL}`} style={{ color: 'var(--color-primary)' }}>{APP_CONTACT_EMAIL}</a>
        </p>
      </div>
    </div>
  );
}
