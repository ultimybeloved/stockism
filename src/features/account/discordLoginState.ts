// One-time code that ties a Discord login to the browser that started it.
//
// The login button saves a random code here and sends it to Discord, which
// hands it back with the sign-in token. The token is only used if the code
// matches, so a link built by someone else (carrying THEIR token) can't sign
// this browser into their account. localStorage rather than sessionStorage:
// on phones Discord can hand the player back in a different tab.

const KEY = 'discordLoginState';
const MAX_AGE_MS = 10 * 60 * 1000;

export function startDiscordLoginState(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  const state = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  try {
    localStorage.setItem(KEY, JSON.stringify({ state, at: Date.now() }));
  } catch {
    // Storage blocked: the login will be refused on return, which is the safe side.
  }
  return state;
}

/** True only if `state` is the code this browser saved, and recently. Single use. */
export function consumeDiscordLoginState(state: string | null): boolean {
  let saved: { state?: unknown; at?: unknown } | null = null;
  try {
    saved = JSON.parse(localStorage.getItem(KEY) || 'null');
    localStorage.removeItem(KEY);
  } catch {
    return false;
  }
  if (!state || !saved || typeof saved.state !== 'string' || typeof saved.at !== 'number') return false;
  return saved.state === state && Date.now() - saved.at <= MAX_AGE_MS;
}
