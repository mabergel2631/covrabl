/**
 * Capacitor platform detection utilities.
 *
 * When running inside a Capacitor native shell, window.Capacitor is defined.
 * All helpers are safe no-ops during SSR (typeof window === 'undefined').
 */

export function isNativeApp(): boolean {
  if (typeof window === 'undefined') return false;
  return !!(window as any).Capacitor?.isNativePlatform?.();
}

export function isIOS(): boolean {
  if (typeof window === 'undefined') return false;
  return (window as any).Capacitor?.getPlatform?.() === 'ios';
}

export function isAndroid(): boolean {
  if (typeof window === 'undefined') return false;
  return (window as any).Capacitor?.getPlatform?.() === 'android';
}
