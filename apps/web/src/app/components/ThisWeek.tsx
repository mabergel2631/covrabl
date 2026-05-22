'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { agentApi, ThisWeekItem } from '../../../lib/api';
import { trackClick } from '../../../lib/track';

const CATEGORY_LABELS: Record<ThisWeekItem['category'], string> = {
  renewal: 'Renewal',
  upload: 'New document',
  share_view: 'Active engagement',
  stalled: 'Re-engage',
};

const CATEGORY_BADGE: Record<ThisWeekItem['category'], { bg: string; fg: string }> = {
  renewal: { bg: '#fef3c7', fg: '#92400e' },
  upload: { bg: '#dbeafe', fg: '#1e40af' },
  share_view: { bg: '#dcfce7', fg: '#166534' },
  stalled: { bg: '#f3f4f6', fg: '#6b7280' },
};

const SEVERITY_DOT: Record<ThisWeekItem['severity'], string> = {
  high: '#dc2626',
  medium: '#f59e0b',
  low: '#94a3b8',
};

export default function ThisWeek() {
  const router = useRouter();
  const [items, setItems] = useState<ThisWeekItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await agentApi.thisWeek();
        if (!cancelled) setItems(data);
      } catch (e: any) {
        if (!cancelled) setError(e?.message || 'Could not load outreach feed');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Hide entirely when there's nothing to show — don't add empty-state noise
  if (loading) return null;
  if (error) return null;
  if (items.length === 0) return null;

  return (
    <div style={{ marginBottom: 24 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 8 }}>
        <h2 style={{ fontSize: 17, fontWeight: 700, margin: 0, color: 'var(--color-text)' }}>This Week</h2>
        <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>
          {items.length} client{items.length === 1 ? '' : 's'} worth a touch
        </span>
      </div>
      <p style={{ fontSize: 12, color: 'var(--color-text-muted)', margin: '0 0 12px', lineHeight: 1.5 }}>
        Items come from real activity on your book — upcoming renewals, recent client uploads, share-link views, stalled accounts. No predictive scoring.
      </p>
      <div
        data-testid="this-week-feed"
        style={{
          border: '1px solid var(--color-border)',
          borderRadius: 'var(--radius-md)',
          overflow: 'hidden',
          backgroundColor: 'var(--color-surface)',
        }}
      >
        {items.map((item, i) => {
          const badge = CATEGORY_BADGE[item.category];
          // For renewals with a stage, the stage label + color replace the
          // generic category badge so the planning vs. binding distinction
          // is visible at a glance.
          const isRenewalWithStage = item.category === 'renewal' && !!item.stage;
          const displayLabel = isRenewalWithStage
            ? (item.stage_label || CATEGORY_LABELS[item.category])
            : CATEGORY_LABELS[item.category];
          const bandColor = isRenewalWithStage ? item.stage_color : undefined;

          return (
            <div
              key={`${item.client_id}-${i}`}
              data-testid="this-week-row"
              data-category={item.category}
              data-stage={item.stage || ''}
              data-stage-color={item.stage_color || ''}
              onClick={() => {
                trackClick('this_week_row', { client_id: item.client_id, category: item.category, stage: item.stage });
                router.push(`/agent/${item.client_id}`);
              }}
              style={{
                display: 'grid',
                gridTemplateColumns: 'auto 1fr auto',
                alignItems: 'center',
                gap: 16,
                padding: '14px 16px',
                borderTop: i === 0 ? 'none' : '1px solid var(--color-border)',
                // Left band carries the renewal stage color when present.
                // Falls back to no band so non-renewal rows stay visually quiet.
                borderLeft: bandColor ? `4px solid ${bandColor}` : '4px solid transparent',
                cursor: 'pointer',
                transition: 'background-color 0.15s',
              }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--color-bg)'; }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.backgroundColor = ''; }}
            >
              {/* Severity dot */}
              <div style={{
                width: 8, height: 8, borderRadius: '50%',
                backgroundColor: SEVERITY_DOT[item.severity],
                flexShrink: 0,
              }} title={`${item.severity} priority`} />

              {/* Client + reason */}
              <div style={{ minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-text)' }}>
                    {item.client_name || item.client_email || `Client #${item.client_id}`}
                  </span>
                  <span style={{
                    padding: '1px 8px', borderRadius: 10, fontSize: 10, fontWeight: 600,
                    backgroundColor: isRenewalWithStage ? `${bandColor}22` : badge.bg,
                    color: isRenewalWithStage ? '#1f2937' : badge.fg,
                    border: isRenewalWithStage ? `1px solid ${bandColor}66` : 'none',
                  }}>
                    {displayLabel}
                  </span>
                </div>
                <div style={{ fontSize: 13, color: 'var(--color-text-secondary)', lineHeight: 1.4 }}>
                  {item.reason}
                </div>
              </div>

              {/* Suggested action — chevron-style hint */}
              <div style={{ textAlign: 'right', flexShrink: 0 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-primary)' }}>
                  {item.suggested_action}
                </div>
                <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 2 }}>
                  Open client →
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
