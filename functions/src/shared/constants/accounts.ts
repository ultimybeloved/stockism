// Account rules: name changes, accounts per connection, Discord linking, public profiles.

// Cooldown between display-name changes.
export const NAME_CHANGE_COOLDOWN_MS = 14 * 24 * 60 * 60 * 1000;

// Anti-alt: hard cap on accounts per IP, enforced at signup AND trade.
// ADMIN_UID is always exempt. Flip IP_ACCOUNT_CAP_ENABLED to false to disable the
// hard block instantly (e.g. if client IPs turn out unreliable) without a code change.
export const MAX_ACCOUNTS_PER_IP = 2;
export const IP_ACCOUNT_CAP_ENABLED = true;
// A deleted account keeps holding its per-IP slot for this long, then the slot
// frees up. Stops the pump → delete → remake loop (a month's wait per cycle makes
// it worthless) while still letting genuine deleters rejoin later.
export const IP_SLOT_RELEASE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
// A Discord account linked to a now-deleted Stockism account is blocked from
// linking or creating a new one for this long. Mirrors IP_SLOT_RELEASE_MS: it
// kills the create → grab the verified $3k starting cash → gamble → delete →
// remake loop (and one aged Discord spawning troll accounts) by making each cycle
// cost a month's wait. The $3k bonus is one-time per live account, so within this
// window it can never be re-granted either.
export const DISCORD_RELINK_COOLDOWN_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
// After a player unlinks their own Discord, it is reserved to that account for
// this long before another account may link it. Stops the unlink → link to a
// fresh account → collect the $2,000 verification top-up loop, and the repeat
// daily-drop claims that come with it (claims are recorded per Stockism account,
// and each drop message stays open 72 hours). Shorter than the 30-day cooldowns
// on purpose: the per-IP signup cap is the real brake on making new accounts,
// and a week is short enough that players who unlink the wrong account unstick
// themselves instead of needing an admin.
export const DISCORD_BINDING_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

// How long a Discord-link handoff code stays valid. It is minted for the
// signed-in user by startDiscordLink and burned by discordLink, so it only has
// to outlive one trip through Discord's authorize screen.
export const DISCORD_LINK_NONCE_TTL_MS = 10 * 60 * 1000; // 10 minutes

// Read cap for the public-profile sparkline query (keeps per-view Firestore
// reads bounded no matter how many history points an account has).
export const PUBLIC_PROFILE_SPARKLINE_MAX_POINTS = 150;
