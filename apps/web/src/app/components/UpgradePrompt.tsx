'use client';

import { useRouter } from 'next/navigation';

type UpgradePromptProps = {
  feature: string;
  requiredPlan: string;
  message?: string;
};

const PLAN_LABELS: Record<string, string> = {
  pro: 'Pro',
  business: 'Business',
};

const FEATURE_LABELS: Record<string, string> = {
  deltas: 'Change Detection',
  premiums: 'Premium Tracking',
  premium_history: 'Premium History',
  certificates: 'COI Tracking',
  business_grouping: 'Business Folders',
  sharing: 'Policy Sharing',
  extractions: 'PDF Extractions',
};

export default function UpgradePrompt({ feature, requiredPlan, message }: UpgradePromptProps) {
  const router = useRouter();
  const planLabel = PLAN_LABELS[requiredPlan] || requiredPlan;
  const featureLabel = FEATURE_LABELS[feature] || feature;

  return (
    <div style={{
      backgroundColor: '#fff',
      borderRadius: 'var(--radius-lg)',
      border: '1px solid var(--color-border)',
      padding: '40px 32px',
      textAlign: 'center',
      maxWidth: 480,
      margin: '40px auto',
    }}>
      <div style={{
        width: 56,
        height: 56,
        borderRadius: '50%',
        backgroundColor: 'var(--color-warning-bg)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        margin: '0 auto 20px',
        fontSize: 28,
      }}>
        &#128274;
      </div>
      <h3 style={{
        fontSize: 20,
        fontWeight: 700,
        margin: '0 0 8px',
        fontFamily: 'var(--font-heading)',
      }}>
        {featureLabel} requires {planLabel}
      </h3>
      <p style={{
        fontSize: 14,
        color: 'var(--color-text-secondary)',
        margin: '0 0 24px',
        lineHeight: 1.6,
      }}>
        {message || `Upgrade to the ${planLabel} plan to unlock ${featureLabel.toLowerCase()} and more.`}
      </p>
      <button
        onClick={() => router.push('/pricing')}
        style={{
          padding: '12px 32px',
          backgroundColor: 'var(--color-secondary)',
          color: '#fff',
          border: 'none',
          borderRadius: 'var(--radius-md)',
          fontSize: 15,
          fontWeight: 600,
          cursor: 'pointer',
        }}
      >
        View Plans
      </button>
    </div>
  );
}
