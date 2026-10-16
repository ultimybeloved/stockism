// The bot engine. Every 15 minutes it moves a handful of stocks by small
// amounts, following each stock's hidden storyline, and answers pushes by
// admin-confirmed manipulators. The decisions are all in botRules.ts.
//
// Bots no longer trade from wallets. The old bots were accounts with cash and
// personalities making random trades, which drew the constant up-and-down
// zigzag and could stall when a bot ran out of cash. The engine now moves the
// price directly, like the stabilizer, and tags every chart point it writes:
// 'bot' for storylines, 'bot_guard' for answers to a manipulator push. Bot
// moves never count as trades, so they never stop neglect from setting in and
// never show in trade counts or most-traded lists.
//
// It obeys every rule the other price movers do: the weekly and emergency
// halts, the circuit breaker, and admin prices (which it only wiggles around,
// see botRules 'held').
import { cf } from '../shared/fnConfig';
import * as admin from 'firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import * as logger from 'firebase-functions/logger';
import {
  MIN_PRICE,
  ADMIN_PRICE_PROTECTION_MS,
  NEGLECT_SHORT_INTEREST_THRESHOLD,
  SHORT_INTEREST_MAX_AGE_MS,
  isWeeklyTradingHalt,
} from '../shared/constants';
import { CHARACTER_MAP } from '../shared/characters';
import { isTickerPaused } from '../shared/impact';
import { priceHistoryRef, tickerStatsRef, appendPriceHistory, neglectFloorPrice } from '../shared/marketData';
import { isRosterTicker } from '../shared/roster';
import { round2 } from '../shared/money';
import { etfFollowUpdates } from '../trading/tradePricing';
import { recordHeartbeat } from '../shared/activity';
import type { PricePoint } from '../shared/types';
import { decayTarget, isNeglected } from './neglectDecayRules';
import {
  type Kind,
  type Storyline,
  GUARD_WINDOW_MS,
  chooseTickers,
  guardMove,
  lastAdminPoint,
  movesForRun,
  needsNewPhase,
  normalizeStoryline,
  pickPhase,
  recordMove,
  stepMove,
  underDailyCap,
} from './botRules';
import {
  loadConfirmed,
  loadGroupExposure,
  loadGroupTrades,
  loadOthersOpened,
  storylinesRef,
} from './manipulatorActivity';

const db = admin.firestore();
const GUARD_LOG_MAX = 60;
// One day of runs, for the admin Bots screen.
const RUN_LOG_MAX = 96;
const ACTIVE_WINDOW_MS = 2 * 60 * 60 * 1000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface PlannedMove {
  ticker: string;
  move: number;
  source: 'bot' | 'bot_guard';
  floor: number | null;
}

interface GuardLogEntry {
  at: number;
  ticker: string;
  from: number;
  to: number;
  reason: string;
  uids: string[];
}

/**
 * Write one wave of moves in a transaction, from fresh prices. Returns the
 * fraction each stock actually moved.
 */
const applyWave = async (moves: PlannedMove[], clearOldFields: boolean) =>
  db.runTransaction(async (tx) => {
    const marketRef = db.collection('market').doc('current');
    const fresh = (await tx.get(marketRef)).data() || {};
    if (isWeeklyTradingHalt() || fresh.marketHalted) return [];
    const now = Date.now();
    const prices: Record<string, number> = fresh.prices || {};
    const updates: Record<string, unknown> = {};
    const points: Record<string, PricePoint> = {};
    const applied: { ticker: string; frac: number; from: number; to: number }[] = [];

    for (const m of moves) {
      if (isTickerPaused(fresh.haltedTickers, m.ticker, now)) continue;
      const p = prices[m.ticker];
      if (!p || !(p > 0)) continue;
      let next = round2(Math.max(MIN_PRICE, p * (1 + m.move)));
      if (m.floor && m.move < 0 && next < m.floor) next = Math.min(p, round2(m.floor));
      if (next === p) continue;
      updates[`prices.${m.ticker}`] = next;
      points[m.ticker] = { timestamp: now, price: next, source: m.source };
      applied.push({ ticker: m.ticker, frac: next / p - 1, from: p, to: next });
    }

    // Parent ETFs follow, the same way they follow a player's trade. Tagged
    // 'etf_follow' so the Bots screen does not count them as bot moves.
    const moved = Object.fromEntries(applied.map((a) => [a.ticker, a.to]));
    for (const [etf, next] of Object.entries(etfFollowUpdates(moved, prices))) {
      if (isTickerPaused(fresh.haltedTickers, etf, now) || next === prices[etf]) continue;
      updates[`prices.${etf}`] = next;
      points[etf] = { timestamp: now, price: next, source: 'etf_follow' };
    }

    // The old bots kept their daily counters on the world-readable market doc.
    if (clearOldFields && ('botImpact' in fresh || 'botImpactDate' in fresh)) {
      updates.botImpact = FieldValue.delete();
      updates.botImpactDate = FieldValue.delete();
    }
    if (Object.keys(updates).length) tx.update(marketRef, updates);
    if (applied.length) appendPriceHistory(tx, points);
    return applied;
  });

