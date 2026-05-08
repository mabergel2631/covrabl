'use client';

import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { authApi } from '../../../lib/api';
import { trackClick, trackFeatureUse } from '../../../lib/track';

type Status = { mfa_enabled: boolean; mfa_enrolled_at: string | null; recovery_codes_remaining: number };
type SetupData = { otpauth_uri: string; secret: string; recovery_codes: string[] };

export default function MfaSection() {
  const [status, setStatus] = useState<Status | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Enrollment in progress
  const [setupData, setSetupData] = useState<SetupData | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string>('');
  const [enrollCode, setEnrollCode] = useState('');
  const [enrolling, setEnrolling] = useState(false);
  const [savedCodes, setSavedCodes] = useState(false);

  // Disable
  const [disablePassword, setDisablePassword] = useState('');
  const [disableCode, setDisableCode] = useState('');
  const [showDisable, setShowDisable] = useState(false);
  const [disabling, setDisabling] = useState(false);

  useEffect(() => { void refresh(); }, []);

  async function refresh() {
    setLoading(true);
    try {
      const s = await authApi.mfaStatus();
      setStatus(s);
    } catch (e: any) {
      setError(e?.message || 'Could not load 2FA status');
    } finally {
      setLoading(false);
    }
  }

  async function startEnroll() {
    setError('');
    trackClick('mfa_setup_start');
    try {
      const data = await authApi.mfaSetup();
      const qr = await QRCode.toDataURL(data.otpauth_uri, { width: 200, margin: 1 });
      setSetupData(data);
      setQrDataUrl(qr);
      setEnrollCode('');
      setSavedCodes(false);
    } catch (e: any) {
      setError(e?.message || 'Could not start enrollment');
    }
  }

  async function confirmEnroll() {
    if (!enrollCode.trim()) return;
    setEnrolling(true);
    setError('');
    try {
      await authApi.mfaEnable(enrollCode.trim());
      trackFeatureUse('mfa_enabled');
      setSetupData(null);
      setQrDataUrl('');
      setEnrollCode('');
      setSavedCodes(false);
      await refresh();
    } catch (e: any) {
      setError(e?.message || 'Invalid code');
    } finally {
      setEnrolling(false);
    }
  }

  async function cancelEnroll() {
    // Best-effort: call disable to clear any staged secret
    try {
      await authApi.mfaDisable('', '');  // will fail validation but signals intent — staged secret stays until they actually enroll or disable with password
    } catch { /* ignore */ }
    setSetupData(null);
    setQrDataUrl('');
    setEnrollCode('');
    setError('');
  }

  async function handleDisable() {
    if (!disablePassword) return;
    setDisabling(true);
    setError('');
    try {
      await authApi.mfaDisable(disablePassword, disableCode || undefined);
      trackFeatureUse('mfa_disabled');
      setShowDisable(false);
      setDisablePassword('');
      setDisableCode('');
      await refresh();
    } catch (e: any) {
      setError(e?.message || 'Could not disable 2FA');
    } finally {
      setDisabling(false);
    }
  }

  function downloadRecoveryCodes() {
    if (!setupData) return;
    const text = [
      'Covrabl two-factor recovery codes',
      'Saved on: ' + new Date().toLocaleString(),
      '',
      'Each code works ONCE. Use them if you lose access to your authenticator app.',
      '',
      ...setupData.recovery_codes,
      '',
      'Store this file in a password manager or printed in a safe place.',
    ].join('\n');
    const blob = new Blob([text], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `covrabl-recovery-codes-${new Date().toISOString().slice(0, 10)}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    trackFeatureUse('mfa_recovery_codes_saved');
    setSavedCodes(true);
  }

  if (loading) return null;

  return (
    <div style={{
      padding: 0, marginBottom: 20, overflow: 'hidden',
      border: '1px solid var(--color-border)', borderRadius: 'var(--radius-lg)',
      backgroundColor: '#fff',
    }}>
      <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--color-border)', backgroundColor: 'var(--color-bg)' }}>
        <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: 'var(--color-text)' }}>
          Two-factor authentication
        </h2>
      </div>

      <div style={{ padding: 20 }}>
        {error && <div className="alert alert-error" style={{ marginBottom: 16 }}>{error}</div>}

        {/* ── Already enabled — show status + disable option ── */}
        {status?.mfa_enabled && !setupData && (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <span style={{ padding: '2px 10px', borderRadius: 12, fontSize: 12, fontWeight: 600, backgroundColor: '#dcfce7', color: '#166534' }}>
                ✓ Enabled
              </span>
              {status.mfa_enrolled_at && (
                <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>
                  since {new Date(status.mfa_enrolled_at).toLocaleDateString()}
                </span>
              )}
            </div>
            <p style={{ fontSize: 13, color: 'var(--color-text-secondary)', margin: '0 0 12px', lineHeight: 1.6 }}>
              Sign-in requires a 6-digit code from your authenticator app. {status.recovery_codes_remaining} recovery code{status.recovery_codes_remaining === 1 ? '' : 's'} remaining.
            </p>
            {!showDisable ? (
              <button
                onClick={() => { trackClick('mfa_disable_open'); setShowDisable(true); }}
                style={{ padding: '6px 14px', fontSize: 13, fontWeight: 500, backgroundColor: 'transparent', color: 'var(--color-danger)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', cursor: 'pointer' }}
              >
                Disable 2FA
              </button>
            ) : (
              <div style={{ padding: 14, backgroundColor: 'var(--color-bg)', borderRadius: 'var(--radius-md)' }}>
                <p style={{ fontSize: 13, color: 'var(--color-text-secondary)', margin: '0 0 10px' }}>
                  Enter your password and a current 2FA code (or recovery code) to confirm.
                </p>
                <input type="password" placeholder="Password" value={disablePassword} onChange={e => setDisablePassword(e.target.value)} className="form-input" style={{ marginBottom: 8 }} />
                <input type="text" placeholder="6-digit code or recovery code" value={disableCode} onChange={e => setDisableCode(e.target.value)} className="form-input" style={{ marginBottom: 10, fontFamily: 'monospace' }} />
                <div style={{ display: 'flex', gap: 8 }}>
                  <button onClick={handleDisable} disabled={disabling || !disablePassword} className="btn btn-primary" style={{ flex: 1 }}>
                    {disabling ? 'Disabling…' : 'Confirm disable'}
                  </button>
                  <button onClick={() => { setShowDisable(false); setDisablePassword(''); setDisableCode(''); setError(''); }} style={{ padding: '0 14px', fontSize: 13, background: 'transparent', color: 'var(--color-text-muted)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', cursor: 'pointer' }}>
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </>
        )}

        {/* ── Not enabled, no enrollment in progress — show CTA ── */}
        {!status?.mfa_enabled && !setupData && (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <span style={{ padding: '2px 10px', borderRadius: 12, fontSize: 12, fontWeight: 600, backgroundColor: '#fef3c7', color: '#92400e' }}>
                Not enabled
              </span>
            </div>
            <p style={{ fontSize: 13, color: 'var(--color-text-secondary)', margin: '0 0 12px', lineHeight: 1.6 }}>
              Add a second sign-in step using an authenticator app (Google Authenticator, 1Password, Authy, etc.). Strongly recommended for accounts holding insurance documents.
            </p>
            <button onClick={startEnroll} className="btn btn-primary" style={{ padding: '8px 18px' }}>
              Set up 2FA
            </button>
          </>
        )}

        {/* ── Enrollment in progress — show QR + code entry + recovery codes ── */}
        {setupData && (
          <div>
            <p style={{ fontSize: 13, color: 'var(--color-text-secondary)', margin: '0 0 12px', lineHeight: 1.6 }}>
              <strong>Step 1.</strong> Scan this QR code with your authenticator app, or copy the secret manually.
            </p>
            <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start', flexWrap: 'wrap', marginBottom: 16 }}>
              {qrDataUrl && <img src={qrDataUrl} alt="2FA QR code" style={{ border: '1px solid var(--color-border)', borderRadius: 8 }} />}
              <div style={{ flex: 1, minWidth: 200 }}>
                <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginBottom: 4 }}>Or enter this secret manually:</div>
                <code style={{ display: 'block', padding: '8px 12px', backgroundColor: 'var(--color-bg)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', fontSize: 12, wordBreak: 'break-all' }}>
                  {setupData.secret}
                </code>
              </div>
            </div>

            <p style={{ fontSize: 13, color: 'var(--color-text-secondary)', margin: '0 0 8px', lineHeight: 1.6 }}>
              <strong>Step 2.</strong> Save these recovery codes — each works once if you lose access to your app.
            </p>
            <div style={{
              padding: 12, marginBottom: 12,
              backgroundColor: '#fef9c3', border: '1px solid #fde68a',
              borderRadius: 'var(--radius-md)',
              fontFamily: 'monospace', fontSize: 12, lineHeight: 1.7,
              display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 6,
            }}>
              {setupData.recovery_codes.map(c => <div key={c}>{c}</div>)}
            </div>
            <button onClick={downloadRecoveryCodes} style={{ padding: '6px 14px', fontSize: 12, fontWeight: 500, backgroundColor: 'var(--color-surface)', color: 'var(--color-text)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', cursor: 'pointer', marginBottom: 16 }}>
              {savedCodes ? '✓ Downloaded' : 'Download recovery codes (.txt)'}
            </button>

            <p style={{ fontSize: 13, color: 'var(--color-text-secondary)', margin: '0 0 8px', lineHeight: 1.6 }}>
              <strong>Step 3.</strong> Enter the 6-digit code from your authenticator app to finish enrollment.
            </p>
            <input
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              value={enrollCode}
              onChange={e => setEnrollCode(e.target.value)}
              placeholder="123456"
              className="form-input"
              style={{ marginBottom: 12, fontFamily: 'monospace', letterSpacing: '0.05em' }}
            />
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={confirmEnroll} disabled={enrolling || !enrollCode.trim() || !savedCodes} className="btn btn-primary" style={{ flex: 1 }}>
                {enrolling ? 'Verifying…' : 'Enable 2FA'}
              </button>
              <button onClick={cancelEnroll} style={{ padding: '0 14px', fontSize: 13, background: 'transparent', color: 'var(--color-text-muted)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', cursor: 'pointer' }}>
                Cancel
              </button>
            </div>
            {!savedCodes && (
              <p style={{ fontSize: 11, color: 'var(--color-text-muted)', margin: '8px 0 0' }}>
                Download your recovery codes before clicking Enable — you won't see them again.
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
