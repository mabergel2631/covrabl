/**
 * Mirror of the renewal-stage labels and colors defined in
 * apps/api/app/renewal_config.py. Kept in sync by convention — if you
 * change one, change both.
 *
 * Stage slugs are the canonical key. The server emits the slug on each
 * This Week renewal row; the UI looks up the label and color here.
 */

export type RenewalStage =
  | 'upcoming_review'
  | 'client_discussion'
  | 'market_active'
  | 'finalization';

export const STAGE_LABELS: Record<RenewalStage, string> = {
  upcoming_review: 'Upcoming Review',
  client_discussion: 'Client Discussion',
  market_active: 'Market Active',
  finalization: 'Finalization',
};

/**
 * Muted color gradient. Soft red only at the very end so the feed doesn't
 * become anxiety software. These hexes must match STAGE_COLORS in
 * apps/api/app/renewal_config.py.
 */
export const STAGE_COLORS: Record<RenewalStage, string> = {
  upcoming_review: '#a7c4a0',   // muted green
  client_discussion: '#e8b86d', // amber
  market_active: '#e08d52',     // orange
  finalization: '#d97366',      // soft red (intentionally not pure red)
};
