// The bot engine's decisions, kept free of Firestore so every rule is testable.
//
// INTERNAL MODULE: required by botTrader.ts and marketMaker.ts, deliberately
// absent from services.ts. It exports no Cloud Functions.
//
// Three jobs:
//
// 1. STORYLINES. Every character carries a hidden phase (calm, slow climb, slow
//    slide, choppy, the odd big day) lasting days to weeks, so long charts get
//    shape instead of a flat line or a constant zigzag. Climbs and slides lean
//    against what the bots have already moved the stock, so over time the bots
//    add texture and never a trend: a player who spots a climb is betting on a
//    phase that can end at any time and is being pulled back.
//
// 2. NEGLECT. A stock no player has traded for 14 days slides toward its hidden
//    floor through slides, flat patches and small bounces, about 0.8% a day on
//    average. This replaced a flat 1% step every day, which drew a ruler-straight
//    ramp. The floor and the short-interest pause are unchanged.
//
// 3. THE GUARD. When accounts the admin confirmed as manipulators push a stock,
//    the bot pushes it back, but only in the direction that costs them money
//    given what they hold right now. A plain "put the price back" would pay
//    whoever bought the bottom of their dump.

const DAY = 86_400_000;

export type Phase = 'calm' | 'climb' | 'slide' | 'choppy' | 'big_day' | 'n_slide' | 'n_flat' | 'n_bounce' | 'hold';

/**
 * - normal: an ordinary stock, gets a storyline.
 * - neglected: untraded for the neglect window, free to slide.
 * - neglected_still: untraded but frozen (short interest, at its floor, or a
 *   stale short-interest reading), so only flat wiggles.
 * - held: the admin set its price inside the protection window. Bots keep it
 *   busy with small wiggles that never drift away from the admin's price.
 */
export type Kind = 'normal' | 'neglected' | 'neglected_still' | 'held';

export interface Storyline {
  phase: Phase;
  /** Fraction per day. */
  drift: number;
  /** Noise per move, as a fraction. */
  vol: number;
  until: number;
  /** Net log move the bots have made on this stock through ordinary storylines. */
  botDrift: number;
  /** Net bot move since the admin's price was set (hold phase only). */
  holdDrift: number;
  /** Timestamp of the admin price point a hold belongs to. */
  holdFrom: number | null;
  /** After a big day, the direction the next phase leans to give some back. */
  retrace: 1 | -1 | null;
  lastMoveAt: number;
  /** UTC day the counters below belong to. */
  day: string;
  moves: number;
  /** Sum of |move| today. */
  impact: number;
}

// Each phase: pick weight, drift per day, noise per move, length in days.
interface Row {
  phase: Phase;
  w: number;
  drift: [number, number];
  vol: [number, number];
  days: [number, number];
}

export const NORMAL_ROWS: Row[] = [
  { phase: 'calm', w: 35, drift: [0, 0], vol: [0.002, 0.005], days: [3, 10] },
  { phase: 'climb', w: 22, drift: [0.003, 0.008], vol: [0.003, 0.006], days: [4, 14] },
  { phase: 'slide', w: 22, drift: [-0.008, -0.003], vol: [0.003, 0.006], days: [4, 14] },
  { phase: 'choppy', w: 15, drift: [0, 0], vol: [0.008, 0.014], days: [2, 6] },
  // Direction is picked separately.
  { phase: 'big_day', w: 6, drift: [0.02, 0.04], vol: [0.003, 0.005], days: [1, 1] },
];

// Averages about -0.8% a day: (0.55 * -1.275% * 6.5d + 0.15 * 0.85% * 2.5d) / 5.3d.
export const NEGLECT_ROWS: Row[] = [
  { phase: 'n_slide', w: 55, drift: [-0.016, -0.0095], vol: [0.003, 0.006], days: [3, 10] },
  { phase: 'n_flat', w: 30, drift: [0, 0], vol: [0.002, 0.004], days: [2, 7] },
  { phase: 'n_bounce', w: 15, drift: [0.005, 0.012], vol: [0.003, 0.006], days: [1, 4] },
];

