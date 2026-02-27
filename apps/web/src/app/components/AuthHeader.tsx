'use client';

import Link from 'next/link';
import Logo from './Logo';

/**
 * Minimal header for unauthenticated pages (login, register, forgot/reset password).
 * Shows a back arrow + logo linking home so users are never trapped.
 *
 * variant="light" — white text (for dark backgrounds)
 * variant="dark"  — dark text (for light backgrounds)
 * variant="auto"  — light on desktop, dark on mobile (for login page split layout)
 */
export default function AuthHeader({ variant = 'light' }: { variant?: 'light' | 'dark' | 'auto' }) {
  const colorClass = variant === 'auto' ? 'auth-header-auto' : '';
  const textColor = variant === 'dark' ? 'var(--color-text)' : variant === 'light' ? '#fff' : '#fff';

  return (
    <div
      className={colorClass || undefined}
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '16px 24px',
        zIndex: 10,
        color: textColor,
      }}
    >
      <Link
        href="/"
        aria-label="Back to home"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          textDecoration: 'none',
          color: 'inherit',
        }}
      >
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M12.5 15L7.5 10L12.5 5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
        <Logo size="sm" variant={variant === 'dark' ? 'dark' : 'light'} />
      </Link>
    </div>
  );
}
