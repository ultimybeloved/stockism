import { useEffect, useRef } from 'react';
import { useSession } from '../context/AppContext';
import { useDiscordLink } from '../features/profile/hooks/useDiscordLink';
import { themeClasses } from '../utils/theme';

// /link-discord: sends a signed-in player straight to Discord to link their
// account, or asks them to log in first.
const DiscordLinkRedirect = ({ onShowLogin }: { onShowLogin: () => void }) => {
  const { user } = useSession();
  const { beginDiscordLink, error: linkError } = useDiscordLink();
  const startedRef = useRef(false);

  useEffect(() => {
    // Ref guard: beginDiscordLink is async, so without it a re-render before the
    // redirect lands would mint a second code and burn the first.
    if (user && !startedRef.current) {
      startedRef.current = true;
      beginDiscordLink();
    }
  }, [user, beginDiscordLink]);

  const { bgClass, cardClass, textClass, mutedClass } = themeClasses;

  if (!user) {
    return (
      <div className={`min-h-screen ${bgClass} flex items-center justify-center p-4`}>
        <div className={`max-w-sm w-full p-6 rounded-sm border text-center ${cardClass}`}>
          <p className={`text-lg font-semibold mb-3 ${textClass}`}>Link Your Discord</p>
          <p className={`text-sm mb-4 ${mutedClass}`}>Log into Stockism first, then come back to this page.</p>
          <button
            onClick={onShowLogin}
            className="px-4 py-2 bg-orange-600 hover:bg-orange-700 text-white font-semibold rounded-sm"
          >
            Log In
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={`min-h-screen ${bgClass} flex items-center justify-center`}>
      <p className={linkError ? 'text-red-400 text-sm' : mutedClass}>{linkError || 'Redirecting to Discord...'}</p>
    </div>
  );
};

export default DiscordLinkRedirect;
