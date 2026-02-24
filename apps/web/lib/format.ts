/**
 * Shared formatting utilities.
 */

/** Format a date string or Date as "Jan 15, 2026" */
export function formatDate(value: string | Date | null | undefined): string {
  if (!value) return '';
  const d = typeof value === 'string' ? new Date(value) : value;
  if (isNaN(d.getTime())) return String(value);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

/** Format a date string as relative: "3 days ago", "in 14 days", etc. */
export function formatRelativeDate(value: string | Date | null | undefined): string {
  if (!value) return '';
  const d = typeof value === 'string' ? new Date(value) : value;
  if (isNaN(d.getTime())) return '';
  const now = new Date();
  const diffMs = d.getTime() - now.getTime();
  const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));
  if (diffDays === 0) return 'today';
  if (diffDays === 1) return 'tomorrow';
  if (diffDays === -1) return 'yesterday';
  if (diffDays > 0) return `in ${diffDays} days`;
  return `${Math.abs(diffDays)} days ago`;
}

/** Format cents as "$1,234" */
export function formatCurrency(cents: number | null | undefined): string {
  if (cents == null) return '';
  return `$${cents.toLocaleString()}`;
}

/** Format a phone number for display as "(XXX) XXX-XXXX" */
export function formatPhone(value: string | null | undefined): string {
  if (!value) return '';
  const digits = value.replace(/\D/g, '');
  if (digits.length === 0) return value;
  if (digits.length === 11 && digits[0] === '1') {
    // Strip leading country code 1
    const d = digits.slice(1);
    return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6, 10)}`;
  }
  if (digits.length === 10) {
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6, 10)}`;
  }
  // Non-standard length — return as-is
  return value;
}

/** Strip a phone number to digits only for tel: hrefs */
export function cleanPhone(value: string): string {
  return value.replace(/[^\d+]/g, '');
}
