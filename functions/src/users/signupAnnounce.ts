// New-player post in the Discord sign-up feed (DISCORD_SIGNUP_CHANNEL_ID).
//
// Removed in June 2026 because throwaway accounts were made just to get a
// trolling name posted; restored 2026-11-13 once sign-ups were behind verified
// email, the disposable-domain block, and the per-connection cap, and names
// behind the format, profanity, and banned-name checks. The name is the only
// player-typed text here and it is already limited to letters, digits, and
// underscores by validateUsernameFormat.
import { sendDiscordMessage, pxe } from '../shared/discordApi';
import { SITE_URL } from '../shared/constants';

const SIGNUP_EMBED_COLOR = 0x2ecc71;

const PROVIDER_LABELS: Record<string, string> = {
  'google.com': 'Google',
  'twitter.com': 'Twitter',
  password: 'Email',
  custom: 'Discord',
};

/** Underscores are the only markdown character a username can contain. */
const escapeName = (name: string) => name.replace(/_/g, '\\_');

export function buildSignupEmbed(
  displayName: string,
  provider: string | undefined,
  nowMs: number,
  recruiterName?: string | null,
) {
  const via = PROVIDER_LABELS[provider || ''];
  return {
    color: SIGNUP_EMBED_COLOR,
    title: `${pxe('party')} New player`,
    description:
      `**${escapeName(displayName)}** just joined Stockism${via ? ` with ${via}` : ''}.\n` +
      (recruiterName ? `Recruited by **${escapeName(recruiterName)}**.\n` : '') +
      `Say hi, and run \`/welcome\` here for your welcome week.`,
    url: SITE_URL,
    timestamp: new Date(nowMs).toISOString(),
  };
}

/** Best-effort: sendDiscordMessage reports its own failures and never throws. */
export async function announceSignup(displayName: string, provider: string | undefined, recruiterName?: string | null) {
  await sendDiscordMessage(null, [buildSignupEmbed(displayName, provider, Date.now(), recruiterName)], 'signups');
}
