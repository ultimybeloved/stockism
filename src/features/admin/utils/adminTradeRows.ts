// Turns the three places a fill is recorded into rows for the admin Trades tab.
//
//   trades collection  every player fill: manual, limit, stop loss, pre-market
//                      auction, admin act-as, forced margin closes
//   ledger (ipo_buy)   IPO purchases, which never write a trades record
//   bot transactionLog bots trade outside the trades collection
//
// Until 2026-10-13 the tab read only each user's transactionLog, which only
// manual trades write, so every order fill and IPO buy was missing.

export type AdminTradeType = 'BUY' | 'SELL' | 'SHORT_OPEN' | 'SHORT_CLOSE' | 'LIQUIDATION';

export interface AdminTradeRow {
  id: string;
  userId: string;
  userName: string;
  isBot: boolean;
  type: AdminTradeType;
  /** How the fill happened: manual, limit, stop_loss, premarket, admin, margin_call, ipo, bot. */
  source: string;
  ticker: string;
  shares: number;
  price: number;
  total: number;
  timestamp: number;
}

type Loose = Record<string, unknown>;

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const str = (v: unknown) => (typeof v === 'string' ? v : '');
const millis = (v: unknown): number => {
  if (typeof v === 'number') return v;
  const ts = v as { toMillis?: () => number } | null;
  return ts?.toMillis ? ts.toMillis() : 0;
};

const ACTION_TYPES: Record<string, AdminTradeType> = {
  buy: 'BUY',
  sell: 'SELL',
  short: 'SHORT_OPEN',
  cover: 'SHORT_CLOSE',
  margin_call_cover: 'SHORT_CLOSE',
  margin_liquidation: 'LIQUIDATION',
};

/** A trades-collection record; null for anything that isn't a fill (dividends). */
export function tradeRecordToRow(id: string, d: Loose): Omit<AdminTradeRow, 'userName' | 'isBot'> | null {
  const action = str(d.action);
  const type = ACTION_TYPES[action];
  if (!type) return null;
  const forced = action === 'margin_call_cover' || action === 'margin_liquidation';
  return {
    id,
    userId: str(d.uid),
    type,
    source: forced ? 'margin_call' : str(d.source) || 'manual',
    ticker: str(d.ticker),
    shares: num(d.amount),
    price: num(d.price),
    total: num(d.totalValue),
    timestamp: millis(d.timestamp),
  };
}

/** A ledger ipo_buy entry (ref is the ticker, amount is minus the cost). */
export function ipoLedgerToRow(id: string, d: Loose): Omit<AdminTradeRow, 'userName' | 'isBot'> {
  const shares = num((d.detail as Loose | undefined)?.shares);
  const total = Math.abs(num(d.amount));
  return {
    id,
    userId: str(d.uid),
    type: 'BUY',
    source: 'ipo',
    ticker: str(d.ref),
    shares,
    price: shares > 0 ? total / shares : 0,
    total,
    timestamp: millis(d.timestamp),
  };
}

const LOG_TYPES = new Set<string>(['BUY', 'SELL', 'SHORT_OPEN', 'SHORT_CLOSE']);

/** A bot's transactionLog trades. */
export function botLogToRows(userId: string, userName: string, log: Loose[]): AdminTradeRow[] {
  return log
    .filter((tx) => LOG_TYPES.has(str(tx.type)))
    .map((tx, i) => ({
      id: `${userId}-bot-${i}`,
      userId,
      userName,
      isBot: true,
      type: str(tx.type) as AdminTradeType,
      source: 'bot',
      ticker: str(tx.ticker),
      shares: num(tx.shares) || num(tx.amount),
      price: num(tx.pricePerShare) || num(tx.price),
      total: num(tx.totalCost) || num(tx.totalRevenue),
      timestamp: millis(tx.timestamp),
    }));
}

/** Filters shared by every source; type and ticker are checked client-side. */
export function matchesFilters(row: AdminTradeRow, cutoff: number, type: string, ticker: string) {
  if (row.timestamp < cutoff) return false;
  if (type !== 'all' && row.type !== type) return false;
  if (ticker && row.ticker !== ticker.toUpperCase()) return false;
  return true;
}
