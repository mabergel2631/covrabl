# covrabl.com — landing page draft

> Working draft for review. Once the copy lands, I cut it into `apps/web/src/app/page.tsx`. Every section below maps to a block on the page. Cuts in `[brackets]` are stage-direction notes for me — not part of the copy.

---

## SECTION 1 — Hero

**Headline:**

> Insurance relationships shouldn't disappear between renewals.

**Subhead:**

> Covrabl gives agencies the visibility, reviews, and outreach intelligence to stay genuinely engaged with their book — every week, not just at renewal.

**Primary CTA:** `Book a 15-minute demo`

**Secondary CTA:** `See the public demo →` (links to `demo@covrabl.com` self-serve account)

**Anchor screenshot** under the hero: the **This Week** feed on the agent dashboard, full-bleed. Caption underneath: *"What to talk to your book about this week — generated from real activity, not guesswork."*

> *Why this hero:* the headline is a problem agents recognize in one beat. "Between renewals" is the specific moment AMS/CRM go dark. The subhead names the three deliverables (visibility, reviews, outreach intelligence) and the cadence (weekly, not annual). No buzzwords.

---

## SECTION 2 — The two pillars

[Two-column block, equal weight. Each pillar has: title, one-line statement, three mechanism bullets, one screenshot.]

### Pillar 1 — Identify the conversation worth having

The right client. The right reason. The right week.

- **This Week feed** — surfaces renewals coming up, documents your clients just uploaded, share-link views, and clients who have gone quiet
- **No scoring, no judgment** — every row is a signal you decide what to do with
- **Built from real activity in your book** — not predictions, not models

[Screenshot: This Week feed close-up — 4-5 rows with severity color-coding]

### Pillar 2 — Have the conversation well

Show your work. Make it shareable. Make it land.

- **Coverage Reviews** — side-by-side year-over-year comparisons for renewal conversations
- **Quote Comparisons** — incumbent-vs-quote layouts with structured differences
- **Shareable summaries** — your client opens a clean read-only page; no login, no app to download

[Screenshot: a renewal review page with the year-over-year delta table]

> *Why two pillars not five:* every other benefit (retention, stickiness, modern client experience) is downstream of these two. Compressing to two makes the page memorable. People remember two things, not five.

---

## SECTION 3 — System of engagement, not record

[Header band, larger type, less margin so it reads as a manifesto-style break.]

> **Your AMS stores the policies.**
> **Your CRM stores the tasks.**
> **Covrabl tells you what to talk about this week.**

[Three-column comparison table beneath the manifesto:]

