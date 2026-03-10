/**
 * Lightweight batched event tracker — fire-and-forget, never blocks UI.
 */

import { API_BASE } from './api';

const BATCH_INTERVAL = 5000; // flush every 5s
const MAX_BATCH_SIZE = 20;

type TrackEvent = {
  event_name: string;
  event_category?: string;
  properties?: Record<string, unknown>;
  page_path?: string;
  session_id?: string;
};

let queue: TrackEvent[] = [];
let sessionId: string | null = null;
let flushTimer: ReturnType<typeof setTimeout> | null = null;

function getSessionId(): string {
  if (!sessionId) {
    if (typeof sessionStorage !== 'undefined') {
      sessionId = sessionStorage.getItem('pv_session_id');
    }
    if (!sessionId) {
      sessionId = crypto.randomUUID();
      if (typeof sessionStorage !== 'undefined') {
        sessionStorage.setItem('pv_session_id', sessionId);
      }
    }
  }
  return sessionId;
}

export function track(eventName: string, category?: string, properties?: Record<string, unknown>) {
  if (typeof window === 'undefined') return; // SSR guard
  const event: TrackEvent = {
    event_name: eventName,
    event_category: category,
    properties,
    page_path: window.location.pathname,
    session_id: getSessionId(),
  };
  queue.push(event);

  if (queue.length >= MAX_BATCH_SIZE) {
    flush();
  } else if (!flushTimer) {
    flushTimer = setTimeout(flush, BATCH_INTERVAL);
  }
}

function flush() {
  if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
  if (queue.length === 0) return;

  const batch = queue.splice(0, MAX_BATCH_SIZE);
  const token = typeof localStorage !== 'undefined' ? localStorage.getItem('pv_token') : null;
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  fetch(`${API_BASE}/events/track`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ events: batch }),
    keepalive: true,
  }).catch(() => {}); // silently swallow errors
}

// Flush on page unload / tab hide
if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', flush);
  window.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flush();
  });
}

// ── Convenience helpers ──

export function trackPageView(pageName?: string) {
  track('page_view', 'navigation', { page_name: pageName });
}

export function trackClick(element: string, context?: Record<string, unknown>) {
  track('button_click', 'interaction', { element, ...context });
}

export function trackFeatureUse(feature: string, details?: Record<string, unknown>) {
  track('feature_use', 'engagement', { feature, ...details });
}