const STILL_ROW: Row = { phase: 'n_flat', w: 1, drift: [0, 0], vol: [0.002, 0.004], days: [1, 2] };
const HOLD_ROW: Row = { phase: 'hold', w: 1, drift: [0, 0], vol: [0.004, 0.007], days: [1, 1] };

/** Past this net move the bots stop pushing a stock further the same way. */
export const BOT_DRIFT_LIMIT = 0.35;
/** Bot wiggles on an admin-set price stay within this of it. */
export const HOLD_BAND = 0.015;
/** One bot move never exceeds this, far under the 5% trade cap and the breaker. */
export const MAX_STEP = 0.025;
export const MAX_MOVES_PER_DAY = 8;
// Admin-set stocks get few points a day on purpose. The live chart doc keeps 60
// points per stock, and the admin's own point is what protects the price for
// 7 days: bot points must never push it out of that window.
export const HELD_MAX_MOVES_PER_DAY = 3;
export const BOT_DAILY_IMPACT = 0.06;

const PICK_WEIGHT: Record<Kind, number> = { held: 3, normal: 1, neglected: 0.8, neglected_still: 0.5 };

export const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const between = (rng: () => number, [lo, hi]: [number, number]) => lo + (hi - lo) * rng();
export const utcDayOf = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** Standard normal draw (Box-Muller). */
export const gauss = (rng: () => number) => {
  const u = Math.max(1e-9, rng());
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng());
};

const weighted = <T extends { w: number }>(rows: T[], rng: () => number): T => {
  const total = rows.reduce((s, r) => s + r.w, 0);
  let roll = rng() * total;
  for (const r of rows) {
    roll -= r.w;
    if (roll <= 0) return r;
  }
  return rows[rows.length - 1]!;
};

const blank = (now: number): Storyline => ({
  phase: 'calm',
  drift: 0,
  vol: 0.003,
  until: 0,
  botDrift: 0,
  holdDrift: 0,
  holdFrom: null,
  retrace: null,
  lastMoveAt: now - DAY / 4,
  day: utcDayOf(now),
  moves: 0,
  impact: 0,
});

/** Fills missing fields of a saved storyline and resets the daily counters. */
export const normalizeStoryline = (saved: Partial<Storyline> | null | undefined, now: number): Storyline => {
  const s = { ...blank(now), ...(saved || {}) } as Storyline;
  const today = utcDayOf(now);
  if (s.day !== today) Object.assign(s, { day: today, moves: 0, impact: 0 });
  return s;
};

const phaseFits = (phase: Phase, kind: Kind) => {
  if (kind === 'held') return phase === 'hold';
  if (kind === 'neglected') return phase === 'n_slide' || phase === 'n_flat' || phase === 'n_bounce';
  if (kind === 'neglected_still') return phase === 'n_flat';
  return !phase.startsWith('n_') && phase !== 'hold';
};

/** Does this stock need a fresh phase now? */
export const needsNewPhase = (s: Storyline, kind: Kind, now: number, holdFrom: number | null) =>
  now >= s.until || !phaseFits(s.phase, kind) || (kind === 'held' && s.holdFrom !== holdFrom);

/** Pick the next phase. Keeps the running totals; returns a new object. */
export const pickPhase = (
  s: Storyline,
  kind: Kind,
  now: number,
  rng: () => number,
  holdFrom: number | null = null,
): Storyline => {
  const next: Storyline = { ...s };
  let row: Row;
  let sign = 1;

  if (kind === 'held') {
    row = HOLD_ROW;
    if (s.holdFrom !== holdFrom) next.holdDrift = 0;
    next.holdFrom = holdFrom;
  } else if (kind === 'neglected') {
    row = weighted(NEGLECT_ROWS, rng);
  } else if (kind === 'neglected_still') {
    row = STILL_ROW;
  } else if (s.retrace && rng() < 0.5) {
    // Give some of a big day back.
    const base = NORMAL_ROWS.find((r) => r.phase === (s.retrace === 1 ? 'climb' : 'slide'))!;
    row = { ...base, days: [2, 5] };
  } else {
    // Lean against what the bots have already done to this stock, so their net
    // effect drifts back toward zero instead of wandering off.
    const tilt = clamp(s.botDrift / 0.3, -1, 1);
    const rows = NORMAL_ROWS.map((r) =>
      r.phase === 'climb' ? { ...r, w: r.w * (1 - tilt) } : r.phase === 'slide' ? { ...r, w: r.w * (1 + tilt) } : r,
    );
    row = weighted(rows, rng);
    if (row.phase === 'big_day') sign = rng() < (1 + tilt) / 2 ? -1 : 1;
  }

  next.phase = row.phase;
  next.drift = between(rng, row.drift) * sign;
  next.vol = between(rng, row.vol);
  next.until = now + between(rng, row.days) * DAY;
  next.retrace =
    row.phase === 'big_day' ? (sign > 0 ? -1 : 1) : row.phase === 'climb' || row.phase === 'slide' ? null : s.retrace;
  if (kind !== 'held') next.holdFrom = null;
  return next;
};

