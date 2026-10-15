// The admin Bots screen: what the bot engine has been doing. Recent runs come
// from the run log botTrader keeps; the moves come straight from the chart
// points tagged 'bot' and 'bot_guard', so nothing extra is stored per move.
import * as admin from 'firebase-admin';
import { CHARACTER_MAP } from '../shared/characters';
import { priceHistoryRef } from '../shared/marketData';
import type { PricePoint } from '../shared/types';
import { storylinesRef } from '../market/manipulatorActivity';
import { utcDayOf } from '../market/botRules';

const db = admin.firestore();
const MOVE_WINDOW_MS = 48 * 60 * 60 * 1000;
const MOVES_MAX = 300;

export const buildBotActivity = async () => {
  const [stateSnap, histSnap, marketSnap] = await Promise.all([
    storylinesRef().get(),
    priceHistoryRef().get(),
    db.collection('market').doc('current').get(),
  ]);
  const state = stateSnap.data() || {};
  const history = (histSnap.data() || {}) as Record<string, PricePoint[]>;
  const prices: Record<string, number> = marketSnap.data()?.prices || {};
  const now = Date.now();
  const today = utcDayOf(now);

  const moves: { at: number; ticker: string; from: number; to: number; guard: boolean }[] = [];
  for (const [ticker, points] of Object.entries(history)) {
    if (!Array.isArray(points)) continue;
    for (let i = 1; i < points.length; i++) {
      const p = points[i]!;
      if (p.source !== 'bot' && p.source !== 'bot_guard') continue;
      if (p.timestamp < now - MOVE_WINDOW_MS) continue;
      moves.push({ at: p.timestamp, ticker, from: points[i - 1]!.price, to: p.price, guard: p.source === 'bot_guard' });
    }
  }
  moves.sort((a, b) => b.at - a.at);

  const kinds = (state.kinds || {}) as Record<string, string>;
  const stocks = Object.entries((state.tickers || {}) as Record<string, Record<string, unknown>>).map(
    ([ticker, s]) => ({
      ticker,
      name: CHARACTER_MAP[ticker]?.name || ticker,
      price: prices[ticker] || 0,
      kind: kinds[ticker] || null,
      phase: String(s.phase || ''),
      until: Number(s.until) || 0,
      botDrift: Number(s.botDrift) || 0,
      holdDrift: Number(s.holdDrift) || 0,
      movesToday: s.day === today ? Number(s.moves) || 0 : 0,
    }),
  );

  return {
    updatedAt: state.updatedAt || null,
    runLog: state.runLog || [],
    moves: moves.slice(0, MOVES_MAX),
    stocks,
  };
};
