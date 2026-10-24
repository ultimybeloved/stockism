// Give every unnamed account a real name, plus one free name change so the
// player can swap it for their own pick. Unnamed means no displayName at all
// (early Discord signups saved none) or a placeholder like "User".
//
// Name order: the player's Discord username, their Discord display name, the
// name on their Discord login, else a random investing name (placeholderNames).
// A dry run (the default) returns the plan without writing anything.
import { cf, requireAdmin } from '../shared/fnConfig';
import * as admin from 'firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import { discordApi } from '../shared/discordApi';
import { writeNotification } from '../shared/notifications';
import { logAdminAction } from '../shared/adminLog';
import { needsName, pickName, seededRandom } from './placeholderNames';
const db = admin.firestore();

interface NamePlan {
  uid: string;
  from: string | null;
  to: string;
  source: 'discord' | 'random';
}

/** What Discord and the login record call this player, best first. */
async function discordCandidates(uid: string, discordId: string | undefined): Promise<(string | null)[]> {
  const out: (string | null)[] = [];
  if (discordId) {
    const res = await discordApi('get', `/users/${discordId}`);
    if (res.status === 200) {
      const d = res.data as { username?: string; global_name?: string | null };
      out.push(d.username || null, d.global_name || null);
    }
  }
  // Discord logins have no provider entries; their Auth name is the Discord
  // username from signup. Google accounts carry a Google name, which isn't one.
  const auth = await admin
    .auth()
    .getUser(uid)
    .catch(() => null);
  if (auth && auth.providerData.length === 0) out.push(auth.displayName || null);
  return out;
}

export const adminNameUnnamed = cf({ timeoutSeconds: 300 }).https.onCall(
  async (data: { dryRun?: unknown } | null, context) => {
    requireAdmin(context);
    const dryRun = data?.dryRun !== false;

    const snap = await db.collection('users').select('displayName', 'discordId', 'isBot', 'isBanned').get();
    const unnamed = snap.docs.filter((d) => {
      const u = d.data();
      return !u.isBot && !u.isBanned && needsName(u.displayName);
    });

    // Names handed out in this run count as taken, so two players can't get one.
    const claimed = new Set<string>();
    const taken = async (lower: string) =>
      claimed.has(lower) || (await db.collection('usernames').doc(lower).get()).exists;

    const plan: NamePlan[] = [];
    for (const d of unnamed) {
      const u = d.data();
      // Seeded by uid, so the preview and the real run pick the same random name.
      const picked = await pickName(await discordCandidates(d.id, u.discordId), taken, seededRandom(d.id));
      claimed.add(picked.name.toLowerCase());
      const from = typeof u.displayName === 'string' ? u.displayName : null;
      plan.push({ uid: d.id, from, to: picked.name, source: picked.source });
    }
    if (dryRun) return { dryRun: true, plan, applied: 0, skipped: [] };

    let applied = 0;
    const skipped: { uid: string; reason: string }[] = [];
    for (const p of plan) {
      const userRef = db.collection('users').doc(p.uid);
      const lower = p.to.toLowerCase();
      const nameRef = db.collection('usernames').doc(lower);
      try {
        await db.runTransaction(async (tx) => {
          const [userDoc, nameDoc] = await Promise.all([tx.get(userRef), tx.get(nameRef)]);
          if (!userDoc.exists || !needsName(userDoc.data()!.displayName)) throw new Error('already named');
          if (nameDoc.exists) throw new Error(`${p.to} was taken`);
          // A placeholder's reservation ("user", "anonymous") stays put so
          // nobody else can take the name and look like a missing one.
          tx.set(nameRef, { uid: p.uid, createdAt: FieldValue.serverTimestamp() });
          tx.update(userRef, {
            displayName: p.to,
            displayNameLower: lower,
            previousDisplayName: p.from,
            freeNameChanges: FieldValue.increment(1),
          });
        });
      } catch (err) {
        skipped.push({ uid: p.uid, reason: (err as Error).message });
        continue;
      }
      applied++;
      await writeNotification(p.uid, {
        type: 'system',
        title: 'You have a name now',
        message: `Your account had no name, so we called you ${p.to}. Your next name change is free. Change it on your profile.`,
      });
      await logAdminAction(context, { action: 'rename', uid: p.uid, name: p.to, before: p.from, after: p.to });
    }
    return { dryRun: false, plan, applied, skipped };
  },
);
