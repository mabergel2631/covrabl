'use client';

import { useState, useEffect, Suspense } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '../../../lib/auth';
import {
  leaseComplianceApi,
  LeaseRequirement,
  checkFeatureAccess,
} from '../../../lib/api';
import BackButton from '../components/BackButton';
import UpgradePrompt from '../components/UpgradePrompt';

export default function LeaseCompliancePage() {
  return <Suspense><LeaseComplianceContent /></Suspense>;
}

function LeaseComplianceContent() {
  const { token, plan } = useAuth();
  const router = useRouter();
  const [requirements, setRequirements] = useState<LeaseRequirement[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!token) { router.replace('/login'); return; }
    leaseComplianceApi.list()
      .then(setRequirements)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [token]);

  if (loading) {
    return (
      <div style={{ padding: 32, maxWidth: 960, margin: '0 auto' }}>
        <div style={{ height: 32, width: 200, backgroundColor: '#f3f4f6', borderRadius: 8, marginBottom: 24 }} />
        {[1, 2, 3].map(i => (
          <div key={i} style={{ height: 80, backgroundColor: '#f3f4f6', borderRadius: 12, marginBottom: 12 }} />
        ))}
      </div>
    );
  }

  const featureGate = checkFeatureAccess(plan || 'free', 'lease_compliance');
  if (!featureGate.allowed) {
    return <UpgradePrompt feature="lease_compliance" requiredPlan={featureGate.requiredPlan} />;
  }

  return (
    <div style={{ padding: 32, maxWidth: 960, margin: '0 auto' }}>
      <BackButton href="/" label="Lease Check" parentLabel="Home" />

      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 4 }}>Lease Check</h1>
        <p style={{ fontSize: 13, color: 'var(--color-text-secondary)', marginTop: 4 }}>
          Lease checks are now available directly on your business policy pages.
        </p>
      </div>

      {requirements.length > 0 ? (
        <>
          <p style={{ fontSize: 14, color: 'var(--color-text-secondary)', marginBottom: 16 }}>
            Your existing lease checks are listed below. Click &ldquo;View on Policy&rdquo; to manage them.
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {requirements.map(req => (
              <div
                key={req.id}
                style={{
                  border: '1px solid var(--color-border)', borderRadius: 'var(--radius-lg)',
                  padding: 16, backgroundColor: '#fff',
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  flexWrap: 'wrap', gap: 8,
                }}
              >
                <div>
                  <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 2 }}>{req.label}</div>
                  <div style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>
                    {req.property_address && <span>{req.property_address} &middot; </span>}
                    {req.role === 'tenant' ? 'Tenant' : 'Landlord'}
                    {req.latest_check && (
                      <span> &middot; {req.latest_check.pass_count} pass, {req.latest_check.fail_count} fail, {req.latest_check.unclear_count} unclear</span>
                    )}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  {req.policy_id ? (
                    <button
                      onClick={() => router.push(`/policies/${req.policy_id}`)}
                      style={{
                        padding: '6px 14px', fontSize: 13, fontWeight: 600,
                        backgroundColor: 'var(--color-primary)', color: '#fff',
                        border: 'none', borderRadius: 'var(--radius-sm)', cursor: 'pointer',
                      }}
                    >
                      View on Policy
                    </button>
                  ) : (
                    <span style={{ fontSize: 12, color: 'var(--color-text-muted)', padding: '6px 0' }}>
                      No linked policy
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </>
      ) : (
        <div style={{ textAlign: 'center', padding: '48px 20px', color: 'var(--color-text-secondary)' }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>&#128203;</div>
          <p style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>
            Lease checks have moved
          </p>
          <p style={{ fontSize: 13, marginBottom: 20 }}>
            Lease checks are now available on your business policy pages. Open any commercial policy to check it against lease insurance requirements.
          </p>
          <button
            onClick={() => router.push('/policies')}
            style={{
              padding: '10px 24px', backgroundColor: 'var(--color-primary)', color: '#fff',
              border: 'none', borderRadius: 'var(--radius-md)', fontWeight: 600, fontSize: 14, cursor: 'pointer',
            }}
          >
            Go to Policies
          </button>
        </div>
      )}
    </div>
  );
}
