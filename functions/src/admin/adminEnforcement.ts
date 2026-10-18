// Admin tools for dealing with a manipulator group, from the player file:
//
// - adminCutAccount: shrink an account to a target net worth (cutAccountMath),
//   with a preview first. Ledger (shares + cash), admin history, a bell
//   notification with the percentage, and a Discord DM if asked.
// - adminCoTraders: who trades alongside a player. For each of their trades,
//   other players who traded the same stock the same way within 10 minutes,
//   ranked by how often, plus coordinated-pressure flags they shared. Read-only.
//
// Both replace one-off scripts (slash-accounts.cjs, co-traders.cjs) used in
// October 2026 against the Stitch / Madness / Callmebot group.
import * as functions from 'firebase-functions/v1';
import * as admin from 'firebase-admin';
import { Timestamp } from 'firebase-admin/firestore';
import { cf, requireAdmin } from '../shared/fnConfig';
import { TWENTY_FOUR_HOURS_MS } from '../shared/constants';
import { recordLedger } from '../shared/ledger';
import { logAdminAction } from '../shared/adminLog';
import { writeNotification } from '../shared/notifications';
import { sendDiscordDM } from '../shared/discordApi';
import { round2 } from '../shared/money';
import { planAccountCut, type CutPlan, type CutUser } from './cutAccountMath';
const db = admin.firestore();

const NOTE_MAX = 300;

// What the panel shows: the plan without the raw field writes.
const summary = ({
  factor,
  before,
  after,
  cash,
  newCash,
  stocks,
  newStocks,
  debt,
  newDebt,
  event,
  dropPercent,
}: CutPlan) => ({
  factor,
  before,
  after,
  cash,
  newCash,
  stocks,
  newStocks,
  debt,
  newDebt,
  event,
  dropPercent,
});

export const adminCutAccount = cf().https.onCall(
  async (data: { uid?: unknown; target?: unknown; note?: unknown; dm?: unknown; preview?: unknown }, context) => {
    requireAdmin(context);
    const uid = typeof data?.uid === 'string' ? data.uid : '';
    const target = Number(data?.target);
    const note = typeof data?.note === 'string' ? data.note.trim().slice(0, NOTE_MAX) : '';
    if (!uid) throw new functions.https.HttpsError('invalid-argument', 'Pick a player.');
    if (!(target > 0)) throw new functions.https.HttpsError('invalid-argument', 'Pick a target above $0.');

    const userRef = db.collection('users').doc(uid);
    const marketRef = db.collection('market').doc('current');
    const run = (apply: boolean) =>
      db.runTransaction(async (tx) => {
        const [market, user] = await Promise.all([tx.get(marketRef), tx.get(userRef)]);
        if (!user.exists) throw new functions.https.HttpsError('not-found', 'Player not found.');
        const u = user.data()!;
        let plan: CutPlan | null;
        try {
          plan = planAccountCut(u as CutUser, market.data()?.prices || {}, target);
        } catch (err) {
          throw new functions.https.HttpsError('failed-precondition', (err as Error).message);
        }
        if (plan && apply) {
          tx.update(userRef, plan.updates);
          const detail = { by: context.auth!.uid, factor: plan.factor };
          recordLedger(tx, {
            uid,
            type: 'admin_slash',
            account: 'shares',
            amount: plan.newStocks - plan.stocks,
            ref: 'slash',
            detail,
          });
          recordLedger(tx, {
            uid,
            type: 'admin_slash',
            amount: plan.newCash - plan.cash,
            cashAfter: plan.newCash,
            ref: 'slash',
            detail,
          });
        }
        return {
          plan,
          name: (u.displayName as string) || null,
          discordId: (u.discordId as string) || null,
        };
      });

    const preview = data?.preview !== false;
    const { plan, name, discordId } = await run(!preview);
    const numbers = plan ? summary(plan) : {};
    const message = plan ? `Your account dropped by ${plan.dropPercent}%.${note ? ` ${note}` : ''}` : null;
    if (!plan || preview) return { skipped: !plan, preview: true, ...numbers, message };

    await logAdminAction(context, {
      action: 'slash_account',
      uid,
      name,
      before: plan.before,
      after: plan.after,
      detail: { factor: plan.factor, dropPercent: plan.dropPercent, note: note || null },
    });
    await writeNotification(uid, {
      type: 'system',
      title: 'Account cut',
      message: message!,
      data: { dropPercent: plan.dropPercent },
    });
    let dmSent = false;
    if (data?.dm === true && discordId) {
      try {
        await sendDiscordDM(discordId, message);
        dmSent = true;
      } catch {
        dmSent = false;
      }
    }
    return { skipped: false, preview: false, ...numbers, message, dmSent };
  },
);

