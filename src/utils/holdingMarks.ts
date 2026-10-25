import type { CSSProperties } from 'react';
import { COSMETIC_MAP, type Cosmetic } from '../constants/cosmetics';
import { STANDARD_MARK_ID } from '../constants/cosmeticsProfile';
import { COSMETIC_COLOR_STYLES } from '../rules/cosmetics';
import { cohortLots } from '../characters';
import type { ShortPosition, UserData } from '../types';

// Holding marks: how the stocks a player owns or shorts look on their own
// screen. Only the wearer ever sees one, so this reads the player's own user
// doc directly; nothing here is published.

export interface HoldingMark {
  cosmetic: Cosmetic;
  /** The mark's color: the player's pick for a color mark, else the item's own. */
  color: string;
}

/** The mark this player wears: an owned or free one, else Standard. */
export const resolveHoldingMark = (userData: UserData | null | undefined): HoldingMark => {
  const id = userData?.activeCosmetics?.holdingMark;
  const picked = id ? COSMETIC_MAP[id] : undefined;
  const wearable =
    picked?.type === 'holdingMark' && (picked.free || (userData?.ownedCosmetics || []).includes(picked.id));
  const cosmetic = wearable ? picked! : COSMETIC_MAP[STANDARD_MARK_ID]!;
  const custom = userData?.cosmeticStyle?.markColor;
  const color =
    cosmetic.pickColor && typeof custom === 'string' && COSMETIC_COLOR_STYLES.markColor.test(custom)
      ? custom
      : cosmetic.color;
  return { cosmetic, color };
};

export interface Position {
  kind: 'long' | 'short';
  shares: number;
  /** Average cost (long) or entry price (short), 0 when unknown. */
  cost: number;
  /** How much the position is up, in percent, or null when the cost is unknown. */
  gainPct: number | null;
  /** Days since the oldest shares still held were bought, or the short opened. */
  heldDays: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const stampMs = (v: unknown) =>
  typeof v === 'number' ? v : ((v as { toMillis?: () => number } | null)?.toMillis?.() ?? 0);

/** The player's position in a stock, as the marks need it, or null when they hold none. */
export const positionOf = (
  userData: UserData | null | undefined,
  ticker: string,
  price: number,
  shortPosition?: ShortPosition | null,
  now = Date.now(),
): Position | null => {
  const shares = userData?.holdings?.[ticker] || 0;
  if (shares > 0.001) {
    const cost = userData?.costBasis?.[ticker] || 0;
    const lots = cohortLots(userData?.holdingCohorts?.[ticker], now);
    const oldest = lots.length ? Math.max(...lots.map((l) => l.ageMs)) : 0;
    return {
      kind: 'long',
      shares,
      cost,
      gainPct: cost > 0 && price > 0 ? (price / cost - 1) * 100 : null,
      heldDays: oldest / DAY_MS,
    };
  }
  const short = shortPosition ?? userData?.shorts?.[ticker];
  if (short && short.shares > 0) {
    const cost = short.costBasis || short.entryPrice || 0;
    const opened = stampMs((short as { openedAt?: unknown }).openedAt);
    return {
      kind: 'short',
      shares: short.shares,
      cost,
      gainPct: cost > 0 && price > 0 ? (1 - price / cost) * 100 : null,
      heldDays: opened ? (now - opened) / DAY_MS : 0,
    };
  }
  return null;
};

/** Diamond Hands: how many facets are lit (1 day, 7 days, 30 days). */
export const litFacets = (heldDays: number) => (heldDays >= 30 ? 3 : heldDays >= 7 ? 2 : heldDays >= 1 ? 1 : 0);

const hexToRgb = (hex: string) => {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const mix = (hex: string, toward: number, amount: number) =>
  `rgb(${hexToRgb(hex)
    .map((c) => Math.round(c + (toward - c) * amount))
    .join(' ')})`;

/**
 * The class and CSS variables a card wearing this mark needs. Standard on a
 * short keeps the orange ring that has always meant "short".
 */
export const markCardProps = (mark: HoldingMark, pos: Position): { className: string; style: CSSProperties } => {
  const effect = mark.cosmetic.effectClass || 'mk-standard';
  const color = effect === 'mk-standard' && pos.kind === 'short' ? '#f97316' : mark.color;
  // Standard is the Tailwind ring the cards always had, so it sits with the
  // rarity frame's shadow the way it always did.
  const vars: Record<string, string> = {
    '--mk': color,
    ...(effect === 'mk-standard' ? { '--tw-ring-color': color } : {}),
  };
  if (effect === 'mk-ember') {
    vars['--mk-deep'] = mix(color, 0, 0.6);
    vars['--mk-hot'] = mix(color, 255, 0.7);
  }
  if (effect === 'mk-aura') {
    const g = pos.gainPct ?? 0;
    const strength = Math.min(1, Math.abs(g) / 15);
    vars['--mk-aura'] = `rgb(${g >= 0 ? '34 197 94' : '239 68 68'} / ${(0.1 + strength * 0.28).toFixed(2)})`;
    vars['--mk'] = g >= 0 ? '#4ade80' : '#f87171';
  }
  const ring = effect === 'mk-standard' ? ' ring-1' : '';
  return { className: `mk ${effect}${ring}${pos.kind === 'short' ? ' mk-short' : ''}`, style: vars as CSSProperties };
};

/** The receipt line: shares, average cost (or entry) and gain. */
export const receiptText = (pos: Position, fmtShares: (n: number) => string) => {
  const gain = pos.gainPct == null ? '' : `   ${pos.gainPct >= 0 ? '+' : ''}${pos.gainPct.toFixed(1)}%`;
  const cost = pos.cost > 0 ? `   ${pos.kind === 'short' ? 'entry' : 'avg'} $${pos.cost.toFixed(2)}` : '';
  return `${fmtShares(pos.shares)} sh${pos.kind === 'short' ? ' short' : ''}${cost}${gain}`;
};
