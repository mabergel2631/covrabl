# Covrabl QA — Playwright suite

End-to-end browser tests covering the five core demo flows:

1. **Agent dashboard** — login + client list + horizontal-overflow check
2. **Client detail** — open a client + verify renewal / quote entry points
3. **Renewal Review** — seed a prior year + open the review + save summary + share + verify public page
4. **Quote Comparison** — pick a sibling policy + create comparison + save summary + share + verify public page
5. **Client portal** — log in as a seeded client + see policies

Each flow runs across three viewports (desktop 1440×900, tablet 768×1024, mobile 375×812) and captures screenshots to `screenshots/{viewport}/{step}.png`. Every page is checked for horizontal overflow — the most common scaling bug.

## When to run these tests

**Always run locally against `localhost:3000` — never against production by default.**

Each test run mutates the demo account state (saves summaries, generates share links). Running against `covrabl.com` repeatedly means real testers see "E2E test summary — automated check from the QA suite" on shared review pages. Avoid.

## How to run

### Prerequisites

- Node.js 18+
- The local Covrabl web + API running
- Playwright browsers installed (one-time): `cd e2e && npx playwright install chromium`

### Start the local stack

```powershell
# Terminal 1 — API
cd apps/api
.venv/Scripts/python.exe -m uvicorn main:app --reload --port 8000

# Terminal 2 — Seed the local demo data
cd apps/api
.venv/Scripts/python.exe -c "
from app.db import SessionLocal
from app.demo_seed import _do_seed
db = SessionLocal()
print(_do_seed(db))
db.close()
"

# Terminal 3 — Web (point at local API)
cd apps/web
$env:NEXT_PUBLIC_API_BASE = "http://localhost:8000"
npm run dev
```

### Run the tests

```powershell
cd e2e

# All viewports, all flows
npx playwright test

# Just one viewport
npx playwright test --project=desktop

# Just one flow
npx playwright test 03-renewal-review

# Headed (watch it run)
npx playwright test --headed

# Open the HTML report after
npx playwright show-report
```

### Run against production (rare)

```powershell
# Only when you intentionally want to QA the live demo
$env:E2E_BASE_URL = "https://covrabl.com"
npx playwright test
```

After running against prod, call `POST /admin/seed-demo?reset=true` to wipe the test-generated summaries and re-seed clean data.

## What to look for

- **Pass** — every flow reached its assertion checkpoints; no horizontal overflow
- **Fail** — a flow broke; check `playwright-report/index.html` for the trace + video
- **Skip** — a precondition wasn't met (no candidate policy for comparison, etc.); review whether the seed is providing the right data

Visual scaling check: open `screenshots/{viewport}/*.png` and verify nothing is clipped, overlapping, or stretched at each breakpoint.

## Future: Playwright MCP

For ad-hoc browser-driven QA in Claude Code sessions (drive the browser interactively rather than via pre-written tests), add `@playwright/mcp` to your Claude Code settings. One-time setup; lets Claude open pages, click, screenshot, and report findings on demand. Not needed for this suite.