const CO_TRADE_WINDOW_MS = 10 * 60 * 1000;
const CO_TRADERS_SHOWN = 25;
const dirOf = (action: unknown) =>
  action === 'buy' || action === 'cover' ? 1 : action === 'sell' || action === 'short' ? -1 : 0;
const ms = (ts: unknown) => {
  const v = ts as { toMillis?: () => number } | number | null;
  return typeof v === 'number' ? v : v && typeof v.toMillis === 'function' ? v.toMillis() : 0;
};

interface TradeRow {
  uid: string;
  ticker: string;
  dir: number;
  ts: number;
  value: number;
}

export const adminCoTraders = cf({ timeoutSeconds: 120 }).https.onCall(
  async (data: { uid?: unknown; days?: unknown }, context) => {
    requireAdmin(context);
    const uid = typeof data?.uid === 'string' ? data.uid : '';
    if (!uid) throw new functions.https.HttpsError('invalid-argument', 'Pick a player.');
    const days = Math.min(90, Math.max(1, Math.floor(Number(data?.days) || 30)));
    const since = Timestamp.fromMillis(Date.now() - days * TWENTY_FOUR_HOURS_MS);
    const row = (d: admin.firestore.QueryDocumentSnapshot): TradeRow => {
      const t = d.data();
      return {
        uid: t.uid,
        ticker: t.ticker,
        dir: dirOf(t.action),
        ts: ms(t.timestamp),
        value: (Number(t.amount) || 0) * (Number(t.price) || 0),
      };
    };

    const mine = (await db.collection('trades').where('uid', '==', uid).where('timestamp', '>', since).get()).docs
      .map(row)
      .filter((t) => t.dir !== 0);
    const tickers = [...new Set(mine.map((t) => t.ticker))];
    const byTicker = new Map<string, TradeRow[]>();
    await Promise.all(
      tickers.map(async (tk) => {
        const snap = await db.collection('trades').where('ticker', '==', tk).where('timestamp', '>', since).get();
        byTicker.set(tk, snap.docs.map(row));
      }),
    );

    const score = new Map<string, { matches: number; tickers: Set<string>; value: number }>();
    for (const g of mine) {
      const seen = new Set<string>();
      for (const o of byTicker.get(g.ticker) || []) {
        if (!o.uid || o.uid === uid || seen.has(o.uid)) continue;
        if (o.dir !== g.dir || Math.abs(o.ts - g.ts) > CO_TRADE_WINDOW_MS) continue;
        seen.add(o.uid);
        const s = score.get(o.uid) || { matches: 0, tickers: new Set<string>(), value: 0 };
        s.matches++;
        s.tickers.add(g.ticker);
        s.value += o.value;
        score.set(o.uid, s);
      }
    }

    const flags = new Map<string, number>();
    const alerts = await db
      .collection('watchlist_alerts')
      .where('participantUIDs', 'array-contains', uid)
      .limit(500)
      .get();
    alerts.forEach((d) => {
      for (const other of (d.data().participantUIDs as string[]) || []) {
        if (other !== uid) flags.set(other, (flags.get(other) || 0) + 1);
      }
    });

    const top = [...score.entries()].sort((a, b) => b[1].matches - a[1].matches).slice(0, CO_TRADERS_SHOWN);
    const ids = [...new Set([...top.map(([id]) => id), ...flags.keys()])];
    const docs = ids.length ? await db.getAll(...ids.map((id) => db.collection('users').doc(id))) : [];
    const info = new Map(docs.map((d) => [d.id, d.data()]));
    const own = await Promise.all(
      top.map(async ([id]) => {
        const c = await db.collection('trades').where('uid', '==', id).where('timestamp', '>', since).count().get();
        return c.data().count;
      }),
    );
    const person = (id: string) => {
      const u = info.get(id);
      return { uid: id, name: (u?.displayName as string) || null, deleted: !u, isBot: !!u?.isBot };
    };

    return {
      days,
      trades: mine.length,
      rows: top
        .filter(([id]) => !info.get(id)?.isBot)
        .map(([id, s], i) => ({
          ...person(id),
          matches: s.matches,
          ownTrades: own[i] || 0,
          sharedFlags: flags.get(id) || 0,
          tickers: [...s.tickers].slice(0, 8),
          value: round2(s.value),
        })),
      flagOnly: [...flags.entries()]
        .filter(([id]) => !score.has(id))
        .sort((a, b) => b[1] - a[1])
        .map(([id, n]) => ({ ...person(id), sharedFlags: n })),
    };
  },
);
