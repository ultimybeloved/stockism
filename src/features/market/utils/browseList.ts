// The order the stock page swipes through: the market list as the player last
// saw it (their tab, filters and sort), kept for the visit. A stock that isn't
// in it (opened from the portfolio, a link, search) falls back to the whole
// market, A to Z.

const KEY = 'stockism_browseList';
let list: string[] | null = null;

export function setBrowseList(tickers: string[]) {
  list = tickers;
  try {
    sessionStorage.setItem(KEY, JSON.stringify(tickers));
  } catch {
    /* private window: the in-memory copy still works for this visit */
  }
}

function getBrowseList(): string[] {
  if (list) return list;
  try {
    const saved: unknown = JSON.parse(sessionStorage.getItem(KEY) || 'null');
    if (Array.isArray(saved)) list = saved.filter((t): t is string => typeof t === 'string');
  } catch {
    /* unreadable: fall back below */
  }
  return list || [];
}

/** The stocks before and after this one, wrapping around at the ends. */
export function browseNeighbors(ticker: string, allTickers: string[]): { prev: string; next: string } | null {
  const saved = getBrowseList();
  const order = saved.includes(ticker) ? saved : [...allTickers].sort();
  const i = order.indexOf(ticker);
  if (i < 0 || order.length < 2) return null;
  return { prev: order[(i - 1 + order.length) % order.length]!, next: order[(i + 1) % order.length]! };
}
