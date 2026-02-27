'use client';

import { useState, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '../../../lib/auth';
import { billingApi, type BillingStatus } from '../../../lib/api';
import BackButton from '../components/BackButton';

export default function BillingPage() {
  return <Suspense><BillingContent /></Suspense>;
}

function BillingContent() {
  const { token, plan, trialActive, trialDaysLeft, refreshPlan } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [status, setStatus] = useState<BillingStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const success = searchParams.get('success');

  useEffect(() => {
    if (!token) { router.replace('/login'); return; }
    refreshPlan();
    billingApi.status().then(setStatus).catch(() => {});
  }, [token]);

  const openPortal = async () => {
    setLoading(true);
    setError('');
    try {
      const { portal_url } = await billingApi.portal();
      window.location.href = portal_url;
    } catch (err: any) {
      setError(err.message || 'Could not open billing portal');
      setLoading(false);
    }
  };

  const planLabel = (p: string) => {
    const labels: Record<string, string> = { trial: 'Pro Trial', free: 'Free', basic: 'Basic', pro: 'Pro', business: 'Business' };
    return labels[p] || p;
  };

  const planColor = (p: string) => {
    if (p === 'pro' || p === 'trial') return 'var(--color-secondary)';
    if (p === 'business') return 'var(--color-primary)';
    if (p === 'basic') return 'var(--color-primary)';
    return 'var(--color-text-secondary)';
  };

  return (
    <div style={{ padding: '32px 24px', maxWidth: 700, margin: '0 auto' }}>
      <BackButton href="/" label="Billing" parentLabel="Home" />
      <h1 style={{ fontSize: 24, fontWeight: 700, margin: '0 0 8px', fontFamily: 'var(--font-heading)' }}>
        Billing & Plan
      </h1>
      <p style={{ color: 'var(--color-text-secondary)', margin: '0 0 28px', fontSize: 14 }}>
        Manage your subscription and billing details.
      </p>

      {success && (
        <div style={{
          padding: '14px 20px',
          backgroundColor: 'var(--color-success-bg)',
          color: 'var(--color-success-dark)',
          borderRadius: 'var(--radius-md)',
          border: '1px solid var(--color-success-border)',
          marginBottom: 24,
          fontSize: 14,
        }}>
          Your subscription is now active! Welcome to your upgraded plan.
        </div>
      )}

      {error && (
        <div style={{
          padding: '14px 20px',
          backgroundColor: 'var(--color-danger-bg)',
          color: 'var(--color-danger-dark)',
          borderRadius: 'var(--radius-md)',
          border: '1px solid var(--color-danger-border)',
          marginBottom: 24,
          fontSize: 14,
        }}>
          {error}
        </div>
      )}

      {/* Current Plan Card */}
      <div style={{
        backgroundColor: '#fff',
        borderRadius: 'var(--radius-lg)',
        border: '1px solid var(--color-border)',
        padding: 28,
        marginBottom: 20,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20, flexWrap: 'wrap', gap: 12 }}>
          <div>
            <div style={{ fontSize: 13, color: 'var(--color-text-muted)', marginBottom: 4 }}>Current Plan</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: 24, fontWeight: 700, fontFamily: 'var(--font-heading)', color: planColor(plan || 'free') }}>
                {planLabel(plan || 'free')}
              </span>
              {trialActive && (
                <span style={{
                  padding: '3px 10px',
                  backgroundColor: 'var(--color-secondary-bg)',
                  color: 'var(--color-secondary-dark)',
                  borderRadius: 20,
                  fontSize: 12,
                  fontWeight: 600,
                }}>
                  {trialDaysLeft} days left
                </span>
              )}
            </div>
          </div>

          {(plan === 'free' || (plan === 'trial' && !status?.has_subscription)) && (
            <button
              onClick={() => router.push('/pricing')}
              style={{
                padding: '10px 24px',
                backgroundColor: 'var(--color-secondary)',
                color: '#fff',
                border: 'none',
                borderRadius: 'var(--radius-md)',
                fontSize: 14,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Upgrade
            </button>
          )}
        </div>

        {/* Plan limits */}
        <div className="form-grid-2" style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: 16,
        }}>
          <div style={{ padding: 16, backgroundColor: 'var(--color-bg)', borderRadius: 'var(--radius-md)' }}>
            <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginBottom: 4 }}>Active Policy Limit</div>
            <div style={{ fontSize: 18, fontWeight: 600 }}>
              {status ? (status.max_active_policies >= 999 ? 'Unlimited' : status.max_active_policies) : '...'}
            </div>
          </div>
          <div style={{ padding: 16, backgroundColor: 'var(--color-bg)', borderRadius: 'var(--radius-md)' }}>
            <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginBottom: 4 }}>PDF Extractions</div>
            <div style={{ fontSize: 18, fontWeight: 600 }}>
              {status ? (status.max_extractions >= 999 ? 'Unlimited' : `${status.extractions_used}/${status.max_extractions} used`) : '...'}
            </div>
          </div>
        </div>
      </div>

      {/* Manage subscription */}
      {status?.has_subscription && (
        <div style={{
          backgroundColor: '#fff',
          borderRadius: 'var(--radius-lg)',
          border: '1px solid var(--color-border)',
          padding: 28,
          marginBottom: 20,
        }}>
          <h3 style={{ fontSize: 16, fontWeight: 600, margin: '0 0 8px' }}>Manage Subscription</h3>
          <p style={{ fontSize: 14, color: 'var(--color-text-secondary)', margin: '0 0 16px' }}>
            Update payment method, change plan, or cancel your subscription.
          </p>
          <button
            onClick={openPortal}
            disabled={loading}
            style={{
              padding: '10px 24px',
              backgroundColor: 'var(--color-primary)',
              color: '#fff',
              border: 'none',
              borderRadius: 'var(--radius-md)',
              fontSize: 14,
              fontWeight: 600,
              cursor: 'pointer',
              opacity: loading ? 0.7 : 1,
            }}
          >
            {loading ? 'Opening...' : 'Open Billing Portal'}
          </button>
        </div>
      )}

      {/* Trial info */}
      {trialActive && !status?.has_subscription && (
        <div style={{
          backgroundColor: 'var(--color-secondary-bg)',
          borderRadius: 'var(--radius-lg)',
          border: '1px solid var(--color-secondary)',
          padding: 28,
        }}>
          <h3 style={{ fontSize: 16, fontWeight: 600, margin: '0 0 8px', color: 'var(--color-secondary-dark)' }}>
            Pro Trial Active
          </h3>
          <p style={{ fontSize: 14, color: 'var(--color-text-secondary)', margin: '0 0 16px', lineHeight: 1.6 }}>
            You have full access to all Pro features for {trialDaysLeft} more days. After your trial ends,
            you'll move to the Free plan with up to 3 active policies. Subscribe before your trial ends
            to keep uninterrupted access.
          </p>
          <button
            onClick={() => router.push('/pricing')}
            style={{
              padding: '10px 24px',
              backgroundColor: 'var(--color-secondary)',
              color: '#fff',
              border: 'none',
              borderRadius: 'var(--radius-md)',
              fontSize: 14,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Choose a Plan
          </button>
        </div>
      )}
    </div>
  );
}
