'use client';

import { useState, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { authApi } from '../../../lib/api';
import AuthHeader from '../components/AuthHeader';

function ResetPasswordContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get('token') || '';

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [touched, setTouched] = useState<Record<string, boolean>>({});

  const passwordError = touched.password && password.length < 6 ? 'Password must be at least 6 characters' : '';
  const confirmError = touched.confirm && confirm !== password ? 'Passwords do not match' : '';

  useEffect(() => {
    if (success) {
      const timer = setTimeout(() => router.push('/login'), 2000);
      return () => clearTimeout(timer);
    }
  }, [success, router]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setTouched({ password: true, confirm: true });
    if (password.length < 6 || confirm !== password) return;
    setError('');
    setLoading(true);
    try {
      await authApi.resetPassword(token, password);
      setSuccess(true);
    } catch (err: any) {
      setError(err.message || 'Something went wrong');
    } finally {
      setLoading(false);
    }
  };

  if (!token) {
    return (
      <div style={{ display: 'flex', minHeight: '100vh', alignItems: 'center', justifyContent: 'center', backgroundColor: 'var(--color-surface)', padding: 24, position: 'relative' }}>
        <AuthHeader variant="dark" />
        <div style={{ width: '100%', maxWidth: 400, textAlign: 'center' }}>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--color-text)', marginBottom: 12 }}>Invalid reset link</h1>
          <p style={{ color: 'var(--color-text-secondary)', fontSize: 14, marginBottom: 24 }}>
            This password reset link is invalid. Please request a new one.
          </p>
          <Link href="/forgot-password" style={{ color: 'var(--color-accent)', textDecoration: 'none', fontSize: 14 }}>
            Request new reset link
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', minHeight: '100vh', alignItems: 'center', justifyContent: 'center', backgroundColor: 'var(--color-surface)', padding: 24, position: 'relative' }}>
      <AuthHeader variant="dark" />
      <div style={{ width: '100%', maxWidth: 400 }}>
        <h1 style={{ margin: '0 0 4px', fontSize: 22, fontWeight: 700, color: 'var(--color-text)' }}>
          Set new password
        </h1>
        <p style={{ margin: '0 0 28px', color: 'var(--color-text-secondary)', fontSize: 14 }}>
          Enter your new password below.
        </p>

        {error && <div className="alert alert-error" style={{ marginBottom: 20 }}>{error}</div>}

        {success ? (
          <div style={{ background: 'var(--color-success-bg, #f0fdf4)', border: '1px solid var(--color-success-border, #bbf7d0)', borderRadius: 8, padding: '16px 20px', marginBottom: 24 }}>
            <p style={{ margin: 0, color: 'var(--color-text)', fontSize: 14, lineHeight: 1.5 }}>
              Password reset successfully! Redirecting to sign in...
            </p>
          </div>
        ) : (
          <form onSubmit={handleSubmit}>
            <label className="form-label">New password</label>
            <input
              className={`form-input${passwordError ? ' input-error' : ''}`}
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              onBlur={() => setTouched(t => ({ ...t, password: true }))}
              required
              minLength={6}
              placeholder="At least 6 characters"
              style={{ marginBottom: passwordError ? 4 : 16 }}
            />
            {passwordError && <span className="form-error" style={{ marginBottom: 12, display: 'block' }}>{passwordError}</span>}

            <label className="form-label">Confirm password</label>
            <input
              className={`form-input${confirmError ? ' input-error' : ''}`}
              type="password"
              value={confirm}
              onChange={e => setConfirm(e.target.value)}
              onBlur={() => setTouched(t => ({ ...t, confirm: true }))}
              required
              minLength={6}
              placeholder="Re-enter your password"
              style={{ marginBottom: confirmError ? 4 : 28 }}
            />
            {confirmError && <span className="form-error" style={{ marginBottom: 24, display: 'block' }}>{confirmError}</span>}

            <button
              type="submit"
              disabled={loading}
              className="btn btn-primary"
              style={{ width: '100%', padding: '11px 16px', fontSize: 15, fontWeight: 600 }}
            >
              {loading ? 'Resetting...' : 'Reset Password'}
            </button>
          </form>
        )}

        <p style={{ marginTop: 24, textAlign: 'center', fontSize: 13, color: 'var(--color-text-secondary)' }}>
          <Link href="/login" style={{ color: 'var(--color-accent)', textDecoration: 'none' }}>
            Back to Sign In
          </Link>
        </p>
      </div>
    </div>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={<div style={{ display: 'flex', minHeight: '100vh', alignItems: 'center', justifyContent: 'center' }}>Loading...</div>}>
      <ResetPasswordContent />
    </Suspense>
  );
}
