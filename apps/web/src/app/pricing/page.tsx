'use client';

import { useState, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '../../../lib/auth';
import { billingApi, type PlanInfo } from '../../../lib/api';
import BackButton from '../components/BackButton';
import { APP_NAME } from '../config';

export default function PricingPage() {
  return <Suspense><PricingContent /></Suspense>;
}

function PricingContent() {
  const { token, plan: currentPlan, trialActive, trialDaysLeft, refreshPlan } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [plans, setPlans] = useState<PlanInfo[]>([]);
  const [interval, setInterval] = useState<'monthly' | 'annual'>('annual');
  const [loading, setLoading] = useState<string | null>(null);
  const [loadingPlans, setLoadingPlans] = useState(true);
  const [error, setError] = useState('');

  const canceled = searchParams.get('canceled');

  useEffect(() => {
    billingApi.plans().then(data => setPlans(data.plans)).catch(() => {}).finally(() => setLoadingPlans(false));
  }, []);

  const handleSelect = async (planId: string) => {
    if (!token) {
      router.push('/login');
      return;
    }
    if (planId === 'free') return;

    setLoading(planId);
    setError('');
    try {
      const { checkout_url } = await billingApi.checkout(planId, interval);
      window.location.href = checkout_url;
    } catch (err: any) {
      setError(err.message || 'Failed to start checkout');
      setLoading(null);
    }
  };

  const formatPrice = (cents: number) => {
    if (cents === 0) return '$0';
    return `$${(cents / 100).toFixed(2).replace(/\.00$/, '')}`;
  };

  const effectivePlan = currentPlan || 'free';
  const isTrialing = trialActive && effectivePlan === 'trial';

  return (
    <div style={{ minHeight: '100vh', backgroundColor: 'var(--color-bg)' }}>
      {/* Header */}
      <div style={{
        textAlign: 'center',
        padding: token ? '48px 24px 32px' : '80px 24px 32px',
        background: 'linear-gradient(160deg, #0f1f33 0%, #1e3a5f 45%, #234a6e 100%)',
        color: '#fff',
      }}>
        {token ? (
          <div style={{ maxWidth: 900, margin: '0 auto 24px', textAlign: 'left' }}>
            <BackButton href="/billing" label="Pricing" parentLabel="Billing" />
          </div>
        ) : (
          <div style={{ maxWidth: 900, margin: '0 auto', display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 48, flexWrap: 'wrap', gap: 12 }}>
            <button onClick={() => router.push('/')} style={{ background: 'none', border: 'none', color: '#fff', fontSize: 20, fontWeight: 700, cursor: 'pointer', fontFamily: 'var(--font-heading)', letterSpacing: 'var(--letter-spacing-tight)' }}>
              {APP_NAME}
            </button>
            <button onClick={() => router.push('/login')} style={{ background: 'rgba(255,255,255,0.15)', border: '1px solid rgba(255,255,255,0.3)', color: '#fff', padding: '8px 20px', borderRadius: 'var(--radius-md)', cursor: 'pointer', fontSize: 14 }}>
              Sign In
            </button>
          </div>
        )}

        <h1 style={{ fontSize: 36, fontWeight: 700, margin: 0, fontFamily: 'var(--font-heading)', letterSpacing: 'var(--letter-spacing-tight)' }}>
          Simple, transparent pricing
        </h1>
        <p style={{ fontSize: 18, opacity: 0.8, marginTop: 12, maxWidth: 500, margin: '12px auto 0' }}>
          Start free. Upgrade when you need more.
        </p>

        {isTrialing && (
          <div style={{
            display: 'inline-block',
            marginTop: 20,
            padding: '8px 20px',
            backgroundColor: 'rgba(63, 167, 163, 0.2)',
            border: '1px solid rgba(63, 167, 163, 0.4)',
            borderRadius: 'var(--radius-md)',
            fontSize: 14,
          }}>
            You have {trialDaysLeft} days left on your Pro trial
          </div>
        )}

        {/* Interval toggle */}
        <div style={{
          display: 'inline-flex',
          marginTop: 28,
          backgroundColor: 'rgba(255,255,255,0.1)',
          borderRadius: 'var(--radius-md)',
          padding: 3,
        }}>
          {(['monthly', 'annual'] as const).map(iv => (
            <button
              key={iv}
              onClick={() => setInterval(iv)}
              style={{
                padding: '8px 24px',
                border: 'none',
                borderRadius: 'var(--radius-sm)',
                backgroundColor: interval === iv ? '#fff' : 'transparent',
                color: interval === iv ? 'var(--color-primary-dark)' : 'rgba(255,255,255,0.7)',
                fontWeight: interval === iv ? 600 : 400,
                fontSize: 14,
                cursor: 'pointer',
              }}
            >
              {iv === 'monthly' ? 'Monthly' : 'Annual'}
              {iv === 'annual' && <span style={{ color: 'var(--color-secondary)', marginLeft: 6, fontSize: 12, fontWeight: 600 }}>Save ~25%</span>}
            </button>
          ))}
        </div>
      </div>

      {/* Error / canceled */}
      {(error || canceled) && (
        <div style={{
          maxWidth: 900,
          margin: '20px auto 0',
          padding: '12px 20px',
          backgroundColor: canceled ? 'var(--color-warning-bg)' : 'var(--color-danger-bg)',
          color: canceled ? 'var(--color-warning-dark)' : 'var(--color-danger-dark)',
          borderRadius: 'var(--radius-md)',
          fontSize: 14,
          textAlign: 'center',
        }}>
          {canceled ? 'Checkout was canceled. You can try again anytime.' : error}
        </div>
      )}

      {/* Plan cards */}
      <div style={{
        maxWidth: 1100,
        margin: '-40px auto 0',
        padding: '0 24px 80px',
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
        gap: 24,
        position: 'relative',
        zIndex: 1,
      }}>
        {loadingPlans ? (
          <>
            {[1, 2, 3].map(i => (
              <div key={i} style={{
                backgroundColor: '#fff', borderRadius: 'var(--radius-lg)',
                border: '1px solid var(--color-border)', boxShadow: 'var(--shadow-md)',
                padding: 32, display: 'flex', flexDirection: 'column', gap: 16,
              }}>
                <div className="skeleton" style={{ width: 100, height: 22, borderRadius: 4 }} />
                <div className="skeleton" style={{ width: '80%', height: 14, borderRadius: 4 }} />
                <div className="skeleton" style={{ width: 80, height: 40, borderRadius: 4, marginTop: 8 }} />
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 8 }}>
                  {[1, 2, 3, 4].map(j => (
                    <div key={j} className="skeleton" style={{ width: '90%', height: 14, borderRadius: 4 }} />
                  ))}
                </div>
                <div className="skeleton" style={{ width: '100%', height: 44, borderRadius: 'var(--radius-md)', marginTop: 12 }} />
              </div>
            ))}
          </>
        ) : plans.map(p => {
          const isCurrentPlan = effectivePlan === p.id || (isTrialing && p.id === 'pro');
          const isPro = p.id === 'pro';
          const isBusiness = p.id === 'business';
          const price = interval === 'monthly' ? p.monthly_price : p.annual_price;
          const monthlyEquiv = interval === 'annual' && p.annual_price > 0 ? Math.round(p.annual_price / 12) : null;

          return (
            <div
              key={p.id}
              style={{
                backgroundColor: '#fff',
                borderRadius: 'var(--radius-lg)',
                border: isPro ? '2px solid var(--color-secondary)' : '1px solid var(--color-border)',
                boxShadow: isPro ? '0 8px 30px rgba(63, 167, 163, 0.15)' : 'var(--shadow-md)',
                padding: 32,
                display: 'flex',
                flexDirection: 'column',
                position: 'relative',
              }}
            >
              {isPro && (
                <div style={{
                  position: 'absolute',
                  top: -12,
                  left: '50%',
                  transform: 'translateX(-50%)',
                  backgroundColor: 'var(--color-secondary)',
                  color: '#fff',
                  padding: '4px 16px',
                  borderRadius: 20,
                  fontSize: 12,
                  fontWeight: 600,
                  letterSpacing: 'var(--letter-spacing-wide)',
                  textTransform: 'uppercase',
                }}>
                  Most Popular
                </div>
              )}

              <h3 style={{ fontSize: 22, fontWeight: 700, margin: 0, fontFamily: 'var(--font-heading)' }}>
                {p.name}
              </h3>
              {p.tagline && (
                <div style={{ fontSize: 13, color: 'var(--color-secondary-dark)', fontWeight: 500, marginTop: 4 }}>
                  {p.tagline}
                </div>
              )}
              <p style={{ fontSize: 14, color: 'var(--color-text-secondary)', margin: '8px 0 20px' }}>
                {p.description}
              </p>

              {/* Price */}
              <div style={{ marginBottom: 24 }}>
                <span style={{ fontSize: 40, fontWeight: 700, fontFamily: 'var(--font-heading)', letterSpacing: 'var(--letter-spacing-tight)' }}>
                  {formatPrice(price)}
                </span>
                {price > 0 && (
                  <span style={{ fontSize: 14, color: 'var(--color-text-secondary)', marginLeft: 4 }}>
                    /{interval === 'monthly' ? 'mo' : 'yr'}
                  </span>
                )}
                {monthlyEquiv && monthlyEquiv > 0 && (
                  <div style={{ fontSize: 13, color: 'var(--color-text-muted)', marginTop: 4 }}>
                    {formatPrice(monthlyEquiv)}/mo billed annually
                  </div>
                )}
                {price === 0 && (
                  <div style={{ fontSize: 13, color: 'var(--color-text-muted)', marginTop: 4 }}>
                    Free forever
                  </div>
                )}
              </div>

              {/* Features */}
              <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 28px', flex: 1 }}>
                {p.features.map((feat, i) => (
                  <li key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 10, fontSize: 14, color: 'var(--color-text)' }}>
                    <span style={{ color: 'var(--color-success)', fontSize: 16, lineHeight: '20px', flexShrink: 0 }}>&#10003;</span>
                    {feat}
                  </li>
                ))}
              </ul>

              {/* Error inline */}
              {error && loading === null && (p.id === 'pro' || p.id === 'business') && (
                <div style={{
                  padding: '10px 14px',
                  backgroundColor: 'var(--color-danger-bg)',
                  color: 'var(--color-danger-dark)',
                  borderRadius: 'var(--radius-sm)',
                  fontSize: 13,
                  marginBottom: 12,
                }}>
                  {error}
                </div>
              )}

              {/* CTA */}
              {p.id === 'free' ? (
                <button
                  disabled
                  style={{
                    width: '100%',
                    padding: '12px 20px',
                    border: '1px solid var(--color-border)',
                    borderRadius: 'var(--radius-md)',
                    backgroundColor: isCurrentPlan && !isTrialing ? 'var(--color-bg)' : '#fff',
                    color: 'var(--color-text-secondary)',
                    fontSize: 15,
                    fontWeight: 600,
                    cursor: 'default',
                  }}
                >
                  {isCurrentPlan && !isTrialing ? 'Current Plan' : 'Free'}
                </button>
              ) : (
                <button
                  onClick={() => handleSelect(p.id)}
                  disabled={loading === p.id || (isCurrentPlan && !isTrialing)}
                  style={{
                    width: '100%',
                    padding: '12px 20px',
                    border: 'none',
                    borderRadius: 'var(--radius-md)',
                    backgroundColor: isCurrentPlan && !isTrialing ? 'var(--color-bg)' : isPro ? 'var(--color-secondary)' : isBusiness ? 'var(--color-primary)' : 'var(--color-primary)',
                    color: isCurrentPlan && !isTrialing ? 'var(--color-text-secondary)' : '#fff',
                    fontSize: 15,
                    fontWeight: 600,
                    cursor: isCurrentPlan && !isTrialing ? 'default' : 'pointer',
                    opacity: loading === p.id ? 0.7 : 1,
                  }}
                >
                  {loading === p.id ? 'Redirecting...' : isCurrentPlan && !isTrialing ? 'Current Plan' : `Get ${p.name}`}
                </button>
              )}
            </div>
          );
        })}
      </div>

      {/* FAQ */}
      <div style={{
        maxWidth: 700,
        margin: '0 auto',
        padding: '0 24px 80px',
      }}>
        <h2 style={{ textAlign: 'center', fontSize: 24, fontWeight: 700, marginBottom: 32, fontFamily: 'var(--font-heading)' }}>
          Frequently Asked Questions
        </h2>
        {[
          {
            q: 'What can I do on the Free plan?',
            a: 'You get full AI-powered coverage insights, gap analysis, policy comparison, chat assistant, and emergency ICE card for up to 3 policies with 3 PDF extractions. The product is fully functional — Free users see the same intelligence as paid users.',
          },
          {
            q: 'When should I upgrade to Pro?',
            a: 'Upgrade when you need more than 3 policies or want continuous monitoring — change detection alerts, renewal tracking, and premium cost history across all your policies.',
          },
          {
            q: 'What does Business add over Pro?',
            a: 'Business adds entity/business folders to organize policies by organization, COI (Certificate of Insurance) tracking and management, and multi-user policy sharing.',
          },
          {
            q: 'Can I switch between monthly and annual?',
            a: 'Yes. You can switch billing intervals at any time from your billing settings. When switching to annual, you\'ll receive prorated credit for your current period.',
          },
          {
            q: 'Can I cancel anytime?',
            a: 'Absolutely. Cancel from your billing settings with one click. You\'ll keep access through the end of your paid period, then move to Free.',
          },
        ].map((faq, i) => (
          <div key={i} style={{
            padding: '20px 0',
            borderBottom: i < 4 ? '1px solid var(--color-border)' : 'none',
          }}>
            <h4 style={{ margin: '0 0 8px', fontSize: 15, fontWeight: 600 }}>{faq.q}</h4>
            <p style={{ margin: 0, fontSize: 14, color: 'var(--color-text-secondary)', lineHeight: 1.6 }}>{faq.a}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
