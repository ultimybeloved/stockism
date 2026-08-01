'use strict';

// Crew head Discord roles. Internal module — required directly by
// marketWeekly.js and deliberately NOT listed in servicePaths.js (it exports
// no Cloud Functions).
//
// See the DISCORD CREW HEAD ROLES block in constants.js for the setup rules.
// The short version: the bot only ADDS and REMOVES role assignments, never
// creates or edits roles, and it only knows about assignments it made itself
// (tracked in admin/discordCrewRoles) so it never needs the privileged Guild
// Members intent to list who has what.

const admin = require('firebase-admin');
const db = admin.firestore();

const { discordApi, reportError, sendDiscordMessage } = require('../helpers');
const {
  CREWS,
  DISCORD_GUILD_ID,
  CREW_HEAD_ROLE_IDS,
  DISCORD_SNOWFLAKE_PATTERN,
  DISCORD_ROLE_CALL_SPACING_MS,
  DISCORD_ROLE_SYNC_BUDGET_MS,
  DISCORD_ROLE_RETRY_MAX_MS,
} = require('../constants');

const STATE_DOC = () => db.collection('admin').doc('discordCrewRoles');

// Discord JSON error codes we treat as "they demonstrably do not hold it".
const UNKNOWN_MEMBER = 10007;
const UNKNOWN_ROLE = 10011;
const UNKNOWN_GUILD = 10004;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const crewIds = () => Object.keys(CREWS);
const validId = (id) => typeof id === 'string' && DISCORD_SNOWFLAKE_PATTERN.test(id);
const crewName = (crewId) => (CREWS[crewId] && CREWS[crewId].name) || crewId;

const memberRolePath = (discordId, roleId) =>
  `/guilds/${DISCORD_GUILD_ID}/members/${discordId}/roles/${roleId}`;

/** True when nothing is configured yet, so the whole feature no-ops. */
function isConfigured() {
  if (!process.env.DISCORD_BOT_TOKEN) return false;
  if (!validId(DISCORD_GUILD_ID)) return false;
  return crewIds().some((id) => validId(CREW_HEAD_ROLE_IDS[id]));
}

/**
 * Read the guild's roles and check the setup that silently breaks everything:
 * a role ID that does not exist, and the bot's own role sitting below the crew
 * roles (Discord refuses to assign any role above its own, with a 403 that
 * looks identical to a permissions problem).
 *
 * Uses GET /guilds/{id}/roles, which needs no privileged intent.
 */
async function preflightCrewRoles() {
  if (!isConfigured()) {
    return { configured: false, problems: ['Guild ID or crew role IDs are not set yet.'] };
  }

  const problems = [];
  let res;
  try {
    res = await discordApi('get', `/guilds/${DISCORD_GUILD_ID}/roles`);
  } catch (err) {
    return { configured: true, ok: false, problems: [`Could not reach Discord: ${err.message}`] };
  }

  if (res.status !== 200) {
    const msg = (res.data && res.data.message) || '';
    return {
      configured: true,
      ok: false,
      problems: [`Discord rejected the role lookup (status ${res.status} ${msg}). Check the bot is in the server.`],
    };
  }

  const roles = Array.isArray(res.data) ? res.data : [];
  const byId = new Map(roles.map((r) => [r.id, r]));

  // The bot's own managed role carries tags.bot_id. Its position is the
  // ceiling for everything the bot is allowed to hand out.
  const botRole = roles.find((r) => r.tags && r.tags.bot_id);
  const botPosition = botRole ? botRole.position : null;
  if (!botRole) {
    problems.push("Could not find the bot's own role in this server. Is the bot actually a member?");
  }

  for (const crewId of crewIds()) {
    const roleId = CREW_HEAD_ROLE_IDS[crewId];
    if (!roleId) continue;
    if (!validId(roleId)) {
      problems.push(`${crewName(crewId)}: role ID "${roleId}" is not a valid Discord ID. Re-copy it.`);
      continue;
    }
    const role = byId.get(roleId);
    if (!role) {
      problems.push(`${crewName(crewId)}: no role with that ID exists in this server. It may have been deleted.`);
      continue;
    }
    if (botPosition !== null && role.position >= botPosition) {
      problems.push(`${crewName(crewId)}: "${role.name}" sits above the bot's role. Drag the bot's role higher in Server Settings > Roles.`);
    }
  }

  const configuredCount = crewIds().filter((id) => validId(CREW_HEAD_ROLE_IDS[id])).length;
  return { configured: true, ok: problems.length === 0, configuredCount, problems };
}

