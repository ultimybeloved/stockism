import { useState } from 'react';
import { startDiscordLinkFunction, unlinkOwnDiscordFunction } from '../firebase';

const DISCORD_CLIENT_ID = '1467420774477467752';
const DISCORD_LINK_REDIRECT = 'https://us-central1-stockism-abb28.cloudfunctions.net/discordLink';

// Starts the Discord link flow. The backend mints a single-use code first and we
// send that as the OAuth `state`, which is how discordLink knows the person who
// started the flow was actually signed in as this account. Every entry point
// (profile settings, the verification wall, /link-discord) goes through here so
// the client ID and redirect URI only exist in one place.
export function useDiscordLink() {
  const [linking, setLinking] = useState(false);
  const [error, setError] = useState(null);

  const beginDiscordLink = async () => {
    setLinking(true);
    setError(null);
    try {
      const result = await startDiscordLinkFunction();
      const state = result.data?.state;
      if (!state) throw new Error('No link code returned');
      window.location.href = `https://discord.com/oauth2/authorize?client_id=${DISCORD_CLIENT_ID}&response_type=code&redirect_uri=${encodeURIComponent(DISCORD_LINK_REDIRECT)}&scope=identify&state=${state}`;
    } catch (err) {
      console.error('Failed to start Discord link:', err);
      setError('Could not start the Discord link. Try again in a moment.');
      setLinking(false);
    }
  };

  // Disconnecting is self-serve, but the Discord stays reserved to this account
  // so it can't be used to verify a second one. Re-linking the same Discord
  // later works; linking it to another account doesn't.
  const unlinkDiscord = async ({ walled } = {}) => {
    const warning = walled
      ? '\n\nYour account needs a linked Discord to trade, so you will be locked out of trading until you link one again.'
      : '';
    if (!window.confirm(
      `Disconnect your Discord?\n\nYou can link it back any time, but it stays reserved to this account and cannot be used on a different one.${warning}`
    )) return false;

    setLinking(true);
    setError(null);
    try {
      await unlinkOwnDiscordFunction();
      return true;
    } catch (err) {
      console.error('Failed to unlink Discord:', err);
      setError(err.message || 'Could not disconnect Discord. Try again in a moment.');
      return false;
    } finally {
      setLinking(false);
    }
  };

  return { beginDiscordLink, unlinkDiscord, linking, error };
}
