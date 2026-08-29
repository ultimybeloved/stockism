'use strict';
// Internal module for discordMessages.js — turns the panel's form fields into a
// Discord message payload, and back into the shape we store in Firestore.
//
// NOT a service. Never list this in servicePaths.js; it exports helpers, not
// Cloud Functions.
//
// Two jobs, deliberately split from the service:
//  - normalizeStored(): trust nothing from the client. Clamp every field to the
//    limit Discord enforces, so a too-long description comes back as a clear
//    error from us instead of an opaque 400 from Discord.
//  - buildDiscordPayload(): assemble the REST body from the stored shape only,
//    so posting and editing can never drift apart.

// Discord protocol limits. These are Discord's, not ours — do not tune them.
const CONTENT_MAX = 2000;
const EMBED_TITLE_MAX = 256;
const EMBED_DESCRIPTION_MAX = 4096;
const EMBED_FOOTER_MAX = 2048;
const BUTTON_LABEL_MAX = 80;
const BUTTONS_PER_ROW_MAX = 5;
const LABEL_MAX = 100;

// Channel types a bot can post a normal message into: text (0), announcement
// (5), and the two thread types that behave like channels for our purposes.
const DISCORD_TEXT_CHANNEL_TYPES = [0, 5, 10, 11, 12];

// Site orange, matching the rules embed and the app's accent.
const DEFAULT_EMBED_COLOR = 0xf97316;

const str = (v) => (typeof v === 'string' ? v : v == null ? '' : String(v));

/**
 * Parse a colour the panel sends. Accepts '#f97316', 'f97316' or a raw number,
 * and falls back to the site orange rather than erroring — a bad colour is
 * never worth blocking a message on.
 */
function parseColor(value) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.max(0, Math.min(0xffffff, Math.floor(value)));
  }
  const hex = str(value).trim().replace(/^#/, '');
  if (/^[0-9a-fA-F]{6}$/.test(hex)) return parseInt(hex, 16);
  return DEFAULT_EMBED_COLOR;
}

function clamp(value, max, field) {
  const s = str(value).trim();
  if (s.length > max) {
    const err = new Error(`${field} is too long (${s.length} characters, Discord allows ${max}).`);
    err.userFacing = true;
    throw err;
  }
  return s;
}

/**
 * Validate and clamp the client's fields into the shape stored in Firestore.
 * Throws a plain Error with `userFacing` set for anything an admin can fix.
 */
function normalizeStored(data) {
  const content = clamp(data?.content, CONTENT_MAX, 'The message text');
  const label = str(data?.label).trim().slice(0, LABEL_MAX);

  let embed = null;
  const raw = data?.embed;
  // An embed object with nothing in it is the same as no embed — the panel sends
  // one whenever the embed toggle has ever been opened.
  if (raw && (str(raw.title).trim() || str(raw.description).trim() || str(raw.imageUrl).trim())) {
    embed = {
      title: clamp(raw.title, EMBED_TITLE_MAX, 'The embed title'),
      description: clamp(raw.description, EMBED_DESCRIPTION_MAX, 'The embed body'),
      color: parseColor(raw.color),
      imageUrl: str(raw.imageUrl).trim().slice(0, 2000),
      footer: clamp(raw.footer, EMBED_FOOTER_MAX, 'The embed footer'),
    };
    if (embed.imageUrl && !/^https:\/\//i.test(embed.imageUrl)) {
      const err = new Error('The image link must start with https://');
      err.userFacing = true;
      throw err;
    }
  }

  const buttons = (Array.isArray(data?.buttons) ? data.buttons : [])
    .filter((b) => str(b?.label).trim() && str(b?.url).trim())
    .slice(0, BUTTONS_PER_ROW_MAX)
    .map((b) => {
      const url = str(b.url).trim();
      // Link buttons are the only kind we make: they need no custom_id and fire
      // no interaction, so nothing has to be listening on the backend.
      if (!/^https?:\/\//i.test(url)) {
        const err = new Error(`Button "${str(b.label).trim()}" needs a link starting with http:// or https://`);
        err.userFacing = true;
        throw err;
      }
      return {
        label: str(b.label).trim().slice(0, BUTTON_LABEL_MAX),
        url,
        emoji: str(b.emoji).trim().slice(0, 64),
      };
    });

  if (!content && !embed) {
    const err = new Error('Write some text, or fill in the embed, before sending.');
    err.userFacing = true;
    throw err;
  }

  return { label, content, embed, buttons, allowMentions: data?.allowMentions === true };
}

/**
 * Build the Discord REST body. Every field is always present so an edit that
 * removes the embed or the buttons actually removes them — Discord's PATCH only
 * touches the keys it is given, and omitting one leaves the old value in place.
 */
function buildDiscordPayload(stored) {
  const payload = {
    content: stored.content || '',
    embeds: [],
    components: [],
    // Mentions are off unless explicitly allowed, so a stray @everyone typed
    // into an edit cannot ping the server a second time.
    allowed_mentions: stored.allowMentions ? { parse: ['users', 'roles', 'everyone'] } : { parse: [] },
  };

  if (stored.embed) {
    const embed = { color: stored.embed.color };
    if (stored.embed.title) embed.title = stored.embed.title;
    if (stored.embed.description) embed.description = stored.embed.description;
    if (stored.embed.imageUrl) embed.image = { url: stored.embed.imageUrl };
    if (stored.embed.footer) embed.footer = { text: stored.embed.footer };
    payload.embeds.push(embed);
  }

  if (stored.buttons.length) {
    payload.components.push({
      type: 1, // action row
      components: stored.buttons.map((b) => ({
        type: 2,  // button
        style: 5, // link
        label: b.label,
        url: b.url,
        ...(b.emoji ? { emoji: { name: b.emoji } } : {}),
      })),
    });
  }

  return payload;
}

module.exports = {
  normalizeStored,
  buildDiscordPayload,
  DISCORD_TEXT_CHANNEL_TYPES,
  DEFAULT_EMBED_COLOR,
};
