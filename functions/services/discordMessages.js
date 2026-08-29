'use strict';
// Admin-managed Discord messages: post, edit, delete and import bot messages
// from the admin panel instead of hand-writing a one-off script each time.
//
// The point is EDITABILITY. A message the bot posted stays editable forever, so
// every message sent through here is recorded in Firestore with its channel and
// message id. Fixing a typo months later is an edit, not a repost, which keeps
// pins, links and reactions alive.
//
// Uses the "Stockism Updates" bot (DISCORD_BOT_TOKEN) — the same app that sends
// market alerts and the daily drop, NOT the login app. The bot needs View
// Channel, Send Messages and Embed Links in the target channel.
//
// Payload building lives in discordMessagePayload.js (internal module, not in
// servicePaths.js).
const functions = require('firebase-functions');
const { cf, requireAppCheck } = require('../fnConfig');
const admin = require('firebase-admin');
// Modular import — the emulator sandbox strips admin.firestore statics.
const { Timestamp } = require('firebase-admin/firestore');
const db = admin.firestore();
const { ADMIN_UID, DISCORD_GUILD_ID } = require('../constants');
const { discordApi } = require('../helpers');
const {
  buildDiscordPayload,
  normalizeStored,
  DISCORD_TEXT_CHANNEL_TYPES,
} = require('./discordMessagePayload');

const COLLECTION = 'discordMessages';
// Guild id is not a required env var, so it is resolved once from a known
// channel and cached here rather than making every channel list do the lookup.
// Lives under admin/ and not config/, because config/ is world-readable and the
// bot's server wiring has no business being in a doc every player can fetch.
const CONFIG_DOC = db.collection('admin').doc('discordMessagesConfig');

// normalizeStored throws plain Errors tagged `userFacing` for anything an admin
// typed wrong. Without this they would reach the panel as a generic "internal"
// error and the admin would never learn the description was 40 chars too long.
function normalize(data) {
  try {
    return normalizeStored(data);
  } catch (err) {
    if (err.userFacing) throw new functions.https.HttpsError('invalid-argument', err.message);
    throw err;
  }
}

function requireAdmin(context) {
  requireAppCheck(context);
  if (!context.auth || context.auth.uid !== ADMIN_UID) {
    throw new functions.https.HttpsError('permission-denied', 'Admin only');
  }
}

// Discord answers with meaningful status codes and discordApi never throws on
// them, so every call site funnels through this to turn a bad status into a
// message an admin can actually act on.
function assertOk(res, what) {
  if (res.status === 0) {
    throw new functions.https.HttpsError('failed-precondition', 'The bot token is not configured on the server.');
  }
  if (res.status >= 200 && res.status < 300) return res.data;

  const detail = res.data?.message || `HTTP ${res.status}`;
  if (res.status === 403) {
    throw new functions.https.HttpsError('permission-denied',
      `Discord refused: ${detail}. The bot is usually missing View Channel, Send Messages or Embed Links in that channel.`);
  }
  if (res.status === 404) {
    throw new functions.https.HttpsError('not-found', `Discord could not find it: ${detail}`);
  }
  if (res.status === 429) {
    throw new functions.https.HttpsError('resource-exhausted', 'Discord is rate limiting the bot. Wait a minute and try again.');
  }
  throw new functions.https.HttpsError('internal', `${what} failed: ${detail}`);
}

function docToClient(doc) {
  const d = doc.data();
  return {
    id: doc.id,
    channelId: d.channelId,
    channelName: d.channelName || '',
    messageId: d.messageId,
    label: d.label || '',
    content: d.content || '',
    embed: d.embed || null,
    buttons: d.buttons || [],
    allowMentions: !!d.allowMentions,
    scriptManaged: !!d.scriptManaged,
    imported: !!d.imported,
    updatedAt: d.updatedAt ? d.updatedAt.toMillis() : null,
    createdAt: d.createdAt ? d.createdAt.toMillis() : null,
  };
}

/**
 * Resolve the bot's guild id without requiring DISCORD_GUILD_ID to be set.
 *
 * Any channel the bot can see reports its own guild_id, so one lookup against
 * the already-configured alerts channel gives us the server. Cached in Firestore
 * so this costs one Discord call ever, not one per channel list.
 */
