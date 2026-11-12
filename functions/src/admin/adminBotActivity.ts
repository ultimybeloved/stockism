// The admin Bots screen: what the bot engine has been doing. Recent runs and
// moves come from the run log and move log botTrader keeps on the server-only
// botState/storylines doc. Chart points are untagged (PRIVATE_POINT_SOURCES).
import * as admin from 'firebase-admin';
import { CHARACTER_MAP } from '../shared/characters';
import { storylinesRef } from '../market/manipulatorActivity';
import { utcDayOf } from '../market/botRules';

const db = admin.firestore();
const MOVE_WINDOW_MS = 48 * 60 * 60 * 1000;
const MOVES_MAX = 300;

export const buildBotActivity = async () => {
  const [stateSnap, marketSnap] = await Promise.all([
    storylinesRef().get(),
    db.collection('market').doc('current').get(),
  ]);
  const state = stateSnap.data() || {};
  const prices: Record<string, number> = marketSnap.data()?.prices || {};
  const now = Date.now();
  const today = utcDayOf(now);

  type Move = { at: number; ticker: string; from: number; to: number; guard: boolean };
  const moves = ((state.moveLog || []) as Move[])
    .filter((m) => m.at >= now - MOVE_WINDOW_MS)
    .sort((a, b) => b.at - a.at);

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
