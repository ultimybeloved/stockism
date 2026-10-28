// GENERATED from src/rules/shop.ts by `npm run sync:chars`. Do not edit.
// Cosmetic shop deals: bundles and the weekly featured item. Shared rule module
// (see src/rules/ladder.ts for what that means): the shop shows these prices
// and purchaseCosmetic / purchaseBundle charge them, so they live once, here.

export const BUNDLE_DISCOUNT = 0.2;
export const FEATURED_DISCOUNT = 0.25;

// The top frames never go on sale: no featured week, no bundle.
export const NEVER_DISCOUNTED = ['frame_gold', 'frame_comet'];
// Only items worth featuring: a quarter off a $5k name colour is no event.
export const FEATURED_MIN_PRICE = 25000;

export interface Bundle {
  id: string;
  name: string;
  /** One name colour, glow, backdrop and frame. */
  items: string[];
}

export const BUNDLES: Bundle[] = [
  { id: 'bundle_steel', name: 'Steel', items: ['name_silver', 'glow_silver', 'backdrop_onyx', 'frame_steel'] },
  { id: 'bundle_jade', name: 'Jade', items: ['name_emerald', 'glow_neon', 'backdrop_verdant', 'frame_jade'] },
  { id: 'bundle_ruby', name: 'Ruby', items: ['name_crimson', 'glow_crimson', 'backdrop_inferno', 'frame_ruby'] },
  {
    id: 'bundle_inferno',
    name: 'Inferno',
    items: ['name_tangerine', 'glow_orange', 'backdrop_inferno', 'frame_ember'],
  },
  { id: 'bundle_frostbite', name: 'Frostbite', items: ['name_cyan', 'glow_cyan', 'backdrop_frost', 'frame_frost'] },
  {
    id: 'bundle_livewire',
    name: 'Live Wire',
    items: ['name_sapphire', 'glow_sapphire', 'backdrop_midnight', 'frame_electric'],
  },
  { id: 'bundle_bullrun', name: 'Bull Run', items: ['name_emerald', 'glow_neon', 'backdrop_lagoon', 'frame_bullbear'] },
  {
    id: 'bundle_bloodline',
    name: 'Bloodline',
    items: ['name_crimson', 'glow_pulse_crimson', 'backdrop_onyx', 'frame_bloodline'],
  },
  {
    id: 'bundle_wallstreet',
    name: 'Wall Street',
    items: ['name_shimmer', 'glow_pulse_gold', 'backdrop_gilded', 'frame_ticker'],
  },
  {
    id: 'bundle_glitch',
    name: 'Glitch',
    items: ['name_aurora', 'glow_pulse_pink', 'backdrop_midnight', 'frame_glitch'],
  },
];

export const BUNDLE_MAP: Record<string, Bundle> = Object.fromEntries(BUNDLES.map((b) => [b.id, b]));

/**
 * What a bundle costs this player: only the pieces they don't own yet, at the
 * bundle discount. Whole dollars.
 */
export const bundleQuote = (
  bundle: Bundle,
  owned: readonly string[] | null | undefined,
  priceOf: (id: string) => number | undefined,
): { missing: string[]; fullPrice: number; price: number } => {
  const have = new Set(owned || []);
  const missing = bundle.items.filter((id) => !have.has(id));
  const fullPrice = missing.reduce((sum, id) => sum + (priceOf(id) || 0), 0);
  return { missing, fullPrice, price: Math.round(fullPrice * (1 - BUNDLE_DISCOUNT)) };
};

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
// A Thursday, 21:00 UTC. Shop weeks run from the Thursday reopen to the next,
// like the mission week (rules/missions). They ran Monday to Monday until
// 2026-10-22; the switch landed on a week boundary, so no item was cut short
// beyond that one shorter week.
const SHOP_EPOCH = Date.UTC(2023, 11, 28, 21, 0);

export const shopWeek = (now: number = Date.now()): number => Math.floor((now - SHOP_EPOCH) / WEEK_MS);

/** When the current featured item ends (the next Thursday reopen). */
export const shopWeekEndsAt = (now: number = Date.now()): number => SHOP_EPOCH + (shopWeek(now) + 1) * WEEK_MS;

