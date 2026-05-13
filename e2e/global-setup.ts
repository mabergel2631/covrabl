/**
 * Playwright globalSetup — fires once before any test runs.
 *
 * Calls the API's `/admin/seed-demo?reset=true` endpoint to wipe the demo
 * account (agent + 10 clients + all policies + PDFs + summaries + share links)
 * and re-seed it from scratch. This is what makes the suite re-runnable: each
 * test mutates demo state (saves summaries, generates share links), and
 * without this reset the second run would start in the dirty state the first
 * left behind.
 *
 * The reset endpoint is idempotent and only ever touches `demo@covrabl.com`.
 * It does not affect any other user.
 */
async function globalSetup() {
  if (process.env.E2E_SKIP_RESET === '1') {
    console.log('[globalSetup] E2E_SKIP_RESET=1 — skipping demo reset (use for specs that do not read demo data, e.g. marketing pages).');
    return;
  }

  const apiBase = resolveApiBase();
  const url = `${apiBase}/admin/seed-demo?reset=true`;

  // The reset endpoint is heavy (~30s — generates 42 PDFs, uploads to R2,
  // inserts 50+ rows). On a freshly-deployed Railway service the gateway can
  // 502 if workers are still warming. Retry on 5xx so transient failures
  // don't fail the entire suite.
  const maxAttempts = 4;
  const baseDelayMs = 15_000;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    console.log(`[globalSetup] Resetting demo account at ${url} (attempt ${attempt}/${maxAttempts})`);
    const t0 = Date.now();

    let resp: Response;
    let body: string;
    try {
      resp = await fetch(url, { method: 'POST' });
      body = await resp.text();
    } catch (err: any) {
      // Network error (Railway gateway dropped the connection mid-flight)
      if (attempt === maxAttempts) throw err;
      console.warn(`[globalSetup] Network error on attempt ${attempt}: ${err.message}; retrying in ${baseDelayMs / 1000}s`);
      await sleep(baseDelayMs);
      continue;
    }

    if (resp.ok) {
      const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
      console.log(`[globalSetup] Demo reseeded in ${elapsed}s — ${body}`);
      return;
    }

    // 4xx is a real failure (auth, bad request) — don't retry
    if (resp.status >= 400 && resp.status < 500) {
      throw new Error(
        `[globalSetup] Demo reset failed (non-retryable): ${resp.status} ${resp.statusText}\n${body}`
      );
    }

    // 5xx: retry with linear backoff
    if (attempt === maxAttempts) {
      throw new Error(
        `[globalSetup] Demo reset failed after ${maxAttempts} attempts: ${resp.status} ${resp.statusText}\n${body}`
      );
    }
    console.warn(`[globalSetup] ${resp.status} on attempt ${attempt}; retrying in ${baseDelayMs / 1000}s`);
    await sleep(baseDelayMs);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Pick the API base URL.
 *
 * Priority:
 *   1. E2E_API_BASE env var if set explicitly
 *   2. Derive from E2E_BASE_URL: localhost:3000 -> localhost:8000,
 *      covrabl.com -> covrabl-api.up.railway.app
 *   3. Fall back to the prod Railway URL
 */
function resolveApiBase(): string {
  const explicit = process.env.E2E_API_BASE;
  if (explicit) return explicit.replace(/\/$/, '');

  const webBase = (process.env.E2E_BASE_URL || 'https://covrabl.com').replace(/\/$/, '');

  if (webBase.includes('localhost') || webBase.includes('127.0.0.1')) {
    return 'http://127.0.0.1:8000';
  }
  return 'https://covrabl-api.up.railway.app';
}

export default globalSetup;
