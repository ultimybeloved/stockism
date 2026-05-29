import { useState, useEffect } from 'react';

// Shows a one-time success/error banner after returning from the Discord OAuth
// redirect (reads ?discord_link= from the URL, then clears it). Renders nothing
// otherwise.
const DiscordLinkBanner = () => {
  const [discordLinkStatus, setDiscordLinkStatus] = useState(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const linkResult = params.get('discord_link');
    const linkReason = params.get('reason');
    if (!linkResult) return;
    setDiscordLinkStatus(linkReason ? `${linkResult}:${linkReason}` : linkResult);
    window.history.replaceState({}, '', window.location.pathname);
    const id = setTimeout(() => setDiscordLinkStatus(null), 5000);
    return () => clearTimeout(id);
  }, []);

  if (!discordLinkStatus) return null;

  return (
    <>
      {discordLinkStatus === 'success' && (
        <div className="p-3 rounded-sm bg-green-900/30 border border-green-700 text-green-400 text-sm">
          Discord linked successfully! You can now claim daily free stocks.
        </div>
      )}
      {discordLinkStatus?.startsWith('error') && (
        <div className="p-3 rounded-sm bg-red-900/30 border border-red-700 text-red-400 text-sm">
          {discordLinkStatus.includes('already_linked')
            ? 'Failed to link Discord. It may already be linked to another account.'
            : `Failed to link Discord: ${discordLinkStatus.split(':').slice(1).join(':') || 'Unknown error'}`}
        </div>
      )}
    </>
  );
};

export default DiscordLinkBanner;
