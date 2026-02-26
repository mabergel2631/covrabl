'use client';

import { useState, useEffect } from 'react';
import { isNativeApp } from '../../../lib/capacitor';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export default function InstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [showPrompt, setShowPrompt] = useState(false);
  const [isIOS, setIsIOS] = useState(false);

  useEffect(() => {
    // No install prompt inside native app shell
    if (isNativeApp()) return;

    // Check if already installed
    if (window.matchMedia('(display-mode: standalone)').matches) {
      return;
    }

    // Check if dismissed recently
    const dismissed = localStorage.getItem('pwa-prompt-dismissed');
    if (dismissed) {
      const dismissedAt = parseInt(dismissed, 10);
      // Don't show again for 7 days
      if (Date.now() - dismissedAt < 7 * 24 * 60 * 60 * 1000) {
        return;
      }
    }

    // Detect iOS
    const isIOSDevice = /iPad|iPhone|iPod/.test(navigator.userAgent) && !(window as any).MSStream;
    setIsIOS(isIOSDevice);

    if (isIOSDevice) {
      // Show iOS-specific instructions after a delay
      const timer = setTimeout(() => setShowPrompt(true), 3000);
      return () => clearTimeout(timer);
    }

    // Listen for the beforeinstallprompt event (Android/Chrome)
    const handler = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
      setShowPrompt(true);
    };

    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  const handleInstall = async () => {
    if (!deferredPrompt) return;

    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;

    if (outcome === 'accepted') {
      setShowPrompt(false);
    }
    setDeferredPrompt(null);
  };

  const handleDismiss = () => {
    localStorage.setItem('pwa-prompt-dismissed', Date.now().toString());
    setShowPrompt(false);
  };

  if (!showPrompt) return null;

  return (
    <div
      style={{
        position: 'fixed',
        bottom: 0,
        left: 0,
        right: 0,
        padding: '16px 20px',
        backgroundColor: '#1e3a5f',
        color: 'white',
        zIndex: 9999,
        boxShadow: '0 -4px 20px rgba(0,0,0,0.15)',
      }}
    >
      <div style={{ maxWidth: 600, margin: '0 auto', display: 'flex', alignItems: 'center', gap: 16 }}>
        <div style={{ fontSize: 32 }}>📱</div>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 4 }}>
            Install Covrabl
          </div>
          {isIOS ? (
            <div style={{ fontSize: 13, opacity: 0.9 }}>
              Tap <span style={{ fontWeight: 600 }}>Share</span> then <span style={{ fontWeight: 600 }}>"Add to Home Screen"</span>
            </div>
          ) : (
            <div style={{ fontSize: 13, opacity: 0.9 }}>
              Get quick access from your home screen
            </div>
          )}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={handleDismiss}
            style={{
              padding: '8px 16px',
              backgroundColor: 'transparent',
              border: '1px solid rgba(255,255,255,0.3)',
              borderRadius: 6,
              color: 'white',
              cursor: 'pointer',
              fontSize: 13,
            }}
          >
            Later
          </button>
          {!isIOS && deferredPrompt && (
            <button
              onClick={handleInstall}
              style={{
                padding: '8px 16px',
                backgroundColor: 'white',
                border: 'none',
                borderRadius: 6,
                color: '#1e3a5f',
                cursor: 'pointer',
                fontWeight: 600,
                fontSize: 13,
              }}
            >
              Install
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