async function resolveGuildId() {
  if (DISCORD_GUILD_ID) return DISCORD_GUILD_ID;

  const cached = await CONFIG_DOC.get();
  if (cached.exists && cached.data().guildId) return cached.data().guildId;

  const seedChannel = process.env.DISCORD_CHANNEL_ID;
  if (!seedChannel) return null;

  const res = await discordApi('get', `/channels/${seedChannel}`);
  const guildId = res.status >= 200 && res.status < 300 ? res.data?.guild_id : null;
  if (guildId) await CONFIG_DOC.set({ guildId }, { merge: true });
  return guildId || null;
}

/**
 * Admin-only: list the text channels the bot can post in, so the panel can show
 * a dropdown of names instead of asking for a raw snowflake id.
 *
 * Fails soft. If the guild cannot be resolved the panel still works — it just
 * falls back to pasting a channel id by hand.
 */
exports.adminListDiscordChannels = cf().https.onCall(async (data, context) => {
  requireAdmin(context);

  const guildId = await resolveGuildId();
  if (!guildId) {
    return { success: true, channels: [], reason: 'Could not work out which Discord server the bot is in.' };
  }

  const res = await discordApi('get', `/guilds/${guildId}/channels`);
  if (res.status < 200 || res.status >= 300) {
    return { success: true, channels: [], reason: res.data?.message || `Discord returned ${res.status}.` };
  }

  const all = Array.isArray(res.data) ? res.data : [];
  const categories = new Map(all.filter((c) => c.type === 4).map((c) => [c.id, c.name]));
  const channels = all
    .filter((c) => DISCORD_TEXT_CHANNEL_TYPES.includes(c.type))
    .map((c) => ({
      id: c.id,
      name: c.name,
      category: c.parent_id ? categories.get(c.parent_id) || '' : '',
      position: c.position ?? 0,
    }))
    .sort((a, b) => a.category.localeCompare(b.category) || a.position - b.position);

  return { success: true, channels };
});

/**
 * Admin-only: every message the panel knows about, newest first.
 */
exports.adminListDiscordMessages = cf().https.onCall(async (data, context) => {
  requireAdmin(context);

  const snap = await db.collection(COLLECTION).orderBy('createdAt', 'desc').limit(100).get();
  return { success: true, messages: snap.docs.map(docToClient) };
});

/**
 * Admin-only: post a new message as the bot and record it so it stays editable.
 */
exports.adminSendDiscordMessage = cf().https.onCall(async (data, context) => {
  requireAdmin(context);

  const channelId = String(data?.channelId || '').trim();
  if (!/^\d{5,25}$/.test(channelId)) {
    throw new functions.https.HttpsError('invalid-argument', 'Pick a channel first.');
  }

  const stored = normalize(data);
  const payload = buildDiscordPayload(stored);

  const sent = assertOk(
    await discordApi('post', `/channels/${channelId}/messages`, { body: payload }),
    'Sending the message'
  );

  const now = Timestamp.now();
  const ref = await db.collection(COLLECTION).add({
    ...stored,
    channelId,
    channelName: String(data?.channelName || '').slice(0, 100),
    messageId: sent.id,
    createdAt: now,
    updatedAt: now,
    createdBy: context.auth.uid,
  });

  const doc = await ref.get();
  return { success: true, message: docToClient(doc) };
});

/**
 * Admin-only: edit a message the bot already posted, in place.
 *
 * Discord PATCH replaces the fields it is given, so the whole payload is rebuilt
 * from the saved record every time. Clearing the embed in the panel therefore
 * actually clears it on Discord rather than leaving the old one behind.
 */