// mulberry32, seeded per rotation cycle.
const rng = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

/**
 * This week's featured cosmetic id, or null. Season rewards (earned) never feature. Worked out from the date alone,
 * so the shop and the server agree without storing anything. Every eligible
 * item is featured once before any repeats: each cycle is a fresh shuffle.
 * Adding or removing catalog items reshuffles, which can change the current
 * week's pick once.
 */
export const featuredCosmeticId = (
  catalog: readonly { id: string; price: number; earned?: boolean }[],
  now: number = Date.now(),
): string | null => {
  const eligible = catalog
    .filter((c) => !c.earned && c.price >= FEATURED_MIN_PRICE && !NEVER_DISCOUNTED.includes(c.id))
    .map((c) => c.id)
    .sort();
  if (!eligible.length) return null;
  const week = shopWeek(now);
  const cycle = Math.floor(week / eligible.length);
  const next = rng(cycle + 1);
  for (let i = eligible.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    [eligible[i], eligible[j]] = [eligible[j]!, eligible[i]!];
  }
  return eligible[week % eligible.length]!;
};

export const featuredPrice = (price: number): number => Math.round(price * (1 - FEATURED_DISCOUNT));

// Shop credit: money that only the shop takes. Admins hand it out as prizes and
// players earn it from missions. It pays first, cash covers the rest, it never
// expires, and it never turns into cash, so it adds nothing to the economy.
// Mission milestones pay it: every MISSION_CREDIT_EVERY lifetime missions, at
// the amount of the biggest tier that milestone lands on (the 100th pays $100k,
// the 25th, 50th and 75th $25k). Every tier's step must be a multiple of
// MISSION_CREDIT_EVERY. Change the payouts here; the site and server follow.
export const MISSION_CREDIT_EVERY = 25;
export const MISSION_CREDIT_TIERS: readonly { every: number; amount: number }[] = [
  { every: 100, amount: 100000 },
  { every: 25, amount: 25000 },
];

/** Credit a mission claim pays, given the player's new lifetime mission total. */
export const missionCreditFor = (newTotal: number): number => {
  if (!(newTotal > 0) || newTotal % MISSION_CREDIT_EVERY !== 0) return 0;
  return MISSION_CREDIT_TIERS.find((t) => newTotal % t.every === 0)?.amount || 0;
};

/** The next milestone after `total` missions: where it is, how far, and what it pays. */
export const nextMissionCredit = (total: number) => {
  const done = Math.max(0, Math.floor(total || 0));
  const at = (Math.floor(done / MISSION_CREDIT_EVERY) + 1) * MISSION_CREDIT_EVERY;
  return { at, left: at - done, progress: MISSION_CREDIT_EVERY - (at - done), amount: missionCreditFor(at) };
};

/** Total milestone credit for going from `before` to `after` lifetime missions. */
export const missionCreditBetween = (before: number, after: number): number => {
  let sum = 0;
  for (
    let n = (Math.floor(Math.max(0, before) / MISSION_CREDIT_EVERY) + 1) * MISSION_CREDIT_EVERY;
    n <= after;
    n += MISSION_CREDIT_EVERY
  )
    sum += missionCreditFor(n);
  return sum;
};

/** How a shop price is paid: credit first, cash for the rest. */
export const splitShopPayment = (
  price: number,
  credit: number | null | undefined,
): { fromCredit: number; fromCash: number } => {
  const fromCredit = Math.min(price, Math.max(0, credit || 0));
  return { fromCredit, fromCash: price - fromCredit };
};

/** What a player can spend in the shop: cash plus shop credit. */
export const shopBudget = (user: { cash?: number; shopCredit?: number } | null | undefined): number =>
  (user?.cash || 0) + Math.max(0, user?.shopCredit || 0);

/** A player's cash and shop credit after paying `price` (the site's instant update). */
export const afterShopPayment = (user: { cash?: number; shopCredit?: number }, price: number) => {
  const { fromCredit, fromCash } = splitShopPayment(price, user.shopCredit);
  return { cash: (user.cash || 0) - fromCash, shopCredit: Math.max(0, user.shopCredit || 0) - fromCredit };
};
