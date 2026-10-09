// The weekly crew rankings: active-member counts, underdog multipliers, crew
// head rotation (and its Discord role), and the Discord post. Split out of
// marketWeekly.ts. INTERNAL MODULE: exports no Cloud Functions.
import * as admin from 'firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import { TWENTY_FOUR_HOURS_MS, CREWS, CREW_UNDERDOG_MULT_MAX, CREW_HEAD_DYNASTY_WEEKS } from '../shared/constants';
import { writeNotification } from '../shared/notifications';
import { sendDiscordMessage, crewEmoji } from '../shared/discordApi';
import { getWeekId } from '../shared/tradeRecords';
import { reportError } from '../shared/sentry';
import { syncCrewHeadRoles, preflightCrewRoles } from '../discord/discordRoles';
import type { DocumentData } from 'firebase-admin/firestore';
import * as logger from 'firebase-functions/logger';
const db = admin.firestore();

/** One player's line in a crew's weekly ranking. */
export interface CrewMember {
  uid: string;
  username: string;
  portfolioValue: number;
  gain: number;
  active: boolean;
  discordId: string | null;
  isBankrupt: boolean;
  wasHead: boolean;
  headStreak: number;
  achievements: string[];
}

export interface CrewTally {
  id: string;
  name: string;
  emblem: string;
  members: CrewMember[];
  activeCount: number;
  totalValue: number;
  weeklyGain: number;
  activeGain: number;
}
/**
 * Weekly Crew Rankings - Runs Mondays at 01:30 UTC
 *
 * Two jobs:
 * 1. Compute each crew's active-player count for the week that just ended and
 *    derive the underdog reward multiplier for the new week. Written to the
 *    public market/crewStats doc, which every mission claim path reads.
 * 2. Post the Discord rankings, ranked by average weekly gain per ACTIVE
 *    member so small crews compete on equal footing with big ones.
 *
 * "Active" = made a trade, claimed any mission, or checked in during the week.
 * Counting claims and check-ins (not just trades) stops a crew from farming a
 * high multiplier by holding positions and claiming composition missions
 * without ever showing up in trade counts.
 */