/**
 * The fraction one bot move shifts the price by. `floor` is the stock's hidden
 * neglect floor, which a neglected stock never slides below.
 */
export const stepMove = (
  s: Storyline,
  kind: Kind,
  price: number,
  now: number,
  rng: () => number,
  floor: number | null = null,
) => {
  let move: number;
  if (kind === 'held') {
    // Zero-mean wiggle that pulls the bots' own net move back toward the
    // admin's price. Player trades are never fought: only the bots' share is.
    move = gauss(rng) * s.vol - s.holdDrift * 0.5;
    move = clamp(move, -HOLD_BAND - s.holdDrift, HOLD_BAND - s.holdDrift);
  } else {
    const elapsed = clamp((now - s.lastMoveAt) / DAY, 0, 1);
    move = s.drift * elapsed + gauss(rng) * s.vol;
  }

  if (kind === 'normal') {
    const lo = Math.exp(-BOT_DRIFT_LIMIT - s.botDrift) - 1;
    const hi = Math.exp(BOT_DRIFT_LIMIT - s.botDrift) - 1;
    move = clamp(move, Math.min(0, lo), Math.max(0, hi));
  }

  if ((kind === 'neglected' || kind === 'neglected_still') && floor && move < 0 && price * (1 + move) < floor) {
    move = Math.min(0, floor / price - 1);
  }

  return clamp(move, -MAX_STEP, MAX_STEP);
};

/** Fold an applied move into the stock's running totals. */
export const recordMove = (s: Storyline, kind: Kind, applied: number, now: number): Storyline => ({
  ...s,
  botDrift: kind === 'normal' ? s.botDrift + Math.log(1 + applied) : s.botDrift,
  holdDrift: kind === 'held' ? s.holdDrift + applied : s.holdDrift,
  lastMoveAt: now,
  moves: s.moves + 1,
  impact: s.impact + Math.abs(applied),
});

/** May the bots move this stock again today? */
export const underDailyCap = (s: Storyline, kind: Kind) =>
  s.moves < (kind === 'held' ? HELD_MAX_MOVES_PER_DAY : MAX_MOVES_PER_DAY) && s.impact < BOT_DAILY_IMPACT;

/**
 * How many stocks one run moves. More when players are trading (`activeTickers`
 * = stocks a player traded in the last two hours) and right after the Thursday
 * reopen.
 */
export const movesForRun = (activeTickers: number, afterReopen: boolean, rng: () => number) => {
  const busy = 1 + Math.min(1, activeTickers / 10);
  return Math.max(1, Math.round(5 * busy * (afterReopen ? 1.5 : 1) * (0.7 + 0.6 * rng())));
};

/** Weighted pick of `n` distinct stocks. */
export const chooseTickers = (cands: { ticker: string; kind: Kind }[], n: number, rng: () => number) => {
  const pool = cands.map((c) => ({ ...c, w: PICK_WEIGHT[c.kind] }));
  const out: string[] = [];
  while (out.length < n && pool.length) {
    const hit = weighted(pool, rng);
    out.push(hit.ticker);
    pool.splice(pool.indexOf(hit), 1);
  }
  return out;
};