export const botTrader = cf({ timeoutSeconds: 300, memory: '256MB' })
  .pubsub.schedule('*/15 * * * *')
  .timeZone('UTC')
  .onRun(async () => {
    try {
      if (isWeeklyTradingHalt()) {
        logger.info('botTrader: skipping, weekly halt');
        return null;
      }
      // Never on the exact quarter hour.
      await sleep(Math.floor(Math.random() * 60000));

      const [marketSnap, histSnap, statsSnap, stateSnap, confirmed] = await Promise.all([
        db.collection('market').doc('current').get(),
        priceHistoryRef().get(),
        tickerStatsRef().get(),
        storylinesRef().get(),
        loadConfirmed(),
      ]);
      const market = marketSnap.data();
      if (!market) return null;
      if (market.marketHalted) {
        logger.info('botTrader: skipping, emergency halt');
        return null;
      }

      const now = Date.now();
      const rng = Math.random;
      const prices: Record<string, number> = market.prices || {};
      const history = (histSnap.data() || {}) as Record<string, PricePoint[]>;
      const stats = statsSnap.data() || {};
      const shortInterest = stats.shortInterest || {};
      // A stale "nobody is short" reading is the hole the neglect pause closes,
      // so with one every neglected stock only wiggles flat.
      const shortsFresh = now - (stats.shortInterestAt || 0) <= SHORT_INTEREST_MAX_AGE_MS;
      const saved = (stateSnap.data()?.tickers || {}) as Record<string, Partial<Storyline>>;
      const guardLog = (stateSnap.data()?.guardLog || []) as GuardLogEntry[];
      const runLog = (stateSnap.data()?.runLog || []) as unknown[];
      const launched: string[] = market.launchedTickers || [];

      // Classify every tradable stock and bring its storyline up to date.
      const state: Record<string, Storyline> = {};
      const kinds: Record<string, Kind> = {};
      const floors: Record<string, number | null> = {};
      for (const ticker of Object.keys(prices)) {
        const character = CHARACTER_MAP[ticker];
        if (!character || character.isETF || !isRosterTicker(ticker)) continue;
        if (character.ipoRequired && !launched.includes(ticker)) continue;
        if (!(prices[ticker]! > 0)) continue;

        const adminPoint = lastAdminPoint(history[ticker], ADMIN_PRICE_PROTECTION_MS, now);
        let kind: Kind = 'normal';
        let floor: number | null = null;
        if (adminPoint) {
          kind = 'held';
        } else if (isNeglected(character, stats[ticker], now, stats.neglectTrackingStartedAt)) {
          floor = neglectFloorPrice(character, stats[ticker]?.trades || 0);
          const slides =
            shortsFresh &&
            (shortInterest[ticker] || 0) < NEGLECT_SHORT_INTEREST_THRESHOLD &&
            decayTarget({
              character,
              price: prices[ticker],
              stats: stats[ticker],
              shortInterest,
              priceHistory: history,
              now,
              trackingStartedAt: stats.neglectTrackingStartedAt,
              haltedTickers: market.haltedTickers,
            }) !== null;
          kind = slides ? 'neglected' : 'neglected_still';
        }

        let s = normalizeStoryline(saved[ticker], now);
        const holdFrom = adminPoint ? adminPoint.timestamp : null;
        if (needsNewPhase(s, kind, now, holdFrom)) s = pickPhase(s, kind, now, rng, holdFrom);
        state[ticker] = s;
        kinds[ticker] = kind;
        floors[ticker] = floor;
      }

      // The guard goes first, in the first wave.
      const guardMoves: PlannedMove[] = [];
      const guardWhy = new Map<string, { reason: string; uids: string[] }>();
      const guardNotes: GuardLogEntry[] = [];
      const uids = Object.keys(confirmed);
      if (uids.length) {
        const since = now - GUARD_WINDOW_MS;
        const trades = await loadGroupTrades(uids, since, 200);
        if (trades.length) {
          const exposure = await loadGroupExposure(uids);
          const group = new Set(uids);
          const byTicker = new Map<string, typeof trades>();
          for (const t of trades) byTicker.set(t.ticker, [...(byTicker.get(t.ticker) || []), t]);
          for (const [ticker, list] of byTicker) {
            if (!state[ticker] || isTickerPaused(market.haltedTickers, ticker, now)) continue;
            const price = prices[ticker]!;
            // Cheap check first: no push big enough means no query.
            const first = guardMove({ trades: list, price, exposure: exposure[ticker] || 0, othersOpposite: 0 });
            if (!first) continue;
            const othersOpposite = await loadOthersOpened(ticker, since, group, first.move < 0 ? 'short' : 'buy');
            const answer = guardMove({ trades: list, price, exposure: exposure[ticker] || 0, othersOpposite });
            if (!answer) continue;
            guardMoves.push({ ticker, move: answer.move, source: 'bot_guard', floor: null });
            guardWhy.set(ticker, { reason: answer.reason, uids: [...new Set(list.map((t) => t.uid))] });
          }
        }
      }

      // Storyline moves.
      const guarded = new Set(guardMoves.map((m) => m.ticker));
      const activeTickers = Object.keys(state).filter(
        (t) => (stats[t]?.lastTradedAt || 0) >= now - ACTIVE_WINDOW_MS,
      ).length;
      const d = new Date(now);
      const afterReopen = d.getUTCDay() === 4 && d.getUTCHours() >= 21;
      const cands = Object.keys(state)
        .filter((t) => !guarded.has(t) && underDailyCap(state[t]!, kinds[t]!))
        .map((ticker) => ({ ticker, kind: kinds[ticker]! }));
      const picked = chooseTickers(cands, movesForRun(activeTickers, afterReopen, rng), rng);

      const storyMoves: PlannedMove[] = [];
      for (const ticker of picked) {
        const move = stepMove(state[ticker]!, kinds[ticker]!, prices[ticker]!, now, rng, floors[ticker]);
        if (Math.abs(move) >= 0.0005) storyMoves.push({ ticker, move, source: 'bot', floor: floors[ticker] ?? null });
      }

      // Spread over two or three waves so prices tick rather than jump at once.
      const waveCount = storyMoves.length <= 3 ? 1 : rng() < 0.4 ? 3 : 2;
      const waves: PlannedMove[][] = Array.from({ length: waveCount }, () => []);
      storyMoves.forEach((m, i) => waves[i % waveCount]!.push(m));
      waves[0] = [...guardMoves, ...waves[0]!];

      let moved = 0;
      for (let i = 0; i < waves.length; i++) {
        if (i > 0) await sleep(15000 + Math.floor(Math.random() * 25000));
        if (!waves[i]!.length && i > 0) continue;
        const applied = await applyWave(waves[i]!, i === 0);
        const at = Date.now();
        for (const a of applied) {
          moved++;
          const why = guardWhy.get(a.ticker);
          if (why) {
            // Guard moves are logged for the admin and never touch storyline totals.
            guardNotes.push({ at, ticker: a.ticker, from: a.from, to: a.to, ...why });
            continue;
          }
          state[a.ticker] = recordMove(state[a.ticker]!, kinds[a.ticker]!, a.frac, at);
        }
      }

      await storylinesRef().set({
        tickers: state,
        kinds,
        guardLog: [...guardNotes, ...guardLog].slice(0, GUARD_LOG_MAX),
        runLog: [
          { at: now, moves: moved, guard: guardNotes.length, picked: picked.length, active: activeTickers },
          ...runLog,
        ].slice(0, RUN_LOG_MAX),
        updatedAt: Date.now(),
      });

      logger.info(
        `botTrader: ${moved} moves (${guardMoves.length} guard), ${picked.length} picked, ${activeTickers} active stocks`,
      );
      await recordHeartbeat('botTrader');
      return null;
    } catch (error) {
      logger.error('Error in botTrader:', error);
      return null;
    }
  });