/**
 * One role write, with the retries that are worth making.
 * Returns { ok, done, fatal, detail } where:
 *   ok    - the call succeeded (204)
 *   done  - the desired end state is true even though it wasn't a 204
 *           (removing a role from someone who already lost it / a dead role)
 *   fatal - every remaining call will fail the same way, so stop the run
 */
async function roleCall(method, discordId, roleId, reason) {
  for (let attempt = 0; attempt < 2; attempt++) {
    let res;
    try {
      res = await discordApi(method, memberRolePath(discordId, roleId), { reason });
    } catch (err) {
      // Network/timeout only. Leave stored state untouched so the next run retries.
      if (attempt === 0) { await sleep(DISCORD_ROLE_CALL_SPACING_MS); continue; }
      return { ok: false, detail: `network error: ${err.message}` };
    }

    if (res.status === 204 || res.status === 201 || res.status === 200) return { ok: true };

    const code = res.data && res.data.code;
    const msg = (res.data && res.data.message) || '';

    if (res.status === 404) {
      // Member left the server, or the role is gone. Either way they do not
      // hold it — that is success for a removal and a no-op for an add.
      const known = code === UNKNOWN_MEMBER || code === UNKNOWN_ROLE || code === UNKNOWN_GUILD;
      return { ok: false, done: method === 'delete' && known, notFound: true, code, detail: msg };
    }

    if (res.status === 401 || res.status === 403) {
      return { ok: false, fatal: true, detail: `${res.status} ${msg}` };
    }

    if (res.status === 429) {
      const retryMs = Math.round(((res.data && res.data.retry_after) || 1) * 1000);
      const global = (res.data && res.data.global) || res.headers?.['x-ratelimit-scope'] === 'global';
      if (global) return { ok: false, fatal: true, detail: 'globally rate limited' };
      if (attempt === 0 && retryMs <= DISCORD_ROLE_RETRY_MAX_MS) { await sleep(retryMs); continue; }
      return { ok: false, detail: `rate limited (retry_after ${retryMs}ms)` };
    }

    if (res.status >= 500) {
      if (attempt === 0) { await sleep(DISCORD_ROLE_CALL_SPACING_MS); continue; }
      return { ok: false, detail: `Discord ${res.status}` };
    }

    return { ok: false, detail: `unexpected status ${res.status} ${msg}` };
  }
  return { ok: false, detail: 'exhausted retries' };
}

/**
 * Give each crew's current head their crew role and take it off the previous
 * holder. Never throws.
 *
 * @param {Object} opts.heads       crewId -> { uid, displayName } (from runWeeklyCrewRankings)
 * @param {Object} opts.discordIds  crewId -> discordId | null (NEVER goes in a market/ doc)
 * @param {string} opts.weekId
 * @param {boolean} opts.dryRun     plan only: no Discord calls, no writes
 */
