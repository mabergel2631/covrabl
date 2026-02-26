/**
 * Initialize Capacitor native plugins.
 * Called once on app startup. Safe no-op on web.
 */

import { isNativeApp, isIOS } from './capacitor';

export async function initNativePlugins(): Promise<void> {
  if (!isNativeApp()) return;

  // Status bar
  try {
    const { StatusBar, Style } = await import('@capacitor/status-bar');
    await StatusBar.setStyle({ style: Style.Light });
    if (isIOS()) {
      await StatusBar.setOverlaysWebView({ overlay: true });
    }
  } catch {}

  // Splash screen — fallback hide in case auto-hide doesn't fire
  try {
    const { SplashScreen } = await import('@capacitor/splash-screen');
    setTimeout(() => SplashScreen.hide({ fadeOutDuration: 300 }), 3000);
  } catch {}

  // App lifecycle — deep links + Android back button
  try {
    const { App } = await import('@capacitor/app');

    App.addListener('appUrlOpen', (event) => {
      const url = new URL(event.url);
      const path = url.pathname;
      if (path) {
        window.location.href = path;
      }
    });

    App.addListener('backButton', () => {
      if (window.history.length > 1) {
        window.history.back();
      } else {
        App.exitApp();
      }
    });
  } catch {}
}
