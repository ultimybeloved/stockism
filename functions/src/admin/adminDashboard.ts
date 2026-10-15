// Read-only views for the admin command panel: the home dashboard, the
// welcome week tracker and Discord activity. Nothing here writes player data.
//
// Counts use aggregation queries (one read per 1,000 matches) instead of
// loading the users collection, so the home screen stays cheap to open.
import * as admin from 'firebase-admin';
import { Filter, Timestamp } from 'firebase-admin/firestore';
import { cf, requireAdmin } from '../shared/fnConfig';
import { HEARTBEAT_DOC } from '../shared/activity';
import { WATCHED_SCHEDULED_JOBS } from '../shared/constants';
import { DISCORD_GUILD_ID } from '../shared/constants/discord';
import { discordApi } from '../shared/discordApi';
import { utcDay } from '../shared/rules/ledgerFlow';
import { WELCOME_STREAK_DAYS, WELCOME_STREAK_REWARDS } from '../shared/rules/welcome';
import { ledgerDay } from './adminMoneyFlow';
import { toPlain } from './adminPlayerFile';

const db = admin.firestore();
const HOUR = 3600000;
const DAY = 24 * HOUR;

const count = async (q: admin.firestore.Query) => {
  try {
    return (await q.count().get()).data().count;
  } catch {
    return null;
  }
};

const users = () => db.collection('users');

// "Active" the way the rest of the site counts it (rules/activity): opened the
// app (lastSynced) or made any move (lastActive). Both are milliseconds.
const activeSince = async (since: number) =>
  (await count(
    users().where(Filter.or(Filter.where('lastSynced', '>=', since), Filter.where('lastActive', '>=', since))),
  )) ?? count(users().where('lastActive', '>=', since));

/** Admin-only: the numbers on the panel's home screen. */
export const adminDashboard = cf({ memory: '512MB' }).https.onCall(async (_data, context) => {
  requireAdmin(context);
  const now = Date.now();
  const since = (ms: number) => Timestamp.fromMillis(now - ms);

  const [
    totalPlayers,
    signups24h,
    signups7d,
    active24h,
    active7d,
    linked,
    banned,
    welcomeStarted,
    welcomeDone,
    openAlerts,
    heartbeats,
    today,
    newest,
  ] = await Promise.all([
    count(users()),
    count(users().where('createdAt', '>=', since(DAY))),
    count(users().where('createdAt', '>=', since(7 * DAY))),
    activeSince(now - DAY),
    activeSince(now - 7 * DAY),
    count(users().where('discordId', '!=', null)),
    count(users().where('isBanned', '==', true)),
    count(db.collection('welcomeStreaks')),
    count(db.collection('welcomeStreaks').where('day', '>=', WELCOME_STREAK_DAYS)),
    count(db.collection('watchlist_alerts').where('reviewed', '==', false)),
    HEARTBEAT_DOC()
      .get()
      .then((s) => (s.data() || {}) as Record<string, number>)
      .catch(() => ({}) as Record<string, number>),
    ledgerDay(utcDay(now)).catch(() => null),
    users()
      .orderBy('createdAt', 'desc')
      .limit(12)
      .select('displayName', 'createdAt', 'discordId', 'isBanned')
      .get()
      .then((s) => s.docs.map((d) => ({ uid: d.id, ...(toPlain(d.data()) as object) })))
      .catch(() => []),
  ]);

  const jobs = WATCHED_SCHEDULED_JOBS.map((j) => {
    const last = heartbeats[j.job] || null;
    const watchedSince = (j as { watchedSince?: number }).watchedSince || 0;
    const late = last ? now - last > j.maxAgeHours * HOUR : now > watchedSince + j.maxAgeHours * HOUR;
    return { job: j.job, label: j.label, last, maxAgeHours: j.maxAgeHours, late };
  });

  return {
    generatedAt: now,
    players: { total: totalPlayers, signups24h, signups7d, active24h, active7d, linked, banned },
    welcome: { started: welcomeStarted, done: welcomeDone },
    alerts: { open: openAlerts },
    jobs,
    today,
    newest,
  };
});