async function syncCrewHeadRoles({ heads = {}, discordIds = {}, weekId = null, dryRun = false } = {}) {
  try {
    if (!isConfigured()) {
      console.log('Crew head roles: not configured, skipping');
      return { configured: false };
    }

    const snap = await STATE_DOC().get();
    const prev = snap.exists ? (snap.data() || {}) : {};
    // A different guild means every stored assignment refers to a server we no
    // longer act on. Drop them rather than firing DELETEs into the void.
    const stale = prev.guildId && prev.guildId !== DISCORD_GUILD_ID;
    const prevHolders = stale ? {} : (prev.holders || {});

    const holders = {};
    const pending = {};
    const problems = [];
    const plan = [];
    let added = 0, removed = 0, skipped = 0, failed = 0, stoppedEarly = false;

    // Plan first, so a dry run reports exactly what a real run would do.
    for (const crewId of crewIds()) {
      const roleId = CREW_HEAD_ROLE_IDS[crewId];
      const held = prevHolders[crewId] || null;

      if (!roleId) { holders[crewId] = held; skipped++; continue; }
      if (!validId(roleId)) {
        // Skip entirely: removing without being able to re-add would strip a
        // legitimate head off the back of a typo.
        problems.push(`${crewName(crewId)}: role ID is not a valid Discord ID`);
        holders[crewId] = held;
        skipped++;
        continue;
      }

      const head = heads[crewId] || null;
      const discordId = head ? (discordIds[crewId] || null) : null;

      if (head && !discordId) {
        pending[crewId] = { uid: head.uid, reason: 'no-discord-link' };
      }
      if (held && (!discordId || held.discordId !== discordId)) {
        plan.push({ crewId, op: 'delete', discordId: held.discordId, roleId: held.roleId || roleId });
      }
      if (discordId) {
        // Re-asserted even when unchanged: PUT is idempotent, and it silently
        // repairs a role somebody removed by hand during the week.
        plan.push({ crewId, op: 'put', discordId, roleId, head });
      }
      holders[crewId] = held;
    }

    if (dryRun) {
      return { configured: true, dryRun: true, planned: plan.length, plan, problems };
    }

    const startedAt = Date.now();
    for (const step of plan) {
      if (stoppedEarly) break;
      if (Date.now() - startedAt > DISCORD_ROLE_SYNC_BUDGET_MS) {
        stoppedEarly = true;
        problems.push('Ran out of time before finishing every crew.');
        break;
      }

      const reason = step.op === 'put'
        ? `Crew head of ${crewName(step.crewId)} for week ${weekId || 'current'}`
        : `No longer crew head of ${crewName(step.crewId)}`;
      const result = await roleCall(step.op, step.discordId, step.roleId, reason);
      await sleep(DISCORD_ROLE_CALL_SPACING_MS);

      if (result.fatal) {
        stoppedEarly = true;
        problems.push(`Discord refused the call (${result.detail}). Check the bot has Manage Roles and that its role sits above the crew head roles.`);
        break;
      }

      if (step.op === 'delete') {
        if (result.ok || result.done) { holders[step.crewId] = null; removed++; }
        else { failed++; problems.push(`${crewName(step.crewId)}: could not remove old role (${result.detail})`); }
        continue;
      }

      if (result.ok) {
        holders[step.crewId] = {
          discordId: step.discordId,
          uid: step.head.uid,
          roleId: step.roleId,
          displayName: step.head.displayName || null,
          assignedAt: Date.now(),
        };
        added++;
      } else if (result.notFound) {
        // Normal and expected: the head simply isn't in the Discord server.
        // Must not page anyone every Monday.
        pending[step.crewId] = { uid: step.head.uid, reason: 'not-in-server' };
        holders[step.crewId] = null;
        skipped++;
        console.log(`Crew head roles: ${crewName(step.crewId)} head is not in the server`);
      } else {
        failed++;
        problems.push(`${crewName(step.crewId)}: could not assign role (${result.detail})`);
      }
    }

    const lastRun = { added, removed, skipped, failed, dryRun: false, stoppedEarly, problems };
    await STATE_DOC().set({
      guildId: DISCORD_GUILD_ID,
      weekId: weekId || null,
      updatedAt: Date.now(),
      holders,
      pending,
      lastRun,
    });

    console.log('Crew head roles synced', lastRun);

    // One report per run, not per failure — this runs weekly and must not
    // become noise. A hard stop also gets an in-Discord nudge, because the
    // fix (role hierarchy) lives in the same app the admin is already in.
    if (problems.length > 0) {
      reportError(new Error(`Crew head role sync had ${problems.length} problem(s)`), {
        where: 'syncCrewHeadRoles', problems, added, removed, failed, stoppedEarly,
      });
    }
    if (stoppedEarly) {
      await sendDiscordMessage(null, [{
        title: '⚠️ Crew head roles did not finish',
        description: problems.join('\n').slice(0, 3000),
        color: 0xED4245,
      }]);
    }

    return { configured: true, ...lastRun };
  } catch (err) {
    reportError(err, { where: 'syncCrewHeadRoles' });
    return { configured: true, failed: true, error: err.message };
  }
}

module.exports = { syncCrewHeadRoles, preflightCrewRoles };