export async function runWeeklyCrewRankings({ postToDiscord = true } = {}) {
  const usersSnapshot = await db.collection('users').get();

  if (usersSnapshot.empty) {
    logger.info('No users found');
    return null;
  }

  // The week that just ended (this runs Monday 01:30 UTC, so 48h back
  // lands safely inside last week).
  const prevWeekId = getWeekId(new Date(Date.now() - 2 * TWENTY_FOUR_HOURS_MS));
  const prevWeekDates = [...Array(7)].map((_, i) => {
    const d = new Date(`${prevWeekId}T00:00:00Z`); // prevWeekId is that Monday
    d.setUTCDate(d.getUTCDate() + i);
    return d.toISOString().split('T')[0]!;
  });

  const wasActiveLastWeek = (user: DocumentData) => {
    const wm = user.weeklyMissions?.[prevWeekId];
    if (wm) {
      if ((wm.tradeCount || 0) > 0) return true;
      if (wm.claimed && Object.keys(wm.claimed).length > 0) return true;
      if (wm.checkinDays && Object.keys(wm.checkinDays).length > 0) return true;
    }
    return prevWeekDates.some((date) => {
      const dm = user.dailyMissions?.[date];
      return dm && dm.claimed && Object.keys(dm.claimed).length > 0;
    });
  };

  const crews: Record<string, CrewTally> = {};
  Object.values(CREWS).forEach((c) => {
    crews[c.id] = {
      id: c.id,
      name: c.name,
      emblem: c.emblem,
      members: [],
      activeCount: 0,
      totalValue: 0,
      weeklyGain: 0,
      activeGain: 0,
    };
  });

  // Users flagged as crew head who no longer belong to a (valid) crew —
  // their crown is stale and gets cleared in the rotation below.
  const staleHeads: string[] = [];

  usersSnapshot.forEach((doc) => {
    const user = doc.data()!;
    const crew = user.crew;

    // Bots and banned accounts are excluded from all user-facing rankings
    if (!user.isBot && !user.isBanned && crew && crews[crew]) {
      const portfolioValue = user.portfolioValue || user.cash || 0;
      // Weekly gain from the rolling 7-day reference snapshot
      // (portfolio history lives in a subcollection now, not on the doc)
      const snap7d = user.portfolioSnapshot7d;
      const baseline = snap7d && snap7d.value > 0 ? snap7d.value : 0;
      const gain = baseline > 0 ? portfolioValue - baseline : 0;
      const active = wasActiveLastWeek(user);

      const c = crews[crew]!;
      c.members.push({
        uid: doc.id,
        username: user.displayName,
        portfolioValue,
        gain,
        active,
        // Only ever used to hand out the crew head Discord role. MUST NOT
        // reach market/crewStats — that doc is world-readable.
        discordId: user.discordId || null,
        isBankrupt: !!user.isBankrupt,
        wasHead: !!user.isCrewHead,
        headStreak: user.crewHeadStreak || 0,
        achievements: Array.isArray(user.achievements) ? user.achievements : [],
      });
      c.totalValue += portfolioValue;
      c.weeklyGain += gain;
      if (active) {
        c.activeCount += 1;
        c.activeGain += gain;
      }
    } else if (user.isCrewHead && !user.isBot) {
      staleHeads.push(doc.id);
    }
  });

  // Underdog multipliers for the new week: the most active crew gets 1x,
  // an empty crew gets CREW_UNDERDOG_MULT_MAX, everyone else in between.
  const maxActive = Math.max(1, ...Object.values(crews).map((c) => c.activeCount));
  const multipliers: Record<string, number> = {};
  const activeCounts: Record<string, number> = {};
  const memberCounts: Record<string, number> = {};
  Object.values(crews).forEach((c) => {
    activeCounts[c.id] = c.activeCount;
    memberCounts[c.id] = c.members.length;
    const raw = 1 + ((maxActive - c.activeCount) / maxActive) * (CREW_UNDERDOG_MULT_MAX - 1);
    multipliers[c.id] = Math.round(Math.min(CREW_UNDERDOG_MULT_MAX, Math.max(1, raw)) * 100) / 100;
  });

  // ── Crew head rotation ("top dog") ─────────────────────────────────
  // The crown goes to the crew member with the biggest PORTFOLIO among
  // last week's active members. Staying active is still required, so a
  // dormant account can't sit on the crown forever. No eligible member =
  // vacant crown that week.
  const heads: Record<string, { uid: string; displayName?: string | null; portfolioValue: number }> = {}; // crewId -> { uid, displayName, portfolioValue }
  // Kept SEPARATE from `heads` on purpose: `heads` is written verbatim to
  // market/crewStats, which anyone can read. Discord IDs stay private.
  const headDiscordIds: Record<string, string | null> = {}; // crewId -> discordId | null
  const userUpdates: {
    uid: string;
    update: Record<string, unknown>;
    note: Parameters<typeof writeNotification>[1] | null;
  }[] = []; // [{ uid, update, note }]
  Object.values(crews).forEach((c) => {
    const prevHead = c.members.find((m) => m.wasHead) || null;
    const eligible = c.members.filter((m) => m.active && !m.isBankrupt);
    const winner =
      eligible.length > 0
        ? eligible.reduce((best: CrewMember, m) => (m.portfolioValue > best.portfolioValue ? m : best))
        : null;

    if (winner) {
      const kept = prevHead && prevHead.uid === winner.uid;
      const newStreak = kept ? prevHead.headStreak + 1 : 1;
      heads[c.id] = {
        uid: winner.uid,
        displayName: winner.username || 'Anonymous',
        portfolioValue: Math.round(winner.portfolioValue * 100) / 100,
      };
      headDiscordIds[c.id] = winner.discordId || null;

      const newAch = [];
      if (!winner.achievements.includes('CROWNED')) newAch.push('CROWNED');
      if (newStreak >= CREW_HEAD_DYNASTY_WEEKS && !winner.achievements.includes('DYNASTY')) newAch.push('DYNASTY');
      if (
        !kept &&
        prevHead &&
        prevHead.headStreak >= CREW_HEAD_DYNASTY_WEEKS &&
        !winner.achievements.includes('USURPER')
      )
        newAch.push('USURPER');

      const update: Record<string, unknown> = { isCrewHead: true, crewHeadStreak: newStreak };
      if (newAch.length > 0) update.achievements = FieldValue.arrayUnion(...newAch);
      userUpdates.push({
        uid: winner.uid,
        update,
        note: {
          type: 'system',
          title: `🔱 Crew Head of ${c.name}`,
          message: kept
            ? `You kept the crown. ${newStreak} weeks running.`
            : `Biggest portfolio in your crew. The crown is yours.`,
        },
      });

      if (prevHead && !kept) {
        userUpdates.push({
          uid: prevHead.uid,
          update: { isCrewHead: false, crewHeadStreak: 0 },
          note: {
            type: 'system',
            title: 'Crown lost',
            message: `${winner.username || 'A crewmate'} now has the biggest portfolio in ${c.name}.`,
          },
        });
      }
    } else if (prevHead) {
      // Vacant week: nobody qualified, the old crown comes off quietly.
      userUpdates.push({ uid: prevHead.uid, update: { isCrewHead: false, crewHeadStreak: 0 }, note: null });
    }
  });
  staleHeads.forEach((uid) => {
    userUpdates.push({ uid, update: { isCrewHead: false, crewHeadStreak: 0 }, note: null });
  });

  // Write the stats doc BEFORE the Discord send so a webhook failure
  // can't leave the week without multipliers.
  await db.collection('market').doc('crewStats').set({
    weekId: getWeekId(), // the week these multipliers apply to
    basedOnWeekId: prevWeekId, // the activity week they were computed from
    computedAt: Date.now(),
    activeCounts,
    memberCounts,
    multipliers,
    heads,
  });

  // Apply crown updates. Isolated so one bad user doc can't take down
  // the multipliers (already written) or the Discord post.
  for (const { uid, update, note } of userUpdates) {
    try {
      await db.collection('users').doc(uid).update(update);
      if (note) await writeNotification(uid, note);
    } catch (err) {
      logger.error(`Crew head update failed for ${uid}:`, (err as Error).message);
    }
  }

  // Rank by average weekly gain per active member; crews with no active
  // members sink to the bottom.
  const sortedCrews = Object.values(crews)
    .filter((c) => c.members.length > 0)
    .map((c) => ({ ...c, avgActiveGain: c.activeCount > 0 ? c.activeGain / c.activeCount : null }))
    .sort((a, b) => {
      if (a.avgActiveGain === null && b.avgActiveGain === null) return b.totalValue - a.totalValue;
      if (a.avgActiveGain === null) return 1;
      if (b.avgActiveGain === null) return -1;
      return b.avgActiveGain - a.avgActiveGain;
    });

  const fmtMoney = (n: number) =>
    `${n < 0 ? '-' : '+'}$${Math.abs(n).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;

  const fields = sortedCrews.map((crew, idx) => {
    const topGainers = crew.members
      .filter((m) => m.active)
      .sort((a, b) => b.gain - a.gain)
      .slice(0, 3);
    const gainersText =
      topGainers.length > 0
        ? topGainers.map((m, i) => `${i + 1}. ${m.username} ${fmtMoney(m.gain)}`).join('\n')
        : 'No active members this week';

    const avgText = crew.avgActiveGain === null ? 'n/a' : fmtMoney(crew.avgActiveGain);
    const mult = multipliers[crew.id];
    const head = heads[crew.id];
    const headText = head
      ? `🔱 ${head.displayName} ($${head.portfolioValue.toLocaleString(undefined, { maximumFractionDigits: 0 })})`
      : 'Vacant';

    return {
      name: `${idx + 1}. ${crewEmoji(crew.id)} ${crew.name}`,
      value:
        `**Crew Head:** ${headText}\n` +
        `**Active Members:** ${crew.activeCount} of ${crew.members.length}\n` +
        `**Avg Gain per Active Member:** ${avgText}\n` +
        `**Crew Weekly Gain:** ${fmtMoney(crew.weeklyGain)}\n` +
        `**Total Value:** $${crew.totalValue.toLocaleString(undefined, { maximumFractionDigits: 2 })}\n` +
        `**Reward Bonus This Week:** x${mult}${mult! > 1 ? ' 🔥' : ''}\n\n` +
        `**Top Gainers:**\n${gainersText}`,
      inline: false,
    };
  });

  const embed = {
    color: 0x5865f2, // Discord blurple
    title: '⚔️ Weekly Crew Rankings',
    description:
      '*Crews ranked by average weekly gain per active member. Less active crews get a mission reward bonus this week. Join one and cash in. The biggest active portfolio in each crew takes the crown.*',
    fields: fields,
    footer: {
      text: 'Reward bonus applies to daily, weekly, and crew mission payouts. It recalculates every Monday from crew activity.',
    },
    timestamp: new Date().toISOString(),
  };

  if (postToDiscord) {
    await sendDiscordMessage(null, [embed]);
    logger.info('Weekly crew rankings sent');
  }

  // Crew head Discord roles. Deliberately LAST: multipliers, crowns,
  // achievements, notifications and the announcement are all committed
  // before a single Discord role call is made, so a Discord outage can
  // never cost a player a payout. The sync also diffs against its own
  // stored state, not against this run, so a skipped or failed week
  // simply self-heals on the next one.
  let roleSync = null;
  if (postToDiscord) {
    try {
      roleSync = await syncCrewHeadRoles({ heads, discordIds: headDiscordIds, weekId: getWeekId() });
    } catch (err) {
      reportError(err, { where: 'runWeeklyCrewRankings.syncCrewHeadRoles' });
    }
  }
  return { multipliers, activeCounts, memberCounts, roleSync };
}
/**
 * Re-hand the crew head Discord roles from the CURRENT market/crewStats,
 * without recomputing anything. Used by the admin buttons so setup can be
 * checked and fixed without waiting for Monday.
 */
export async function runCrewRoleSyncOnly({ dryRun = false } = {}) {
  if (dryRun) return preflightCrewRoles();

  const statsSnap = await db.collection('market').doc('crewStats').get();
  const stats = statsSnap.exists ? statsSnap.data() || {} : {};
  const heads: Record<string, { uid: string } | null> = stats.heads || {};

  // At most 10 docs (one per crew), so a single getAll beats ten reads.
  const entries = Object.entries(heads).filter(([, h]) => h && h.uid);
  const discordIds: Record<string, string | null> = {};
  if (entries.length > 0) {
    const docs = await db.getAll(...entries.map(([, h]) => db.collection('users').doc(h!.uid)));
    entries.forEach(([crewId], i) => {
      discordIds[crewId] = docs[i]!.exists ? docs[i]!.data()!.discordId || null : null;
    });
  }
  return syncCrewHeadRoles({ heads, discordIds, weekId: stats.weekId || getWeekId() });
}