|                          | AMS  | CRM  | Covrabl |
|--------------------------|------|------|---------|
| Stores policies          | ✓    |      | (reads, doesn't store) |
| Tracks tasks & pipelines |      | ✓    |         |
| Surfaces policy changes year-over-year | | | ✓ |
| Tells you which client to call this week | | | ✓ |
| Lets clients see their own coverage | | | ✓ |
| Generates shareable renewal reviews | | | ✓ |

Caption underneath: *"AMS and CRM are systems of record. Covrabl is a system of engagement that sits on top of them — additive, not replacement."*

> *Why this section:* the "isn't this just a CRM?" objection will come up on every single sales call. Cut it off before it's asked. The table makes it visceral.

---

## SECTION 4 — A better experience for your clients

[Image-led section. Big screenshot of the consumer policy portal view.]

**Heading:**

> This is what your book sees.

**Body:**

> A clean, branded view of every policy you've shared with them. No ads. No quote spam. No "we noticed you might also be interested in life insurance." Just their coverage — organized, current, theirs to reference any time.

**Three benefits as a short list:**

- **Branded as your agency**, not Covrabl
- **No data sold, no marketing emails**, not now, not ever
- **Renewal reviews and quote comparisons land here too** — they see the conversation prep before the call

> *Why this section exists:* agencies evaluate Covrabl partly on what their *clients* will experience. Showing the consumer portal frame here positions consumer polish as part of the agency pitch — not a separate product. (This is what the ChatGPT pushback was right about.)

---

## SECTION 5 — Agency trust infrastructure

[Smaller, trust-anchor section. Plain layout. No screenshots — text + small icons.]

**Heading:**

> Built for the trust your book has in you.

**Body:**

> When you invite your clients into Covrabl, you're extending your agency's reputation. We treat that as the responsibility it is.

**Trust pillars (3 bullets):**

- **No data sold, no scraping, no ad networks.** Ever. We make money from agencies, not advertisers.
- **No carrier marketplace.** Covrabl will never quote against your business or resell client data to lead aggregators.
- **Encrypted at rest, audited access.** [Link to `/subprocessors` and `/privacy`]

Footnote: *"E&O comfort by design — see our [Privacy](/privacy) and [Subprocessors](/subprocessors) pages for the specifics."*

> *Why this isn't framed as consumer privacy:* agents take E&O liability when they invite their book to any tool. Privacy is the agency's risk-management feature, not the consumer's comfort blanket. Pitching it that way makes it part of the *agency value*, not a soft benefit.

---

## SECTION 6 — Pricing (visible, not gated)

**Heading:**

> Founding partner pricing — locked for the first 12 months.

[Two-card layout — left card highlighted.]

**Founding partner**
- **$59 / month per agent**
- Locks for 12 months
- Includes: every feature, unlimited clients, full coverage reviews, quote comparisons, This Week feed, audit log, data export
- Available to the first [N] agencies

**Add-ons**
- **White-label**: +$500 one-time setup (your logo, your colors, your domain on the client portal)
- **More than 5 agents**: we'll talk

[Two CTAs side by side]
- `Book a 15-minute demo`
- `Try the public demo →`

> *Why visible pricing:* gating pricing behind "Book a demo" reads enterprise. Founding-partner $59 is competitive and self-justifying — putting it on the page filters out the curious-but-not-real and qualifies the rest before the call.

---

## SECTION 7 — Footer CTA

[Wider band, single message.]

**Heading:**

> Stop guessing which client to call. Start knowing.

[Single CTA, primary]
- `Book a 15-minute demo with the founder`

[Subtle secondary, smaller]
- `Try the public demo with one click →` (auto-fills the demo credentials)

---

## Strings to retire from the current site

(Audit & remove on the same pass.)

- ~~Coverage Health Score~~ → **Coverage Readiness** (or **Coverage Overview**)
- ~~Coverage Gaps~~ → **Items to Review** / **Discussion Topics**
- ~~AI coverage analyzer~~ → **Coverage Reviews**
- ~~Gap detection engine~~ → *(remove entirely; the function stays, the phrase goes)*
- ~~Spot gaps before they cost you~~ → *(replace with "Stop surprises before the renewal call")*

> *Why:* every one of these phrases reads as AI-as-authority — which creates E&O exposure for the agent and signals "vendor that will replace me." Assistive-tone framing throughout.

---

## What this draft is NOT trying to do (yet)

- Conversion-optimize. Layout decisions (button colors, sticky nav, exit-intent modal) are downstream of the copy landing right.
- Talk to consumers as a separate audience. Consumer story is folded into Section 4 as part of the agency pitch.
- Cover every feature. Lease compliance, certificates, audit log — none of those are on the landing. They're features, not stories.
- Replace the deck. The deck and the landing serve different funnels (warm vs cold). The deck can go deeper; the landing has to land in 15 seconds.

---

## What I need from you to move to the page itself

1. **Headline gut check.** "Insurance relationships shouldn't disappear between renewals." — does this land or does it feel too soft?
2. **Pricing exposure.** Confirm you want $59 founding-partner visible on the page (vs gated).
3. **Founding-partner cap.** If you have a target like "first 25 agencies," that goes in the pricing card. If not, the section just says "founding partners."
4. **Demo CTA wiring.** Should "Book a 15-min demo" link to a Calendly, a typeform, or `mailto:`?
5. **Anything in this draft that's off-voice or wrong about the product.**