/** Admin-only: everyone who has started the /welcome week. */
export const adminWelcomeTracker = cf({ memory: '512MB' }).https.onCall(async (_data, context) => {
  requireAdmin(context);
  const now = Date.now();
  const today = utcDay(now);
  const yesterday = utcDay(now - DAY);
  const [snap, linked] = await Promise.all([
    db.collection('welcomeStreaks').get(),
    count(users().where('discordId', '!=', null)),
  ]);

  const uids = [...new Set(snap.docs.map((d) => d.data().uid).filter(Boolean))] as string[];
  const names: Record<string, { displayName?: string; discordUsername?: string; isBanned?: boolean }> = {};
  for (let i = 0; i < uids.length; i += 300) {
    const refs = uids.slice(i, i + 300).map((u) => users().doc(u));
    const got = refs.length
      ? await db.getAll(...refs, { fieldMask: ['displayName', 'discordUsername', 'isBanned'] })
      : [];
    for (const s of got) if (s.exists) names[s.id] = s.data() as (typeof names)[string];
  }

  const rows = snap.docs.map((d) => {
    const s = d.data();
    const day = Number(s.day) || 0;
    const done = day >= WELCOME_STREAK_DAYS;
    const status = done
      ? 'done'
      : s.lastClaimDay === today
        ? 'claimed_today'
        : s.lastClaimDay === yesterday
          ? 'due_today'
          : 'paused';
    const who = names[s.uid] || {};
    return {
      discordId: d.id,
      uid: s.uid || null,
      displayName: who.displayName || null,
      discordUsername: who.discordUsername || null,
      isBanned: !!who.isBanned,
      day,
      lastClaimDay: s.lastClaimDay || null,
      completedAt: s.completedAt || null,
      startedAt: d.createTime?.toMillis() || null,
      paid: WELCOME_STREAK_REWARDS.slice(0, day).reduce((sum, r) => sum + r, 0),
      status,
    };
  });

  return { rows, linked, days: WELCOME_STREAK_DAYS, rewards: WELCOME_STREAK_REWARDS, generatedAt: now };
});

interface GuildMember {
  user?: { id: string; username?: string; global_name?: string | null; bot?: boolean };
  joined_at?: string;
}

// Every member of the official server, when the bot is allowed to list them
// (the Server Members Intent in the Discord developer portal). null if not.
async function guildMembers(): Promise<GuildMember[] | null> {
  const out: GuildMember[] = [];
  let after = '0';
  for (let page = 0; page < 20; page++) {
    const res = await discordApi('get', `/guilds/${DISCORD_GUILD_ID}/members?limit=1000&after=${after}`);
    if (res.status !== 200 || !Array.isArray(res.data)) return page === 0 ? null : out;
    const batch = res.data as GuildMember[];
    out.push(...batch);
    if (batch.length < 1000) break;
    after = batch[batch.length - 1]!.user!.id;
  }
  return out;
}

/** Admin-only: who uses the bot, and who in the server never linked an account. */
export const adminDiscordActivity = cf({ memory: '512MB' }).https.onCall(async (_data, context) => {
  requireAdmin(context);
  const [activitySnap, linkedSnap, members] = await Promise.all([
    db.collection('discordActivity').get(),
    users().where('discordId', '!=', null).select('discordId', 'displayName').get(),
    guildMembers().catch(() => null),
  ]);

  const byDiscord: Record<string, { uid: string; displayName: string | null }> = {};
  for (const d of linkedSnap.docs) {
    const v = d.data();
    byDiscord[String(v.discordId)] = { uid: d.id, displayName: v.displayName || null };
  }

  const activity = activitySnap.docs.map((d) => ({
    ...(toPlain(d.data()) as Record<string, unknown>),
    discordId: d.id,
    firstAt: d.createTime?.toMillis() || null,
    linked: byDiscord[d.id] || null,
  }));

  const unlinked = members
    ? members
        .filter((m) => m.user && !m.user.bot && !byDiscord[m.user.id])
        .map((m) => ({
          discordId: m.user!.id,
          username: m.user!.username || null,
          globalName: m.user!.global_name || null,
          joinedAt: m.joined_at ? Date.parse(m.joined_at) : null,
        }))
    : null;

  return {
    activity,
    unlinked,
    memberCount: members ? members.filter((m) => !m.user?.bot).length : null,
    linkedCount: linkedSnap.size,
    generatedAt: Date.now(),
  };
});
