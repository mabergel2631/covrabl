'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '../../../lib/auth';
import { authApi } from '../../../lib/api';
import { APP_NAME, APP_DESCRIPTION } from '../config';
import AuthHeader from '../components/AuthHeader';

export default function LoginPage() {
  const { login } = useAuth();
  const router = useRouter();
  const [sessionExpired, setSessionExpired] = useState(false);
  const [mode, setMode] = useState<'login' | 'register'>('login');

  useEffect(() => {
    if (typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('expired') === '1') {
      setSessionExpired(true);
    }
  }, []);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
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
      const fn = mode === 'login' ? authApi.login : authApi.register;
      const res = await fn(trimmedEmail, password);
      login(res.access_token);
      router.push('/policies');
    } catch (err: any) {
      setError(err.message || 'Something went wrong');
    } finally {
      setLoading(false);
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

          <p style={{ marginTop: 12, textAlign: 'center', fontSize: 11, color: 'var(--color-text-muted)', lineHeight: 1.5 }}>
            &#128274; Your insurance documents remain private. {APP_NAME} analyzes them only to provide coverage insights.
          </p>

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
