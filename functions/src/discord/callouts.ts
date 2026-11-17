// Discord call-outs: posting the moments. INTERNAL MODULE, not in services.ts.
// The rules (what counts, how often) are in shared/calloutRules.
//
//   Big wins      queued by recordTrade in calloutQueue/{id}, posted by the bot
//                 round (runCallouts, every 15 minutes).
//   Leaderboard   the bot round reads the top 10 by net worth, the same way
//                 the site's board ranks it, and compares with botState/callouts.
//   Streaks       posted straight from dailyCheckin (announceStreak).
//
// Every post is best-effort: a call-out never fails a trade, a check-in, or
// the bot round.
import * as admin from 'firebase-admin';
import * as logger from 'firebase-functions/logger';
import type { DocumentData } from 'firebase-admin/firestore';
import { sendDiscordMessage, pxe } from '../shared/discordApi';
import {
  FLAIR_CREW_EMOJIS,
  PIXEL_CREW_EMOJIS,
  LEADERBOARD_POOL_START,
  LEADERBOARD_POOL_MAX,
} from '../shared/constants';
import { flairOf } from '../shared/rules/flairCrews';
import { netWorthOf, maxEventPositionsValue } from '../shared/equity';
import { reportError } from '../shared/sentry';
import { loadConfirmed } from '../market/manipulatorActivity';
import { WIN_COOLDOWN_MS, WINS_PER_RUN, TOP_SIZE, shakeups, type ShakeupState } from '../shared/calloutRules';

const db = admin.firestore();
const stateRef = () => db.collection('botState').doc('callouts');
const CALLOUT_COLOR = 0xf97316;

/** Underscores are the only markdown character a username can contain. */
const escapeName = (name: string) => name.replace(/_/g, '\\_');

/** The player as the post shows them: bold name, then their crest. */
const who = (u: DocumentData) =>
  [
    `**${escapeName(u.displayName || 'A player')}**`,
    (() => {
      const flair = flairOf(u as Parameters<typeof flairOf>[0])?.id;
      return (flair && FLAIR_CREW_EMOJIS[flair]) || (u.crew && PIXEL_CREW_EMOJIS[u.crew]) || '';
    })(),
  ]
    .filter(Boolean)
    .join(' ');

const money = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`;

const post = (title: string, description: string) =>
  sendDiscordMessage(null, [{ color: CALLOUT_COLOR, title, description, timestamp: new Date().toISOString() }]);

/** A player who should never be celebrated: bots, banned accounts, confirmed manipulators. */
const quiet = (u: DocumentData | undefined, uid: string, confirmed: Record<string, unknown>) =>
  !u || u.isBot || u.isBanned || !!confirmed[uid];

// ── Big wins ────────────────────────────────────────────────────────────────

async function postWins(state: DocumentData, confirmed: Record<string, unknown>, now: number) {
  const queued = await db.collection('calloutQueue').where('at', '<=', now).orderBy('at').limit(20).get();
  const lastWinAt: Record<string, number> = { ...(state.lastWinAt || {}) };
  let posted = 0;
  for (const doc of queued.docs) {
    const q = doc.data();
    if (posted >= WINS_PER_RUN) break;
    await doc.ref.delete();
    if (q.kind !== 'win' || now - (lastWinAt[q.uid] ?? -Infinity) < WIN_COOLDOWN_MS) continue;
    const u = (await db.collection('users').doc(q.uid).get()).data();
    // A private profile hides its trades on the site, so its wins stay private too.
    if (quiet(u, q.uid, confirmed) || !u!.isPublic) continue;
    const pct = q.percent >= 100 ? ` (+${Math.round(q.percent)}%)` : '';
    await post(
      `${pxe('rocket')} Big win`,
      q.side === 'short'
        ? `${who(u!)} just covered a short on **$${q.ticker}** for **+${money(q.profit)}**${pct}.`
        : `${who(u!)} just cashed out of **$${q.ticker}** for **+${money(q.profit)}**${pct}.`,
    );
    lastWinAt[q.uid] = now;
    posted++;
  }
  for (const [uid, at] of Object.entries(lastWinAt)) if (now - at >= WIN_COOLDOWN_MS) delete lastWinAt[uid];
  return lastWinAt;
}

// ── Leaderboard ─────────────────────────────────────────────────────────────

/** The top TOP_SIZE by net worth, ranked the way getLeaderboard ranks them. */
async function topByNetWorth(): Promise<DocumentData[]> {
  const headroom = await maxEventPositionsValue();
  for (let pool = Math.min(LEADERBOARD_POOL_START, 40); ; pool *= 2) {
    const snap = await db
      .collection('users')
      .orderBy('portfolioValue', 'desc')
      .limit(pool)
      .select(
        'displayName',
        'crew',
        'flairCrew',
        'portfolioValue',
        'marginUsed',
        'eventPositionsValue',
        'isBot',
        'isBanned',
      )
      .get();
    const ranked = snap.docs
      .map((d): DocumentData => ({ ...d.data(), uid: d.id }))
      .filter((u) => !u.isBot && !u.isBanned)
      .sort((a, b) => netWorthOf(b) - netWorthOf(a));
    const lowestGross = snap.docs[snap.docs.length - 1]?.data().portfolioValue || 0;
    const cutoff = ranked[TOP_SIZE - 1];
    if (snap.size < pool || pool >= LEADERBOARD_POOL_MAX || (cutoff && netWorthOf(cutoff) >= lowestGross + headroom)) {
      return ranked.slice(0, TOP_SIZE);
    }
  }
}

async function postShakeups(state: DocumentData, confirmed: Record<string, unknown>, now: number) {
  const top = await topByNetWorth();
  const byUid = new Map(top.map((u) => [u.uid as string, u]));
  const { posts, next } = shakeups(state.board as ShakeupState | undefined, [...byUid.keys()], now);
  for (const p of posts) {
    const u = byUid.get(p.uid);
    if (quiet(u, p.uid, confirmed)) continue;
    if (p.kind === 'leader') {
      const prev = p.previous ? (await db.collection('users').doc(p.previous).get()).data() : null;
      await post(
        `${pxe('rank1')} New #1`,
        prev
          ? `${who(u!)} just took the top spot on the leaderboard from ${who(prev)}.`
          : `${who(u!)} just took the top spot on the leaderboard.`,
      );
    } else {
      await post(`${pxe('trophy')} Top 10`, `${who(u!)} just broke into the top 10 at **#${p.rank}**.`);
    }
  }
  return next;
}

/**
 * Called at the end of every bot round. Never throws.
 */
export async function runCallouts(now = Date.now()) {
  try {
    const [stateSnap, confirmed] = await Promise.all([stateRef().get(), loadConfirmed()]);
    const state = stateSnap.data() || {};
    const lastWinAt = await postWins(state, confirmed, now);
    const board = await postShakeups(state, confirmed, now);
    await stateRef().set({ lastWinAt, board, updatedAt: now });
  } catch (err) {
    reportError(err, { where: 'runCallouts' });
  }
}

// ── Streaks ─────────────────────────────────────────────────────────────────

/** A check-in streak milestone (shared/calloutRules isStreakMilestone). Never throws. */
export async function announceStreak(uid: string, streak: number) {
  try {
    const u = (await db.collection('users').doc(uid).get()).data();
    if (quiet(u, uid, await loadConfirmed())) return;
    await post(`${pxe('fire')} ${streak}-day streak`, `${who(u!)} just checked in **${streak} days in a row**.`);
  } catch (err) {
    logger.warn('announceStreak failed', (err as Error).message);
  }
}
