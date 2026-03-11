'use client';

import { useState, useEffect, Suspense } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '../../../lib/auth';
import {
  leaseComplianceApi,
  LeaseRequirement,
  checkFeatureAccess,
} from '../../../lib/api';
import { trackClick } from '../../../lib/track';
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
  const [errorMsg, setErrorMsg] = useState('');

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

      {errorMsg && <div style={{ padding: '10px 16px', backgroundColor: '#fee2e2', color: '#991b1b', borderRadius: 8, fontSize: 13, marginBottom: 12 }}>{errorMsg}</div>}

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
                    {req.latest_check && (() => {
                      const lc = req.latest_check;
                      const lcAllPass = lc.fail_count === 0 && lc.unclear_count === 0 && lc.pass_count > 0;
                      const lcHasFail = lc.fail_count > 0;
                      const lcVerdict = lcAllPass ? 'Compliant' : lcHasFail ? (lc.pass_count > 0 ? 'Partially Compliant' : 'Non-Compliant') : 'Needs Verification';
                      const lcColor = lcAllPass ? '#166534' : lcHasFail ? '#991b1b' : '#92400e';
                      return (
                        <span> &middot; <span style={{ fontWeight: 600, color: lcColor }}>{lcVerdict}</span> ({lc.pass_count}/{lc.pass_count + lc.fail_count + lc.unclear_count} met)</span>
                      );
                    })()}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  {req.policy_id ? (
                    <button
                      onClick={() => { trackClick('view_lease_on_policy', { req_id: req.id }); router.push(`/policies/${req.policy_id}`); }}
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
                  <button
                    onClick={async () => {
                      trackClick('lease_dashboard_delete', { req_id: req.id });
                      if (!confirm('Delete this lease check?')) return;
                      try {
                        await leaseComplianceApi.remove(req.id);
                        setRequirements(prev => prev.filter(r => r.id !== req.id));
                      } catch {
                        setErrorMsg('Failed to delete. Please try again.');
                        setTimeout(() => setErrorMsg(''), 3000);
                      }
                    }}
                    style={{
                      padding: '6px 14px', fontSize: 13, fontWeight: 600,
                      backgroundColor: '#fff', color: 'var(--color-danger)',
                      border: '1px solid #fecaca', borderRadius: 'var(--radius-sm)', cursor: 'pointer',
                    }}
                  >
                    Delete
                  </button>
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
            onClick={() => { trackClick('lease_dashboard_go_to_policies'); router.push('/policies'); }}
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