/** The newest admin price point inside the protection window, if any. */
export const lastAdminPoint = (
  hist: { timestamp: number; price: number; source?: string }[] | undefined,
  windowMs: number,
  now: number,
) => {
  const list = hist || [];
  for (let i = list.length - 1; i >= 0; i--) {
    const p = list[i];
    if (!p || p.timestamp < now - windowMs) break;
    if (p.source === 'admin_adjust') return p;
  }
  return null;
};

// ---------------------------------------------------------------------------
// The guard
// ---------------------------------------------------------------------------

export interface GroupTrade {
  uid: string;
  ticker: string;
  action: string;
  amount: number;
  price: number;
  ts: number;
}

/** How far back the guard looks for a push. */
export const GUARD_WINDOW_MS = 3 * 60 * 60 * 1000;
/** A push smaller than this is left alone. */
export const GUARD_MIN_MOVE = 0.03;
/** One run never moves a stock further than this. */
export const GUARD_MAX_STEP = 0.03;

const flowSign = (action: string) =>
  action === 'buy' || action === 'cover' ? 1 : action === 'sell' || action === 'short' ? -1 : 0;

/** Net shares bought (+) or sold and shorted (-) per stock. */
export const netFlowByTicker = (trades: GroupTrade[]) => {
  const out: Record<string, number> = {};
  for (const t of trades) out[t.ticker] = (out[t.ticker] || 0) + flowSign(t.action) * (t.amount || 0);
  return out;
};

/**
 * The guard's answer for one stock: the fraction to move it now, or null.
 *
 * - They pumped it and still hold it: push it back down.
 * - They dumped it to profit from shorts: lift it.
 * - Anything else (they pumped and already sold, or they dumped and the group
 *   bought the bottom): leave it, because moving it would pay them.
 *
 * `trades` are the group's trades on this stock inside the window. `exposure`
 * is the group's shares held minus shares short, right now. `othersOpposite`
 * is shares other players opened in the window that would profit from the
 * reversal (shorts for a push down, buys for a lift). If that is large, the
 * reversal would mostly pay them, possibly an unconfirmed partner, so the
 * guard stands aside and leaves it to the hourly stabilizer.
 */
export const guardMove = ({
  trades,
  price,
  exposure,
  othersOpposite,
}: {
  trades: GroupTrade[];
  price: number;
  exposure: number;
  othersOpposite: number;
}): { move: number; reason: string } | null => {
  if (!trades.length || !(price > 0)) return null;
  const sorted = [...trades].sort((a, b) => a.ts - b.ts);
  const startPrice = sorted[0]!.price;
  if (!(startPrice > 0)) return null;
  const flow = sorted.reduce((s, t) => s + flowSign(t.action) * (t.amount || 0), 0);
  const moved = (price - startPrice) / startPrice;
  if (Math.abs(moved) < GUARD_MIN_MOVE || !flow || Math.sign(moved) !== Math.sign(flow)) return null;

  const pumped = moved > 0;
  // Reversing only costs them if they are still on the side they pushed.
  if (pumped ? exposure <= 0 : exposure >= 0) return null;
  if (othersOpposite >= 0.5 * Math.abs(exposure)) return null;

  const strength = Math.min(1, Math.abs(exposure) / Math.abs(flow));
  const target = startPrice * (1 + moved * (1 - strength));
  const move = clamp(target / price - 1, -GUARD_MAX_STEP, GUARD_MAX_STEP);
  if (Math.abs(move) < 0.002) return null;
  return { move, reason: pumped ? 'pumped and still holding' : 'dumped while short' };
};

/**
 * Should the hourly stabilizer skip this stock? It pulls a price back toward
 * its weekly average, and that would hand profit to confirmed manipulators who
 * bought the bottom of a drop (lift) or shorted the top of a rise (push down).
 * `flow` is their net shares over the week, `exposure` what they hold now.
 */
export const stabilizerShouldSkip = (isSell: boolean, flow: number, exposure: number) =>
  isSell ? flow < 0 && exposure < 0 : flow > 0 && exposure > 0;

export { DAY as BOT_DAY_MS };
