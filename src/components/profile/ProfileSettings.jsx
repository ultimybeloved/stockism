import { doc, updateDoc } from 'firebase/firestore';
import { db } from '../../firebase';
import { getThemeClasses } from '../../utils/theme';
import { STARTING_CASH } from '../../constants/economy';

// Profile settings card: color-blind mode, public profile toggle, Discord link.
const ProfileSettings = ({ userData, user, darkMode }) => {
  const { textClass, mutedClass } = getThemeClasses(darkMode);

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
          <span className="text-xs text-green-500 font-semibold">Connected</span>
        ) : (
          <a
            href={`https://discord.com/oauth2/authorize?client_id=1467420774477467752&response_type=code&redirect_uri=${encodeURIComponent('https://us-central1-stockism-abb28.cloudfunctions.net/discordLink')}&scope=identify&state=${user?.uid}`}
            className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold rounded-sm transition-colors"
          >
            Link Discord
          </a>
        )}
      </div>
    </div>
  );
};

export default ProfileSettings;
