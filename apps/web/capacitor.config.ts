import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.covrabl.app',
  appName: 'Covrabl',
  webDir: 'out',
  server: {
    url: 'https://covrabl.com',
    cleartext: false,
    allowNavigation: [
      'covrabl.com',
      'covrabl-api.up.railway.app',
      'plausible.io',
    ],
  },
  ios: {
    scheme: 'Covrabl',
    contentInset: 'automatic',
    backgroundColor: '#0f1f33',
    preferredContentMode: 'mobile',
    allowsLinkPreview: false,
  },
  android: {
    backgroundColor: '#0f1f33',
    allowMixedContent: false,
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 2000,
      launchAutoHide: true,
      backgroundColor: '#0f1f33',
      showSpinner: false,
      launchFadeOutDuration: 300,
    },
    StatusBar: {
      style: 'LIGHT',
      backgroundColor: '#152b47',
    },
    Keyboard: {
      resize: 'body',
      resizeOnFullScreen: true,
    },
  },
};

export default config;
