// New-player post in the Discord sign-up feed (DISCORD_SIGNUP_CHANNEL_ID).
//
// Removed in June 2026 because throwaway accounts were made just to get a
// trolling name posted; restored 2026-11-13 once sign-ups were behind verified
// email, the disposable-domain block, and the per-connection cap, and names
// behind the format, profanity, and banned-name checks. The name is the only
// player-typed text here and it is already limited to letters, digits, and
// underscores by validateUsernameFormat.
import { sendDiscordMessage, pxe } from '../shared/discordApi';

const SIGNUP_EMBED_COLOR = 0x2ecc71;

/** Underscores are the only markdown character a username can contain. */
const escapeName = (name: string) => name.replace(/_/g, '\\_');

// Name only (Darth YG, 2026-11-17): a new account has not joined the Discord
// server yet, so the post does not greet them, point them at /welcome, or link
// to the site.
export function buildSignupEmbed(displayName: string, nowMs: number, recruiterName?: string | null) {
  return {
    color: SIGNUP_EMBED_COLOR,
    title: `${pxe('party')} New player`,
    description:
      `**${escapeName(displayName)}** just joined Stockism.` +
      (recruiterName ? `\nRecruited by **${escapeName(recruiterName)}**.` : ''),
    timestamp: new Date(nowMs).toISOString(),
  };
}

/** Best-effort: sendDiscordMessage reports its own failures and never throws. */
export async function announceSignup(displayName: string, recruiterName?: string | null) {
  await sendDiscordMessage(null, [buildSignupEmbed(displayName, Date.now(), recruiterName)], 'signups');
}
