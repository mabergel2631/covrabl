'use client';

import { useState } from 'react';
import Link from 'next/link';
import { authApi } from '../../../lib/api';
import { APP_NAME } from '../config';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = email.trim();
    if (!trimmed.match(/^[^\s@]+@[^\s@]+\.[^\s@]+$/)) return;
    setError('');
    setLoading(true);
    try {
      await authApi.forgotPassword(trimmed);
      setSent(true);
    } catch (err: any) {
      setError(err.message || 'Something went wrong');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ display: 'flex', minHeight: '100vh', alignItems: 'center', justifyContent: 'center', backgroundColor: 'var(--color-surface)', padding: 24 }}>
      <div style={{ width: '100%', maxWidth: 400 }}>
        <h1 style={{ margin: '0 0 4px', fontSize: 22, fontWeight: 700, color: 'var(--color-text)' }}>
          Reset your password
        </h1>
        <p style={{ margin: '0 0 28px', color: 'var(--color-text-secondary)', fontSize: 14, lineHeight: 1.5 }}>
          Enter the email address associated with your {APP_NAME} account and we&apos;ll send you a link to reset your password.
        </p>

        {error && <div className="alert alert-error" style={{ marginBottom: 20 }}>{error}</div>}

        {sent ? (
          <div style={{ background: 'var(--color-success-bg, #f0fdf4)', border: '1px solid var(--color-success-border, #bbf7d0)', borderRadius: 8, padding: '16px 20px', marginBottom: 24 }}>
            <p style={{ margin: 0, color: 'var(--color-text)', fontSize: 14, lineHeight: 1.5 }}>
              If an account exists with that email, we&apos;ve sent a reset link. Check your inbox and spam folder.
            </p>
          </div>
        ) : (
          <form onSubmit={handleSubmit}>
            <label className="form-label">Email</label>
            <input
              className="form-input"
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              required
              placeholder="you@example.com"
              style={{ marginBottom: 20 }}
            />
            <button
              type="submit"
              disabled={loading}
              className="btn btn-primary"
              style={{ width: '100%', padding: '11px 16px', fontSize: 15, fontWeight: 600 }}
            >
              {loading ? 'Sending...' : 'Send Reset Link'}
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
