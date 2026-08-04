import { useAppContext } from '../../context/AppContext';
import { auth } from '../../firebase';
import { signOut } from 'firebase/auth';
import { getThemeClasses } from '../../utils/theme';
import { useDiscordLink } from '../../hooks/useDiscordLink';

/**
 * Full-screen wall for accounts flagged for Discord verification (suspected alts,
 * via same-network signup or an admin flag) that have not linked Discord yet.
 * Blocks the app until they link. Linking sets discordId on their user doc, which
 * makes this disappear automatically.
 */
export default function DiscordWallModal() {
  const { user, userData, darkMode } = useAppContext();
  const { beginDiscordLink, linking, error } = useDiscordLink();

  // Only walls a logged-in, flagged, not-yet-linked account.
  if (!user || !userData?.requiresDiscordLink || userData?.discordId) return null;

  const { textClass, mutedClass, overlayHeavyClass, modalShellClass } = getThemeClasses(darkMode);

  return (
    <div className={`${overlayHeavyClass} z-[100] backdrop-blur-sm`}>
      <div className={`${modalShellClass} max-w-md p-6 text-center`}>
        <div className="text-4xl mb-3">🔗</div>
        <h2 className={`text-xl font-bold mb-2 ${textClass}`}>Link Discord to continue</h2>
        <p className={`text-sm mb-5 ${mutedClass}`}>
          To keep the game fair, this account needs a linked Discord before you can trade or play. It is a one-time step and takes a few seconds.
        </p>
        <button
          onClick={beginDiscordLink}
          disabled={linking}
          className="w-full px-4 py-3 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 text-white font-semibold rounded-md mb-3"
        >
          {linking ? 'Opening Discord...' : 'Link Discord'}
        </button>
        {error && <p className="text-xs text-red-400 mb-3">{error}</p>}
        <button
          onClick={() => signOut(auth)}
          className={`text-xs underline ${darkMode ? 'text-zinc-500 hover:text-zinc-300' : 'text-zinc-500 hover:text-zinc-700'}`}
        >
          Not you? Log out
        </button>
      </div>
    </div>
  );
}
