import { useState } from 'react';
import { startDiscordLinkFunction } from '../firebase';

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

  return { beginDiscordLink, linking, error };
}
