import { useState, useEffect } from 'react';
import { createUserFunction, checkUsernameFunction } from '../../firebase';
import { containsProfanity, getProfanityMessage } from '../../utils/profanity';
import { validateUsername } from '../../utils/username';
import { getThemeClasses } from '../../utils/theme';

// Wait this long after the last keystroke before asking the server. Without it
// every character typed would be its own function call.
const CHECK_DEBOUNCE_MS = 600;

const UsernameModal = ({ onComplete, darkMode }) => {
  const [username, setUsername] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  // null = nothing to say yet, otherwise 'checking' | 'available' | 'taken'
  const [availability, setAvailability] = useState(null);

  const trimmedName = username.trim();
  // Only ask the server about names that already pass the local rules — a name
  // failing format or profanity is rejected anyway, so checking it wastes a call.
  const locallyValid = trimmedName.length > 0
    && !validateUsername(trimmedName)
    && !containsProfanity(trimmedName);

  useEffect(() => {
    if (!locallyValid) {
      setAvailability(null);
      return;
    }

    setAvailability('checking');
    let stale = false;
    const timer = setTimeout(async () => {
      try {
        const { data } = await checkUsernameFunction({ displayName: trimmedName });
        // A slower earlier request must not overwrite a newer answer
        if (!stale) setAvailability(data.available ? 'available' : 'taken');
      } catch {
        // Availability is a convenience — createUser is the real gate, so a
        // failed check just goes quiet rather than blocking signup.
        if (!stale) setAvailability(null);
      }
    }, CHECK_DEBOUNCE_MS);

    return () => { stale = true; clearTimeout(timer); };
  }, [trimmedName, locallyValid]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    const trimmed = username.trim();
    if (!trimmed) {
      setError('Please enter a username');
      return;
    }
    const formatError = validateUsername(trimmed);
    if (formatError) {
      setError(formatError);
      return;
    }
    if (containsProfanity(trimmed)) {
      setError(getProfanityMessage());
      return;
    }
    if (availability === 'taken') {
      setError('This username is already taken. Please choose another.');
      return;
    }

    setLoading(true);
    try {
      // Create user via Cloud Function (ensures case-insensitive username uniqueness)
      await createUserFunction({ displayName: trimmed });
      onComplete();
    } catch (err) {
      // Handle specific error codes from Cloud Function
      if (err.code === 'functions/already-exists') {
        setError('This username is already taken. Please choose another.');
      } else if (err.code === 'functions/invalid-argument') {
        setError(err.message || 'Invalid username.');
      } else {
        setError('Failed to create account. Please try again.');
        console.error(err);
      }
    }
    setLoading(false);
  };

  const { textClass, mutedClass, inputClass, overlayHeavyClass, modalShellClass } = getThemeClasses(darkMode);

  return (
    <div className={`${overlayHeavyClass} z-50`}>
      <div className={`${modalShellClass} max-w-md p-6`}>
        <h2 className={`text-xl font-semibold mb-2 ${textClass}`}>Welcome to Stockism! 🎉</h2>
        <p className={`text-sm ${mutedClass} mb-6`}>
          Choose a username for the leaderboard. This is the only name other players will see.
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className={`block text-xs font-semibold uppercase tracking-wide mb-1 ${mutedClass}`}>
              Username
            </label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="Enter a username..."
              className={`w-full px-3 py-2 border rounded-sm text-sm ${inputClass} focus:outline-none focus:ring-1 focus:ring-orange-600`}
              disabled={loading}
              autoFocus
              maxLength={20}
            />
            {availability && (
              <p className={`text-xs mt-1 font-semibold ${
                availability === 'available' ? 'text-green-500'
                  : availability === 'taken' ? 'text-red-500'
                  : mutedClass
              }`}>
                {availability === 'checking' && 'Checking availability...'}
                {availability === 'available' && '✓ That name is free'}
                {availability === 'taken' && '✗ That name is taken'}
              </p>
            )}
            <p className={`text-xs ${mutedClass} mt-1`}>
              3-20 characters. At least 3 letters or numbers. Up to 2 underscores, not at the start or end.
            </p>
          </div>

          {error && (
            <div className="bg-red-100 border border-red-300 text-red-700 px-3 py-2 rounded-sm text-sm">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading || availability === 'taken'}
            className="w-full bg-orange-600 hover:bg-orange-700 text-white font-semibold py-2.5 px-4 rounded-sm text-sm uppercase tracking-wide transition-colors disabled:opacity-50"
          >
            {loading ? 'Creating account...' : 'Start Trading'}
          </button>
        </form>

        <p className={`text-xs ${mutedClass} mt-4 text-center`}>
          🔒 Your account info is never stored or shared
        </p>

        <p className={`text-xs ${mutedClass} mt-2 text-center`}>
          By creating an account, you agree to our{' '}
          <a href="/terms.html" target="_blank" rel="noopener noreferrer" className="text-orange-500 hover:text-orange-400 underline">
            Terms of Service
          </a>
          {' and '}
          <a href="/privacy.html" target="_blank" rel="noopener noreferrer" className="text-orange-500 hover:text-orange-400 underline">
            Privacy Policy
          </a>
        </p>
      </div>
    </div>
  );
};

export default UsernameModal;
