import { doc, updateDoc } from 'firebase/firestore';
import { db } from '../../firebase';
import { getThemeClasses } from '../../utils/theme';
import { STARTING_CASH } from '../../constants/economy';
import { useDiscordLink } from '../../hooks/useDiscordLink';

// Profile settings card: color-blind mode, public profile toggle, Discord link.
const ProfileSettings = ({ userData, user, darkMode }) => {
  const { textClass, mutedClass } = getThemeClasses(darkMode);
  const { beginDiscordLink, unlinkDiscord, linking, error: linkError } = useDiscordLink();

  return (
    <div className={`p-4 rounded-sm border ${darkMode ? 'bg-zinc-800/50 border-zinc-700' : 'bg-amber-50 border-amber-200'}`}>
      <h3 className={`font-semibold ${textClass} mb-3`}>⚙️ Settings</h3>
      <div className="flex items-center justify-between">
        <div>
          <p className={`text-sm font-semibold ${textClass}`}>Color Blind Mode</p>
          <p className={`text-xs ${mutedClass}`}>Use teal/purple instead of green/red</p>
        </div>
        <button
          onClick={async () => {
            const newMode = !userData?.colorBlindMode;
            try {
              await updateDoc(doc(db, 'users', user.uid), {
                colorBlindMode: newMode
              });
            } catch (err) {
              console.error('Failed to update color blind mode:', err);
            }
          }}
          className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
            userData?.colorBlindMode ? 'bg-orange-600' : (darkMode ? 'bg-zinc-700' : 'bg-slate-300')
          }`}
        >
          <span
            className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
              userData?.colorBlindMode ? 'translate-x-6' : 'translate-x-1'
            }`}
          />
        </button>
      </div>

      {/* Public Profile */}
      <div className="mt-3 pt-3 border-t border-zinc-700/50">
        <div className="flex items-center justify-between">
          <div>
            <p className={`text-sm font-semibold ${textClass}`}>Public Profile</p>
            <p className={`text-xs ${mutedClass}`}>
              {userData?.isPublic ? 'Anyone can view your profile' : 'Your profile is private'}
            </p>
          </div>
          <button
            onClick={async () => {
              try {
                await updateDoc(doc(db, 'users', user.uid), { isPublic: !userData?.isPublic });
              } catch (err) {
                console.error('Failed to update profile visibility:', err);
              }
            }}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
              userData?.isPublic ? 'bg-orange-600' : (darkMode ? 'bg-zinc-700' : 'bg-slate-300')
            }`}
          >
            <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${userData?.isPublic ? 'translate-x-6' : 'translate-x-1'}`} />
          </button>
        </div>
        {userData?.isPublic && userData?.displayName && (
          <div className={`mt-2 flex items-center gap-2 text-xs ${mutedClass}`}>
            <span>🔗</span>
            <a
              href={`/u/${userData.displayName.toLowerCase()}`}
              className="text-orange-500 hover:underline break-all"
              target="_blank"
              rel="noreferrer"
            >
              stockism.app/u/{userData.displayName.toLowerCase()}
            </a>
          </div>
        )}
      </div>

      {/* Discord Link */}
      <div className="flex items-center justify-between mt-3 pt-3 border-t border-zinc-700/50">
        <div>
          <p className={`text-sm font-semibold ${textClass}`}>Discord</p>
          <p className={`text-xs ${mutedClass}`}>
            {userData?.discordId
              ? `Linked${userData?.discordUsername ? ` as ${userData.discordUsername}` : ''}`
              : (userData?.startingCashUnlocked
                  ? 'Link to claim daily free stocks in Discord'
                  : `Link Discord to unlock your full $${STARTING_CASH.toLocaleString()} starting balance`)}
          </p>
        </div>
        {userData?.discordId ? (
          <div className="flex items-center gap-2">
            <span className="text-xs text-green-500 font-semibold">Connected</span>
            <button
              onClick={() => unlinkDiscord({ walled: !!userData?.requiresDiscordLink })}
              disabled={linking}
              className={`px-2 py-1 text-xs font-semibold rounded-sm transition-colors disabled:opacity-60 ${
                darkMode
                  ? 'bg-zinc-700 hover:bg-zinc-600 text-zinc-200'
                  : 'bg-amber-100 hover:bg-amber-200 text-amber-900'
              }`}
            >
              {linking ? '...' : 'Unlink'}
            </button>
          </div>
        ) : (
          <button
            onClick={beginDiscordLink}
            disabled={linking}
            className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 text-white text-xs font-semibold rounded-sm transition-colors"
          >
            {linking ? 'Opening...' : 'Link Discord'}
          </button>
        )}
      </div>
      {linkError && <p className="text-xs text-red-400 mt-2">{linkError}</p>}

      {/* Season titles — earned by finishing a season at a tier, never bought.
          Only ownedTitles (server-written) can be equipped; the rule allowlist
          lets the client set activeTitle and nothing else. */}
      {(userData?.ownedTitles || []).length > 0 && (
        <div className="mt-3 pt-3 border-t border-zinc-700/50">
          <p className={`text-sm font-semibold ${textClass}`}>Title</p>
          <p className={`text-xs ${mutedClass} mb-2`}>Shown under your name.</p>
          <select
            value={userData.activeTitle || ''}
            onChange={async (e) => {
              const value = e.target.value || null;
              try {
                await updateDoc(doc(db, 'users', user.uid), { activeTitle: value });
              } catch (err) {
                console.error('Failed to set title:', err);
              }
            }}
            className={`w-full px-2 py-1 text-sm rounded-sm border ${
              darkMode ? 'bg-zinc-900 border-zinc-700 text-white' : 'bg-white border-amber-200 text-zinc-900'
            }`}
          >
            <option value="">No title</option>
            {(userData.ownedTitles || []).map((id) => (
              <option key={id} value={id}>{userData.titleMeta?.[id] || id}</option>
            ))}
          </select>
        </div>
      )}
    </div>
  );
};

export default ProfileSettings;
