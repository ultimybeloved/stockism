import { themeClasses } from '../../../utils/theme';
import { useSession } from '../../../context/AppContext';

// The Privacy tab: exactly what the game stores about a player, in plain words.
const PrivacyTab = () => {
  const { userData } = useSession();
  const { textClass, mutedClass } = themeClasses;
  const linkClass = 'text-orange-500 hover:text-orange-400 underline';

  return (
    <div className={`space-y-4 ${textClass}`}>
      <div
        className={`p-3 rounded-sm ${userData?.colorBlindMode ? 'light:bg-teal-50 light:border light:border-teal-200 dark:bg-teal-900/30 dark:border dark:border-teal-700' : 'light:bg-green-50 light:border light:border-green-200 dark:bg-green-900/30 dark:border dark:border-green-700'}`}
      >
        <p className={`font-semibold text-sm ${userData?.colorBlindMode ? 'text-teal-500' : 'text-green-500'}`}>
          🛡️ TL;DR: We store almost nothing about you. No real names, no profile pictures, no tracking.
        </p>
      </div>

      <div>
        <h3 className="font-semibold text-orange-500 mb-2">What we store in our game database:</h3>
        <ul className={`text-sm ${mutedClass} space-y-1 ml-4`}>
          <li>
            • <span className="light:text-slate-700 dark:text-zinc-300">Username</span>: The name YOU choose (not your
            real name)
          </li>
          <li>
            • <span className="light:text-slate-700 dark:text-zinc-300">Game data</span>: Your cash balance, holdings,
            and trade history
          </li>
          <li>
            • <span className="light:text-slate-700 dark:text-zinc-300">Account ID</span>: A random ID to identify your
            account
          </li>
          <li>
            • <span className="light:text-slate-700 dark:text-zinc-300">Discord ID</span>: If you link Discord, so one
            Discord account maps to one player. Never shown to other players
          </li>
          <li>
            • <span className="light:text-slate-700 dark:text-zinc-300">IP address</span>: Used only to stop people
            making alt accounts. Never shown to other players
          </li>
        </ul>
      </div>

      <div>
        <h3 className="font-semibold text-orange-500 mb-2">What Firebase Authentication stores:</h3>
        <p className={`text-sm ${mutedClass} mb-2`}>
          Firebase (Google's service) handles login and stores your email to manage your account. This is standard for
          any website with login. It's how you can sign back in later.
        </p>
        <ul className={`text-sm ${mutedClass} space-y-1 ml-4`}>
          <li>
            • <span className="light:text-amber-600 dark:text-amber-400">📧 Email</span>: Stored by Firebase Auth (not
            our game database). Never visible to other players or used for marketing.
          </li>
        </ul>
      </div>

      <div>
        <h3 className="font-semibold text-orange-500 mb-2">What we DON'T store anywhere:</h3>
        <ul className={`text-sm ${mutedClass} space-y-1 ml-4`}>
          <li>
            • <span className={userData?.colorBlindMode ? 'text-purple-400' : 'text-red-400'}>❌ Your real name</span>:
            We never save the name from your sign-in account
          </li>
          <li>
            •{' '}
            <span className={userData?.colorBlindMode ? 'text-purple-400' : 'text-red-400'}>
              ❌ Your profile picture
            </span>
            : We never save your sign-in photo
          </li>
          <li>
            • <span className={userData?.colorBlindMode ? 'text-purple-400' : 'text-red-400'}>❌ Your password</span>:
            Your sign-in provider handles authentication securely
          </li>
          <li>
            •{' '}
            <span className={userData?.colorBlindMode ? 'text-purple-400' : 'text-red-400'}>
              ❌ Your contacts or account data
            </span>
            : We have no access
          </li>
          <li>
            •{' '}
            <span className={userData?.colorBlindMode ? 'text-purple-400' : 'text-red-400'}>
              ❌ Tracking cookies or analytics
            </span>
            : We don't use any. When something breaks, an error report goes to our bug tracker so we can fix it
          </li>
        </ul>
      </div>

      <div>
        <h3 className="font-semibold text-orange-500 mb-2">About the sign-in popup:</h3>
        <p className={`text-sm ${mutedClass}`}>
          When you sign in with Google, X, or Discord, they show a standard message saying we "could" access your name
          and profile picture. That screen shows the <em>maximum possible</em> permissions, not what we actually use.
        </p>
        <p className={`text-sm ${mutedClass} mt-2`}>
          In reality, our code immediately discards this information. We only use the sign-in to verify you're a real
          person, then we ask you to create a username. That username is the only identifier visible to other players.
        </p>
      </div>

      <div>
        <h3 className="font-semibold text-orange-500 mb-2">Data deletion:</h3>
        <p className={`text-sm ${mutedClass}`}>
          You can delete your account and all associated data anytime from your Profile (click your username → scroll to
          bottom → Delete Account). To stop alt-account abuse, a record of your IP address and Discord ID is kept after
          deletion, which blocks them from making a new account for 30 days.
        </p>
      </div>

      <div className="mt-4 p-3 rounded-sm light:bg-amber-50 dark:bg-zinc-800/50">
        <p className={`text-xs ${mutedClass}`}>
          Last updated: September 2026. This is a fan project with no legal entity behind it. If you have privacy
          concerns, please reach out to us directly.
        </p>
        <p className={`text-xs ${mutedClass} mt-2`}>
          <a href="/terms.html" target="_blank" rel="noopener noreferrer" className={linkClass}>
            View Terms of Service →
          </a>
          {' • '}
          <a href="/privacy.html" target="_blank" rel="noopener noreferrer" className={linkClass}>
            View Privacy Policy →
          </a>
        </p>
      </div>
    </div>
  );
};

export default PrivacyTab;
