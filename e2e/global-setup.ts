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
  const apiBase = resolveApiBase();
  const url = `${apiBase}/admin/seed-demo?reset=true`;

  console.log(`[globalSetup] Resetting demo account at ${url}`);
  const t0 = Date.now();

  const resp = await fetch(url, { method: 'POST' });
  const body = await resp.text();

  if (!resp.ok) {
    throw new Error(
      `[globalSetup] Demo reset failed: ${resp.status} ${resp.statusText}\n${body}`
    );
  }

  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`[globalSetup] Demo reseeded in ${elapsed}s — ${body}`);
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
