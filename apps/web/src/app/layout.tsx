'use client';

import { useEffect } from 'react';
import './globals.css';
import { AuthProvider } from '../../lib/auth';
import AppShell from './components/AppShell';
import { ToastProvider } from './components/Toast';
import InstallPrompt from './components/InstallPrompt';
import SessionWarning from './components/SessionWarning';
import { APP_NAME, APP_THEME_COLOR } from './config';
import { isNativeApp } from '../../lib/capacitor';
import { initNativePlugins } from '../../lib/capacitor-init';

export default function RootLayout({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    // Initialize native Capacitor plugins (no-op on web)
    initNativePlugins();

    // Service worker — web only (Capacitor manages its own caching)
    if (!isNativeApp() && 'serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').then((reg) => {
        // Check for SW updates on every page load so new deploys propagate fast
        reg.update().catch(() => {});
      }).catch(() => {});
    }
  }, []);

  return (
    <html lang="en">
      <head>
        <title>Covrabl — Know What You&apos;re Covered For</title>
        <meta name="description" content="Upload your insurance policies and instantly see what's covered, where you have gaps, and what's coming up at renewal." />
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
        <meta name="theme-color" content={APP_THEME_COLOR} />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="apple-mobile-web-app-title" content={APP_NAME} />

        {/* Open Graph */}
        <meta property="og:title" content="Covrabl — Know What You're Covered For" />
        <meta property="og:description" content="Upload your insurance policies and instantly see what's covered, where you have gaps, and what's coming up at renewal." />
        <meta property="og:type" content="website" />
        <meta property="og:url" content="https://covrabl.com" />
        <meta property="og:image" content="https://covrabl.com/brand/og-image.svg" />

        {/* Twitter */}
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:title" content="Covrabl — Know What You're Covered For" />
        <meta name="twitter:description" content="Upload your insurance policies and instantly see what's covered, where you have gaps, and what's coming up at renewal." />

        <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
        <link rel="manifest" href="/manifest.json" />
        <link rel="apple-touch-icon" sizes="180x180" href="/icons/icon-180.png" />

        {/* Analytics — Plausible (cookie-free) */}
        <script defer data-domain="covrabl.com" src="https://plausible.io/js/script.js" />
      </head>
      <body>
        <AuthProvider>
          <ToastProvider>
            <AppShell>{children}</AppShell>
            <InstallPrompt />
          </ToastProvider>
          <SessionWarning />
        </AuthProvider>
      </body>
    </html>
  );
}
