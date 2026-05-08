'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '../../../lib/auth';
import { authApi, agentApi } from '../../../lib/api';
import { track } from '../../../lib/track';
import { APP_NAME, APP_DESCRIPTION } from '../config';
import AuthHeader from '../components/AuthHeader';

export default function LoginPage() {
  const { login } = useAuth();
  const router = useRouter();
  const [sessionExpired, setSessionExpired] = useState(false);
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [teamInviteToken, setTeamInviteToken] = useState<string | null>(null);
  const [clientInvitePresent, setClientInvitePresent] = useState(false);
  // MFA challenge state
  const [mfaChallengeToken, setMfaChallengeToken] = useState<string | null>(null);
  const [mfaCode, setMfaCode] = useState('');
  const [mfaSubmitting, setMfaSubmitting] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    if (params.get('expired') === '1') setSessionExpired(true);
    const teamTok = params.get('team_invite');
    if (teamTok) {
      setTeamInviteToken(teamTok);
      setMode('register');
    }
    if (params.get('invite')) {
      // Client-side invite from an agent — backend auto-claims the
      // AgentClient row by email match on /auth/register, so we just
      // need to land them on the register form.
      setClientInvitePresent(true);
      setMode('register');
    }
  }, []);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<'individual' | 'broker'>('individual');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [touched, setTouched] = useState<Record<string, boolean>>({});

  const emailError = touched.email && !email.match(/^[^\s@]+@[^\s@]+\.[^\s@]+$/) ? 'Enter a valid email address' : '';
  const passwordError = touched.password && password.length < 6 ? 'Password must be at least 6 characters' : '';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setTouched({ email: true, password: true });
    const trimmedEmail = email.trim();
    if (!trimmedEmail.match(/^[^\s@]+@[^\s@]+\.[^\s@]+$/) || password.length < 6) return;
    setError('');
    setLoading(true);
    try {
      track(mode === 'login' ? 'login_submit' : 'register_submit', 'auth', { role: mode === 'register' ? role : undefined });
      const res = mode === 'login'
        ? await authApi.login(trimmedEmail, password)
        : await authApi.register(trimmedEmail, password, role);

      // MFA challenge — server says "password OK, but I need your TOTP"
      if (mode === 'login' && 'mfa_required' in res && res.mfa_required) {
        setMfaChallengeToken(res.mfa_token);
        setLoading(false);
        return;
      }

      login((res as { access_token: string }).access_token);

      // If we have a team invite token, claim it now (auth header is set after login())
      if (teamInviteToken) {
        try {
          await agentApi.acceptTeamInvite(teamInviteToken);
          track('team_invite_accepted', 'auth');
          router.push('/agent');
          return;
        } catch (err: any) {
          // Don't block login on accept failure — let user reach /agent anyway
          // and surface a soft error; their account is created.
          setError(`Signed in, but could not claim team invite: ${err.message || 'unknown error'}`);
          router.push('/agent');
          return;
        }
      }

      const returnTo = new URLSearchParams(window.location.search).get('returnTo');
      router.push(returnTo || '/policies');
    } catch (err: any) {
      setError(err.message || 'Something went wrong');
    } finally {
      setLoading(false);
    }
  };

  const handleMfaSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!mfaChallengeToken || !mfaCode.trim()) return;
    setMfaSubmitting(true);
    setError('');
    try {
      track('login_mfa_submit', 'auth');
      const res = await authApi.loginMfa(mfaChallengeToken, mfaCode.trim());
      login(res.access_token);
      const returnTo = new URLSearchParams(window.location.search).get('returnTo');
      router.push(returnTo || '/policies');
    } catch (err: any) {
      setError(err?.message || 'Invalid code — try again');
    } finally {
      setMfaSubmitting(false);
    }
  };

  return (
    <div className="login-wrap" style={{ display: 'flex', minHeight: '100vh', position: 'relative' }}>
      <AuthHeader variant="auto" />
      {/* Left panel — branding */}
      <div className="login-brand" style={{ flex: 1, background: 'linear-gradient(135deg, var(--color-primary-dark) 0%, var(--color-primary) 50%, var(--color-primary-light) 100%)', display: 'flex', flexDirection: 'column', justifyContent: 'center', padding: '64px', color: '#fff' }}>
        <div style={{ maxWidth: 420 }}>
          <div style={{ fontSize: 32, fontWeight: 700, marginBottom: 8, letterSpacing: '-0.02em' }}>{APP_NAME}</div>
          <div style={{ fontSize: 18, fontWeight: 400, opacity: 0.85, lineHeight: 1.5 }}>
            Organize, track, and manage all your insurance policies in one secure place.
          </div>
          <div style={{ marginTop: 40, display: 'flex', flexDirection: 'column', gap: 16 }}>
            {[
              ['Never search again', 'All your policies organized in one secure place'],
              ['Spot gaps before they cost you', 'See exactly what\'s covered and what\'s missing'],
              ['Be ready for anything', 'Emergency cards, claims steps, and renewal alerts'],
            ].map(([title, desc]) => (
              <div key={title} style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                <div style={{ width: 8, height: 8, borderRadius: '50%', backgroundColor: 'var(--color-accent-light)', marginTop: 6, flexShrink: 0 }} />
                <div>
                  <div style={{ fontWeight: 600, fontSize: 14 }}>{title}</div>
                  <div style={{ fontSize: 13, opacity: 0.7 }}>{desc}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Right panel — form */}
      <div className="login-form" style={{ width: '100%', maxWidth: 480, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 48, backgroundColor: 'var(--color-surface)' }}>
        <div style={{ width: '100%', maxWidth: 360 }}>
          <h1 style={{ margin: '0 0 4px', fontSize: 22, fontWeight: 700, color: 'var(--color-text)' }}>
            {mode === 'login' ? 'Welcome back' : 'Create account'}
          </h1>
          <p style={{ margin: '0 0 28px', color: 'var(--color-text-secondary)', fontSize: 14 }}>
            {mode === 'login' ? `Sign in to your ${APP_NAME} account` : `Get started with ${APP_NAME}`}
          </p>

          {teamInviteToken && (
            <div style={{
              marginBottom: 20, padding: '10px 14px', fontSize: 13,
              backgroundColor: '#eff6ff', border: '1px solid #bfdbfe',
              borderRadius: 'var(--radius-md)', color: '#1e3a8a',
            }}>
              You've been invited to join a team. {mode === 'register' ? 'Create your account' : 'Sign in'} to accept the invitation.
            </div>
          )}
          {clientInvitePresent && !teamInviteToken && (
            <div style={{
              marginBottom: 20, padding: '10px 14px', fontSize: 13,
              backgroundColor: '#eff6ff', border: '1px solid #bfdbfe',
              borderRadius: 'var(--radius-md)', color: '#1e3a8a',
            }}>
              Your insurance advisor invited you to Covrabl. {mode === 'register' ? 'Create your account' : 'Sign in'} to get started — your advisor's access will connect automatically.
            </div>
          )}
          {sessionExpired && !error && (
            <div style={{
              marginBottom: 20, padding: '10px 14px', fontSize: 13,
              backgroundColor: '#fef9c3', border: '1px solid #fde68a',
              borderRadius: 'var(--radius-md)', color: '#854d0e',
            }}>
              Your session expired. Please sign in again.
            </div>
          )}
          {error && <div className="alert alert-error" style={{ marginBottom: 20 }}>{error}</div>}

          {/* MFA challenge step — shown after a successful password login when 2FA is enabled */}
          {mfaChallengeToken ? (
            <form onSubmit={handleMfaSubmit}>
              <div style={{
                padding: '12px 14px', marginBottom: 16, fontSize: 13,
                backgroundColor: '#eff6ff', border: '1px solid #bfdbfe',
                borderRadius: 'var(--radius-md)', color: '#1e3a8a', lineHeight: 1.5,
              }}>
                Two-factor authentication is enabled on this account. Open your authenticator app and enter the 6-digit code, or use one of your recovery codes.
              </div>
              <label className="form-label">Authentication code</label>
              <input
                className="form-input"
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                value={mfaCode}
                onChange={e => setMfaCode(e.target.value)}
                placeholder="123456 or XXXX-XXXX-XXXX"
                autoFocus
                style={{ fontFamily: 'monospace', letterSpacing: '0.05em' }}
              />
              <div style={{ marginTop: 16, display: 'flex', gap: 8 }}>
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={mfaSubmitting || !mfaCode.trim()}
                  style={{ flex: 1 }}
                >
                  {mfaSubmitting ? 'Verifying…' : 'Verify and sign in'}
                </button>
                <button
                  type="button"
                  onClick={() => { setMfaChallengeToken(null); setMfaCode(''); setError(''); }}
                  style={{ padding: '0 16px', fontSize: 13, background: 'transparent', color: 'var(--color-text-muted)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', cursor: 'pointer' }}
                >
                  Cancel
                </button>
              </div>
            </form>
          ) : (
          <form onSubmit={handleSubmit}>
            <label className="form-label">Email</label>
            <input
              className={`form-input${emailError ? ' input-error' : ''}`}
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              onBlur={() => setTouched(t => ({ ...t, email: true }))}
              required
              placeholder="you@example.com"
              style={{ marginBottom: emailError ? 4 : 16 }}
            />
            {emailError && <span className="form-error" style={{ marginBottom: 12, display: 'block' }}>{emailError}</span>}

            <label className="form-label">Password</label>
            <input
              className={`form-input${passwordError ? ' input-error' : ''}`}
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              onBlur={() => setTouched(t => ({ ...t, password: true }))}
              required
              minLength={6}
              placeholder="At least 6 characters"
              style={{ marginBottom: passwordError ? 4 : 28 }}
            />
            {passwordError && <span className="form-error" style={{ marginBottom: 24, display: 'block' }}>{passwordError}</span>}

            {mode === 'register' && (
              <div style={{ marginBottom: 20 }}>
                <label className="form-label">I am a...</label>
                <div style={{ display: 'flex', gap: 8 }}>
                  {([['individual', 'Policy Holder'], ['broker', 'Insurance Broker']] as const).map(([val, label]) => (
                    <button
                      key={val}
                      type="button"
                      onClick={() => setRole(val)}
                      style={{
                        flex: 1, padding: '10px 12px', fontSize: 14, fontWeight: 600,
                        border: role === val ? '2px solid var(--color-primary)' : '1px solid var(--color-border)',
                        borderRadius: 'var(--radius-md)', cursor: 'pointer',
                        backgroundColor: role === val ? 'var(--color-primary-light)' : '#fff',
                        color: role === val ? 'var(--color-primary-dark)' : 'var(--color-text-secondary)',
                        transition: 'all 0.15s',
                      }}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {mode === 'login' && (
              <div style={{ textAlign: 'right', marginBottom: 20, marginTop: -12 }}>
                <Link href="/forgot-password" style={{ fontSize: 13, color: 'var(--color-accent)', textDecoration: 'none' }}>
                  Forgot your password?
                </Link>
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="btn btn-primary"
              style={{ width: '100%', padding: '11px 16px', fontSize: 15, fontWeight: 600 }}
            >
              {loading ? 'Please wait...' : mode === 'login' ? 'Sign In' : 'Create Account'}
            </button>
          </form>
          )}

          <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'center' }}>
            <p style={{ margin: 0, textAlign: 'center', fontSize: 11, color: 'var(--color-text-muted)', lineHeight: 1.5 }}>
              &#128274; Your data is encrypted and never shared or sold.
            </p>
            {mode === 'register' && (
              <p style={{ margin: 0, textAlign: 'center', fontSize: 11, color: 'var(--color-text-muted)', lineHeight: 1.5 }}>
                &#128737;&#65039; Bank-level AES-256 encryption &middot; Payments by Stripe
              </p>
            )}
          </div>

          <p style={{ marginTop: 20, textAlign: 'center', fontSize: 13, color: 'var(--color-text-secondary)' }}>
            {mode === 'login' ? "Don't have an account? " : 'Already have an account? '}
            <button
              onClick={() => { setMode(mode === 'login' ? 'register' : 'login'); setError(''); }}
              style={{ background: 'none', border: 'none', color: 'var(--color-accent)', cursor: 'pointer', fontSize: 13, fontWeight: 500 }}
            >
              {mode === 'login' ? 'Register' : 'Sign In'}
            </button>
          </p>
        </div>
      </div>
    </div>
  );
}