exports.adminUpdateDiscordMessage = cf().https.onCall(async (data, context) => {
  requireAdmin(context);

  const id = String(data?.id || '').trim();
  if (!id) throw new functions.https.HttpsError('invalid-argument', 'id required');

  const ref = db.collection(COLLECTION).doc(id);
  const snap = await ref.get();
  if (!snap.exists) throw new functions.https.HttpsError('not-found', 'That message is not tracked here.');

  const existing = snap.data();
  const stored = normalize(data);
  const payload = buildDiscordPayload(stored);

  assertOk(
    await discordApi('patch', `/channels/${existing.channelId}/messages/${existing.messageId}`, { body: payload }),
    'Editing the message'
  );

  await ref.update({ ...stored, updatedAt: Timestamp.now(), updatedBy: context.auth.uid });

  const updated = await ref.get();
  return { success: true, message: docToClient(updated) };
});

/**
 * Admin-only: delete the message from Discord, or just stop tracking it.
 *
 * `forget` exists because deleting the Discord message is not always what you
 * want — a message posted by the rules script should be dropped from the list
 * without being removed from the server.
 */
exports.adminDeleteDiscordMessage = cf().https.onCall(async (data, context) => {
  requireAdmin(context);

  const id = String(data?.id || '').trim();
  if (!id) throw new functions.https.HttpsError('invalid-argument', 'id required');
  const forget = data?.forget === true;

  const ref = db.collection(COLLECTION).doc(id);
  const snap = await ref.get();
  if (!snap.exists) throw new functions.https.HttpsError('not-found', 'That message is not tracked here.');

  if (!forget) {
    const existing = snap.data();
    const res = await discordApi('delete', `/channels/${existing.channelId}/messages/${existing.messageId}`);
    // Already gone from Discord is a success for our purposes — the record is
    // what we are cleaning up.
    if (res.status !== 404) assertOk(res, 'Deleting the message');
  }

  await ref.delete();
  return { success: true, deletedFromDiscord: !forget };
});

/**
 * Admin-only: adopt a message the bot posted some other way (the rules script,
 * an older one-off) so it can be edited from the panel.
 *
 * Only the bot's own messages can be imported: Discord refuses to let a bot edit
 * anyone else's message, so importing one would create a row that always fails
 * on save.
 */
exports.adminImportDiscordMessage = cf().https.onCall(async (data, context) => {
  requireAdmin(context);

  const channelId = String(data?.channelId || '').trim();
  const messageId = String(data?.messageId || '').trim();
  if (!/^\d{5,25}$/.test(channelId) || !/^\d{5,25}$/.test(messageId)) {
    throw new functions.https.HttpsError('invalid-argument', 'Need a channel id and a message id.');
  }

  const dupe = await db.collection(COLLECTION).where('messageId', '==', messageId).limit(1).get();
  if (!dupe.empty) {
    return { success: true, alreadyTracked: true, message: docToClient(dupe.docs[0]) };
  }

  const msg = assertOk(
    await discordApi('get', `/channels/${channelId}/messages/${messageId}`),
    'Reading the message'
  );

  const me = assertOk(await discordApi('get', '/users/@me'), 'Identifying the bot');
  if (msg.author?.id !== me.id) {
    throw new functions.https.HttpsError('failed-precondition',
      'That message was not posted by the bot, so the bot cannot edit it. Discord only lets a bot edit its own messages.');
  }

  const embed = msg.embeds?.[0] || null;
  const buttons = (msg.components || [])
    .flatMap((row) => row.components || [])
    .filter((c) => c.type === 2 && c.url)
    .map((c) => ({ label: c.label || '', url: c.url, emoji: c.emoji?.name || '' }));

  const stored = normalize({
    label: data?.label,
    content: msg.content || '',
    embed: embed && {
      title: embed.title || '',
      description: embed.description || '',
      color: typeof embed.color === 'number' ? embed.color : null,
      imageUrl: embed.image?.url || '',
      footer: embed.footer?.text || '',
    },
    buttons,
  });

  const now = Timestamp.now();
  const ref = await db.collection(COLLECTION).add({
    ...stored,
    channelId,
    channelName: String(data?.channelName || '').slice(0, 100),
    messageId,
    imported: true,
    scriptManaged: data?.scriptManaged === true,
    createdAt: now,
    updatedAt: now,
    createdBy: context.auth.uid,
  });

  const doc = await ref.get();
  return { success: true, message: docToClient(doc) };
});
