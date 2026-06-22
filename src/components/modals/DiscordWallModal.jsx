import { useAppContext } from '../../context/AppContext';
import { auth } from '../../firebase';
import { signOut } from 'firebase/auth';
import { getThemeClasses } from '../../utils/theme';

/**
 * Full-screen wall for accounts flagged for Discord verification (suspected alts,
 * via same-network signup or an admin flag) that have not linked Discord yet.
 * Blocks the app until they link. Linking sets discordId on their user doc, which
 * makes this disappear automatically.
 */
export default function DiscordWallModal() {
  const { user, userData, darkMode } = useAppContext();

  // Only walls a logged-in, flagged, not-yet-linked account.
  if (!user || !userData?.requiresDiscordLink || userData?.discordId) return null;

  const { textClass, mutedClass } = getThemeClasses(darkMode);

  const startLink = () => {
    window.location.href = `https://discord.com/oauth2/authorize?client_id=1467420774477467752&response_type=code&redirect_uri=${encodeURIComponent('https://us-central1-stockism-abb28.cloudfunctions.net/discordLink')}&scope=identify&state=${user.uid}`;
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
      <div className={`max-w-md w-full p-6 rounded-lg border text-center ${darkMode ? 'bg-zinc-900 border-zinc-700' : 'bg-white border-amber-200'}`}>
        <div className="text-4xl mb-3">🔗</div>
        <h2 className={`text-xl font-bold mb-2 ${textClass}`}>Link Discord to continue</h2>
        <p className={`text-sm mb-5 ${mutedClass}`}>
          To keep the game fair, this account needs a linked Discord before you can trade or play. It is a one-time step and takes a few seconds.
        </p>
        <button
          onClick={startLink}
          className="w-full px-4 py-3 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold rounded-md mb-3"
        >
          Link Discord
        </button>
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
