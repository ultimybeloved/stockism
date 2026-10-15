// Number and time formatting for the admin command panel. Times are UTC,
// 24-hour, everywhere in the panel.
import type { TimestampLike } from '../../../types';

const usd0 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
const usd2 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 });

/** "$12,345" (no cents). */
export const money = (n: unknown) => usd0.format(Number(n) || 0);
/** "$12,345.67". */
export const money2 = (n: unknown) => usd2.format(Number(n) || 0);
/** "+$1,200" / "-$300". */
export const signedMoney = (n: unknown) => {
  const v = Number(n) || 0;
  return `${v > 0 ? '+' : v < 0 ? '-' : ''}${usd0.format(Math.abs(v))}`;
};
/** "$1.2M", "$840K", "$950". */
export const compact = (n: unknown) => {
  const v = Number(n) || 0;
  const a = Math.abs(v);
  const s = v < 0 ? '-' : '';
  if (a >= 1e6) return `${s}$${(a / 1e6).toFixed(a >= 1e7 ? 1 : 2)}M`;
  if (a >= 1e4) return `${s}$${Math.round(a / 1e3)}K`;
  if (a >= 1e3) return `${s}$${(a / 1e3).toFixed(1)}K`;
  return `${s}$${Math.round(a)}`;
};
export const int = (n: unknown) => (Number(n) || 0).toLocaleString('en-US');
export const pct = (n: unknown, digits = 1) => {
  const v = Number(n) || 0;
  return `${v > 0 ? '+' : ''}${v.toFixed(digits)}%`;
};

/** Milliseconds from any stored time shape (number, Timestamp, {seconds}). */
export function ms(v: TimestampLike | unknown): number | null {
  if (v == null) return null;
  if (typeof v === 'number') return v;
  if (typeof v === 'string') return Date.parse(v) || null;
  const o = v as { toMillis?: () => number; seconds?: number; _seconds?: number };
  if (typeof o.toMillis === 'function') return o.toMillis();
  if (typeof o.seconds === 'number') return o.seconds * 1000;
  if (typeof o._seconds === 'number') return o._seconds * 1000;
  return null;
}

/** "2026-10-14 21:30" UTC. */
export const utc = (v: unknown) => {
  const m = ms(v);
  return m ? new Date(m).toISOString().slice(0, 16).replace('T', ' ') : '-';
};
/** "2026-10-14" UTC. */
export const utcDate = (v: unknown) => {
  const m = ms(v);
  return m ? new Date(m).toISOString().slice(0, 10) : '-';
};

/** "4m", "3h", "12d", "5mo" ago. */
export const ago = (v: unknown, now = Date.now()) => {
  const m = ms(v);
  if (!m) return '-';
  const s = Math.max(0, (now - m) / 1000);
  if (s < 60) return 'now';
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  if (s < 86400 * 60) return `${Math.floor(s / 86400)}d`;
  return `${Math.floor(s / (86400 * 30))}mo`;
};
