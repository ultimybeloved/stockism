// GENERATED from src/rules/ledgerFlow.ts by `npm run sync:chars`. Do not edit.
// The money flow report: where cash comes from and where it goes, by day.
// Shared rule module (see src/rules/ladder.ts): the server rolls the `ledger`
// up into one summary per UTC day with rollupLedger, and the admin panel
// labels and groups the result with LEDGER_GROUPS.
//
// Every ledger entry has a type (`checkin_reward`, `trade_buy`, ...). A type
// with no entry here still counts; it lands in "Other" under its raw name, so
// a new faucet shows up in the report before anyone labels it.

export interface LedgerFlowRow {
  in: number;
  out: number;
  count: number;
}

export interface LedgerDay {
  /** UTC day, YYYY-MM-DD. */
  day: string;
  /** `${account}:${type}` -> money in, money out and entry count. */
  rows: Record<string, LedgerFlowRow>;
  /** Distinct players with at least one entry. */
  players: number;
}

export interface LedgerFlowEntry {
  uid?: string;
  type?: string;
  account?: string;
  amount?: number;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** One day's summary from that day's ledger entries. Pure. */
export function rollupLedger(day: string, entries: LedgerFlowEntry[]): LedgerDay {
  const rows: Record<string, LedgerFlowRow> = {};
  const players = new Set<string>();
  for (const e of entries) {
    const amount = Number(e.amount);
    if (!Number.isFinite(amount) || amount === 0) continue;
    const key = `${e.account || 'cash'}:${e.type || 'unknown'}`;
    const row = (rows[key] ||= { in: 0, out: 0, count: 0 });
    if (amount > 0) row.in = round2(row.in + amount);
    else row.out = round2(row.out - amount);
    row.count += 1;
    if (e.uid) players.add(e.uid);
  }
  return { day, rows, players: players.size };
}

/** The UTC day (YYYY-MM-DD) a millisecond time falls on. */
export const utcDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** Every UTC day from `days - 1` days before `todayMs` up to today, oldest first. */
export function lastDays(todayMs: number, days: number): string[] {
  const out: string[] = [];
  for (let i = days - 1; i >= 0; i--) out.push(utcDay(todayMs - i * 86400000));
  return out;
}

export interface LedgerGroup {
  id: string;
  label: string;
  /** Types in this group, with their plain-English label. */
  types: Record<string, string>;
}

// Order is the order the report shows them in.
export const LEDGER_GROUPS: LedgerGroup[] = [
  {
    id: 'trading',
    label: 'Stock trading',
    types: {
      trade_buy: 'Buys',
      trade_sell: 'Sells',
      trade_short: 'Shorts opened',
      trade_cover: 'Shorts covered',
      ipo_buy: 'IPO buys',
      dust_sweep: 'Dust sweeps',
      margin_liquidation: 'Margin liquidations',
      margin_call_cover: 'Margin call covers',
      margin_repay: 'Margin repaid',
    },
  },
  {
    id: 'rewards',
    label: 'Rewards',
    types: {
      starting_cash: 'Starting cash',
      starting_cash_unlock: 'Discord link unlock',
      checkin_reward: 'Daily check-ins',
      welcome_streak: 'Welcome week',
      mission_reward: 'Missions',
      mission_credit: 'Mission shop credit',
      crew_mission_reward: 'Crew missions',
      rivalry_reward: 'Crew rivalries',
      achievement: 'Achievements',
      dividend: 'Dividends',
      dividend_drip: 'Dividend reinvesting',
      loyalty: 'Loyalty',
      daily_drop: 'Daily drop',
      season_reward: 'Season rewards',
      season_end: 'Season end',
      bailout: 'Bailouts',
    },
  },
  {
    id: 'shop',
    label: 'Shop',
    types: {
      cosmetic_purchase: 'Cosmetics',
      bundle_purchase: 'Bundles',
      cosmetic_gift_sent: 'Gifts sent',
      cosmetic_gift_received: 'Gifts received',
      shop_price_refund: 'Price drop refunds',
      pin_purchase: 'Pins',
      pin_slot_purchase: 'Pin slots',
      streak_saver_purchase: 'Streak savers',
      name_change: 'Name changes',
      mission_reroll: 'Mission rerolls',
    },
  },
  {
    id: 'sideGames',
    label: 'Side games',
    types: {
      ladder_deposit: 'Ladder deposits',
      ladder_withdraw: 'Ladder withdrawals',
      ladder_starting_chips: 'Ladder free chips',
      checkin_ladder_topup: 'Ladder check-in top-up',
      ladder_win: 'Ladder wins',
      ladder_loss: 'Ladder losses',
      prediction_bet: 'Weekly bets placed',
      prediction_payout: 'Weekly bet payouts',
      prediction_refund: 'Weekly bet refunds',
      event_buy: 'Long-term market buys',
      event_sell: 'Long-term market sells',
      event_payout: 'Long-term market payouts',
      event_refund: 'Long-term market refunds',
    },
  },
  {
    id: 'penalties',
    label: 'Penalties and fees',
    types: {
      crew_switch_penalty: 'Crew switch penalty',
      crew_leave_penalty: 'Crew leave penalty',
    },
  },
  {
    id: 'admin',
    label: 'Admin',
    types: {
      admin_set_cash: 'Cash edits',
      admin_shop_credit: 'Shop credit edits',
      admin_set_holding: 'Holding edits',
      admin_grant_cosmetic: 'Cosmetics granted',
      admin_revoke_cosmetic: 'Cosmetics revoked',
      admin_grant_pin: 'Pins granted',
      admin_revoke_pin: 'Pins revoked',
      admin_ladder_transfer: 'Ladder transfers',
      admin_transfer_in: 'Account transfers in',
      admin_transfer_out: 'Account transfers out',
      admin_remove_coord_profit: 'Coordination clawbacks',
      admin_ticker_recovery_clawback: 'Ticker recovery clawbacks',
      admin_reinstate: 'Reinstatements',
      admin_ban_reset: 'Ban resets',
      admin_repair: 'Repairs',
    },
  },
];

const TYPE_GROUP: Record<string, { group: string; label: string }> = {};
for (const g of LEDGER_GROUPS)
  for (const [type, label] of Object.entries(g.types)) TYPE_GROUP[type] = { group: g.id, label };

/** The group and label a ledger type is shown under. */
export const ledgerTypeInfo = (type: string) => TYPE_GROUP[type] || { group: 'other', label: type.replace(/_/g, ' ') };
