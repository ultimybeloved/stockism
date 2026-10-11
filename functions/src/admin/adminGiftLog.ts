// Read side of the gift log: who gifted what to whom, and whether the two
// accounts look like the same person.
//
// giftCosmetic writes one `giftLog` entry per gift (with the giver's connection
// at the time). The worry is an alt spending its cash on its main, so each
// entry is checked against everything else that ties two accounts together:
// the connections each account signed up, traded and gifted from, the nightly
// alt scan, and the admin's own watchlist links. Read-only, like adminCashLog.
import { cf, requireAdmin } from '../shared/fnConfig';
import * as admin from 'firebase-admin';
import { networkKey } from '../shared/accountGuards';
import { TWENTY_FOUR_HOURS_MS } from '../shared/constants';
const db = admin.firestore();

const PAGE = 300;
// Enough recent trades to see where an account usually plays from.
const TRADES_PER_ACCOUNT = 200;
const NEW_ACCOUNT_MS = 7 * TWENTY_FOUR_HOURS_MS;

interface GiftLogDoc {
  at: number;
  fromUid: string;
  fromName?: string | null;
  fromNet?: string | null;
  toUid: string;
  toName?: string | null;
  itemId: string;
  itemName?: string;
  price?: number;
  value?: number;
}

const millis = (t: unknown): number | null => {
  const v = t as { toMillis?: () => number } | number | null | undefined;
  if (typeof v === 'number') return v;
  return v && typeof v.toMillis === 'function' ? v.toMillis() : null;
};

// signupIp is stored with . : / turned into _. Four numbers is IPv4; anything
// else was IPv6.
const unsanitizeIp = (s: unknown): string | null => {
  if (typeof s !== 'string' || !s) return null;
  const parts = s.split('_');
  return parts.length === 4 && parts.every((p) => /^\d+$/.test(p)) ? parts.join('.') : parts.join(':');
};

export const adminListGifts = cf().https.onCall(async (_data, context) => {
  requireAdmin(context);

  const snap = await db.collection('giftLog').orderBy('at', 'desc').limit(PAGE).get();
  const gifts = snap.docs.map((d) => ({ id: d.id, ...(d.data() as GiftLogDoc) }));
  if (!gifts.length) return { success: true, entries: [] };

  const uids = [...new Set(gifts.flatMap((g) => [g.fromUid, g.toUid]))];

  // Every connection each account is known to have used.
  const networks = new Map<string, Set<string>>(uids.map((u) => [u, new Set()]));
  const add = (uid: string, net: string | null) => net && networks.get(uid)?.add(net);
  for (const g of gifts) add(g.fromUid, g.fromNet || null);

  const [users, watched, altState] = await Promise.all([
    db.getAll(...uids.map((u) => db.collection('users').doc(u))),
    db.getAll(...uids.map((u) => db.collection('watchedUsers').doc(u))),
    db.collection('altDetection').doc('state').get(),
    ...uids.map(async (uid) => {
      const trades = await db.collection('trades').where('uid', '==', uid).select('ip').limit(TRADES_PER_ACCOUNT).get();
      trades.forEach((t) => add(uid, networkKey(t.data().ip)));
    }),
  ]);

  const createdAt = new Map<string, number | null>();
  for (const u of users) {
    if (!u.exists) continue;
    add(u.id, networkKey(unsanitizeIp(u.data()!.signupIp)));
    createdAt.set(u.id, millis(u.data()!.createdAt));
  }
  const linked = new Map<string, string[]>();
  for (const w of watched) {
    if (w.exists)
      linked.set(
        w.id,
        ((w.data()!.linkedAccounts || []) as { uid?: string }[]).map((a) => a.uid || ''),
      );
  }
  const altPairs: Record<string, unknown> = (altState.exists ? altState.data()!.pairs : null) || {};

  const entries = gifts.map((g) => {
    const from = networks.get(g.fromUid)!;
    const shared = [...networks.get(g.toUid)!].filter((n) => from.has(n)).length;
    const flags: string[] = [];
    if (shared) flags.push(`Same connection (${shared})`);
    const pair = [g.fromUid, g.toUid].sort().join('|');
    if (altPairs[pair.replace(/[./]/g, '_')]) flags.push('Alt scan pair');
    if (linked.get(g.fromUid)?.includes(g.toUid) || linked.get(g.toUid)?.includes(g.fromUid)) {
      flags.push('Linked on watchlist');
    }
    const born = createdAt.get(g.toUid);
    if (born && g.at - born < NEW_ACCOUNT_MS) flags.push('New account');
    if (!users.find((u) => u.id === g.toUid)?.exists) flags.push('Account deleted');
    return {
      id: g.id,
      at: g.at ?? null,
      fromUid: g.fromUid,
      fromName: g.fromName || null,
      toUid: g.toUid,
      toName: g.toName || null,
      itemName: g.itemName || g.itemId,
      price: g.price ?? 0,
      value: g.value ?? 0,
      flags,
    };
  });

  return { success: true, entries };
});
