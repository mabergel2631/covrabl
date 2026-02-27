'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { iceApi, EmergencyCardPublic } from '../../../../lib/api';
import { APP_NAME } from '../../config';
import { cacheEmergencyData, getCachedEmergencyData, formatCacheTimestamp } from '../../../../lib/offlineCache';
import { formatPhone, cleanPhone } from '../../../../lib/format';

const POLICY_TYPE_CONFIG: Record<string, { icon: string; label: string }> = {
  auto: { icon: '🚗', label: 'Auto' },
  home: { icon: '🏠', label: 'Home' },
  life: { icon: '❤️', label: 'Life' },
  health: { icon: '🏥', label: 'Health' },
  liability: { icon: '🛡️', label: 'Liability' },
  umbrella: { icon: '☂️', label: 'Umbrella' },
  workers_comp: { icon: '👷', label: 'Workers Comp' },
  other: { icon: '📋', label: 'Other' },
};

export default function EmergencyCardPage() {
  const params = useParams();
  const router = useRouter();
  const accessCode = params.code as string;

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [requiresPin, setRequiresPin] = useState(false);
  const [holderName, setHolderName] = useState('');
  const [pin, setPin] = useState('');
  const [cardData, setCardData] = useState<EmergencyCardPublic | null>(null);
  const [copiedField, setCopiedField] = useState<string | null>(null);

  // Offline state
  const [isOnline, setIsOnline] = useState(true);
  const [isUsingCache, setIsUsingCache] = useState(false);
  const [cacheTimestamp, setCacheTimestamp] = useState<number | null>(null);

  // Track online status
  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    setIsOnline(typeof navigator !== 'undefined' ? navigator.onLine : true);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  useEffect(() => {
    loadCard();
  }, [accessCode]);

  const loadCard = async () => {
    const cacheKey = `ice_card_${accessCode}`;
    try {
      setLoading(true);
      setError('');
      const data = await iceApi.getPublic(accessCode);
      if (data.requires_pin) {
        setRequiresPin(true);
        setHolderName(data.holder_name);
      } else {
        setCardData(data);
        setIsUsingCache(false);
        // Cache the data for offline use
        await cacheEmergencyData(cacheKey, data);
      }
    } catch (err: any) {
      // Try to load from cache if offline
      try {
        const cached = await getCachedEmergencyData<EmergencyCardPublic>(cacheKey);
        if (cached && !cached.data.requires_pin) {
          setCardData(cached.data);
          setCacheTimestamp(cached.timestamp);
          setIsUsingCache(true);
          setError('');
        } else {
          setError(err.message || 'Emergency card not found');
        }
      } catch {
        setError(err.message || 'Emergency card not found');
      }
    } finally {
      setLoading(false);
    }
  };

  const handlePinSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const cacheKey = `ice_card_${accessCode}`;
    try {
      setLoading(true);
      setError('');
      const data = await iceApi.verifyPin(accessCode, pin);
      setCardData(data);
      setRequiresPin(false);
      setIsUsingCache(false);
      // Cache the verified data
      await cacheEmergencyData(cacheKey, data);
    } catch (err: any) {
      setError(err.message || 'Incorrect PIN');
    } finally {
      setLoading(false);
    }
  };

  const copyToClipboard = (text: string, field: string) => {
    navigator.clipboard.writeText(text);
    setCopiedField(field);
    setTimeout(() => setCopiedField(null), 2000);
  };

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f3f4f6' }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>🆘</div>
          <p style={{ color: '#6b7280' }}>Loading emergency information...</p>
        </div>
      </div>
    );
  }

  if (error && !requiresPin) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f3f4f6' }}>
        <div style={{ textAlign: 'center', padding: 32 }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>⚠️</div>
          <h1 style={{ fontSize: 24, fontWeight: 600, marginBottom: 8 }}>Card Not Found</h1>
          <p style={{ color: '#6b7280' }}>{error}</p>
        </div>
      </div>
    );
  }

  // PIN entry screen
  if (requiresPin && !cardData) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f3f4f6', padding: 24 }}>
        <div style={{ maxWidth: 400, width: '100%', background: '#fff', borderRadius: 12, padding: 32, boxShadow: '0 4px 20px rgba(0,0,0,0.1)' }}>
          <div style={{ textAlign: 'center', marginBottom: 24 }}>
            <div style={{ fontSize: 48, marginBottom: 16 }}>🔐</div>
            <h1 style={{ fontSize: 20, fontWeight: 600, marginBottom: 8 }}>Emergency Card</h1>
            <p style={{ color: '#6b7280', fontSize: 14 }}>For: {holderName}</p>
          </div>

          <form onSubmit={handlePinSubmit}>
            <label style={{ display: 'block', fontSize: 14, fontWeight: 500, marginBottom: 8 }}>
              Enter PIN to access
            </label>
            <input
              type="password"
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={6}
              value={pin}
              onChange={(e) => setPin(e.target.value)}
              placeholder="Enter PIN"
              style={{
                width: '100%',
                padding: '12px 16px',
                fontSize: 18,
                textAlign: 'center',
                letterSpacing: 8,
                border: '2px solid #e5e7eb',
                borderRadius: 8,
                marginBottom: 16,
              }}
              autoFocus
            />
            {error && (
              <p style={{ color: '#dc2626', fontSize: 14, marginBottom: 16, textAlign: 'center' }}>{error}</p>
            )}
            <button
              type="submit"
              disabled={pin.length < 4}
              style={{
                width: '100%',
                padding: '12px 24px',
                fontSize: 16,
                fontWeight: 600,
                backgroundColor: pin.length >= 4 ? '#2563eb' : '#9ca3af',
                color: '#fff',
                border: 'none',
                borderRadius: 8,
                cursor: pin.length >= 4 ? 'pointer' : 'not-allowed',
              }}
            >
              Access Card
            </button>
          </form>
        </div>
      </div>
    );
  }

  // Full card view
  return (
    <div style={{ minHeight: '100vh', background: '#f3f4f6', padding: '24px 16px' }}>
      <div style={{ maxWidth: 600, margin: '0 auto' }}>
        {/* Back button */}
        <button
          onClick={() => {
            if (window.history.length > 1) {
              router.back();
            } else {
              router.push('/');
            }
          }}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            fontSize: 14,
            color: '#6b7280',
            padding: '4px 0',
            marginBottom: 12,
          }}
        >
          ← Back
        </button>

        {/* Offline Banner */}
        {(!isOnline || isUsingCache) && (
          <div style={{
            padding: '12px 16px',
            marginBottom: 12,
            backgroundColor: !isOnline ? '#fef3c7' : '#e0f2fe',
            border: `1px solid ${!isOnline ? '#fcd34d' : '#7dd3fc'}`,
            borderRadius: 8,
            display: 'flex',
            alignItems: 'center',
            gap: 12,
          }}>
            <span style={{ fontSize: 20 }}>{!isOnline ? '📡' : '💾'}</span>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 600, fontSize: 14, color: !isOnline ? '#92400e' : '#0369a1' }}>
                {!isOnline ? 'You are offline' : 'Viewing cached data'}
              </div>
              {cacheTimestamp && (
                <div style={{ fontSize: 12, color: '#6b7280' }}>
                  Last updated: {formatCacheTimestamp(cacheTimestamp)}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Header */}
        <div style={{
          background: 'linear-gradient(135deg, #dc2626 0%, #b91c1c 100%)',
          color: '#fff',
          padding: 24,
          borderRadius: '12px 12px 0 0',
          textAlign: 'center',
        }}>
          <div style={{ fontSize: 32, marginBottom: 8 }}>🆘</div>
          <h1 style={{ fontSize: 20, fontWeight: 700, margin: '0 0 4px' }}>EMERGENCY INSURANCE INFO</h1>
          <p style={{ fontSize: 16, opacity: 0.9, margin: 0 }}>For: {cardData?.holder_name}</p>
        </div>

        {/* Emergency Contact */}
        {(cardData?.emergency_contact_name || cardData?.emergency_contact_phone) && (
          <div style={{
            background: '#fef2f2',
            borderLeft: '4px solid #dc2626',
            padding: 16,
            marginTop: 2,
          }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: '#991b1b', marginBottom: 4 }}>EMERGENCY CONTACT</div>
            {cardData.emergency_contact_name && (
              <div style={{ fontSize: 16, fontWeight: 600, color: '#1f2937' }}>{cardData.emergency_contact_name}</div>
            )}
            {cardData.emergency_contact_phone && (
              <a
                href={`tel:${cleanPhone(cardData.emergency_contact_phone)}`}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 8,
                  marginTop: 8,
                  padding: '8px 16px',
                  backgroundColor: '#dc2626',
                  color: '#fff',
                  borderRadius: 8,
                  textDecoration: 'none',
                  fontSize: 14,
                  fontWeight: 600,
                }}
              >
                📞 Call {formatPhone(cardData.emergency_contact_phone)}
              </a>
            )}
          </div>
        )}

        {/* Policies */}
        <div style={{ background: '#fff', borderRadius: '0 0 12px 12px', overflow: 'hidden' }}>
          {cardData?.policies?.map((policy, index) => (
            <div
              key={policy.id}
              style={{
                padding: 20,
                borderTop: index > 0 ? '1px solid #e5e7eb' : undefined,
              }}
            >
              {/* Policy Header */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
                <span style={{ fontSize: 28 }}>{POLICY_TYPE_CONFIG[policy.policy_type]?.icon || '📋'}</span>
                <div>
                  <div style={{ fontSize: 12, color: '#6b7280', textTransform: 'uppercase', fontWeight: 600 }}>
                    {POLICY_TYPE_CONFIG[policy.policy_type]?.label || policy.policy_type}
                  </div>
                  <div style={{ fontSize: 18, fontWeight: 600, color: '#1f2937' }}>{policy.carrier}</div>
                </div>
              </div>

              {/* Policy Number */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12, padding: 12, backgroundColor: '#f9fafb', borderRadius: 8, flexWrap: 'wrap', gap: 8 }}>
                <div>
                  <div style={{ fontSize: 11, color: '#6b7280', marginBottom: 2 }}>POLICY NUMBER</div>
                  <div style={{ fontSize: 16, fontWeight: 600, fontFamily: 'monospace' }}>{policy.policy_number}</div>
                </div>
                <button
                  onClick={() => copyToClipboard(policy.policy_number, `policy-${policy.id}`)}
                  style={{
                    padding: '6px 12px',
                    fontSize: 12,
                    backgroundColor: copiedField === `policy-${policy.id}` ? '#22c55e' : '#e5e7eb',
                    color: copiedField === `policy-${policy.id}` ? '#fff' : '#374151',
                    border: 'none',
                    borderRadius: 6,
                    cursor: 'pointer',
                  }}
                >
                  {copiedField === `policy-${policy.id}` ? '✓ Copied' : 'Copy'}
                </button>
              </div>

              {/* Coverage Info */}
              {(policy.coverage_amount || policy.deductible) && (
                <div style={{ display: 'flex', gap: 16, marginBottom: 12 }}>
                  {policy.coverage_amount && (
                    <div style={{ flex: 1, padding: 12, backgroundColor: '#f0fdf4', borderRadius: 8 }}>
                      <div style={{ fontSize: 11, color: '#166534', marginBottom: 2 }}>COVERAGE</div>
                      <div style={{ fontSize: 18, fontWeight: 700, color: '#166534' }}>
                        ${policy.coverage_amount.toLocaleString()}
                      </div>
                    </div>
                  )}
                  {policy.deductible && (
                    <div style={{ flex: 1, padding: 12, backgroundColor: '#fef3c7', borderRadius: 8 }}>
                      <div style={{ fontSize: 11, color: '#92400e', marginBottom: 2 }}>DEDUCTIBLE</div>
                      <div style={{ fontSize: 18, fontWeight: 700, color: '#92400e' }}>
                        ${policy.deductible.toLocaleString()}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Claims Phone */}
              {policy.claims_phone && (
                <a
                  href={`tel:${cleanPhone(policy.claims_phone)}`}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 8,
                    padding: '12px 16px',
                    backgroundColor: '#2563eb',
                    color: '#fff',
                    borderRadius: 8,
                    textDecoration: 'none',
                    fontSize: 15,
                    fontWeight: 600,
                    marginBottom: 8,
                  }}
                >
                  📞 Call Claims: {formatPhone(policy.claims_phone)}
                </a>
              )}

              {/* Agent Info */}
              {(policy.agent_name || policy.agent_phone) && (
                <div style={{ fontSize: 13, color: '#6b7280', textAlign: 'center' }}>
                  {policy.agent_name && <span>Agent: {policy.agent_name}</span>}
                  {policy.agent_name && policy.agent_phone && <span> • </span>}
                  {policy.agent_phone && (
                    <a href={`tel:${cleanPhone(policy.agent_phone)}`} style={{ color: '#2563eb' }}>
                      {formatPhone(policy.agent_phone)}
                    </a>
                  )}
                </div>
              )}
            </div>
          ))}

          {/* Footer */}
          <div style={{ padding: 16, borderTop: '1px solid #e5e7eb', textAlign: 'center', color: '#9ca3af', fontSize: 12 }}>
            Last updated: {cardData?.last_updated ? new Date(cardData.last_updated).toLocaleDateString() : 'Unknown'}
            <br />
            Powered by {APP_NAME}
          </div>
        </div>
      </div>
    </div>
  );
}
