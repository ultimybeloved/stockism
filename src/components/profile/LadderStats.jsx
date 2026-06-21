import { useState, useEffect } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import * as Sentry from '@sentry/react';
import { db } from '../../firebase';
import { formatCurrency } from '../../utils/formatters';
import { getThemeClasses } from '../../utils/theme';

// Lifetime ladder game record: deposited, wagered, and won vs lost.
// Reads the user's ladderGameUsers/{uid} doc directly (it isn't in global
// context). A ladder win pays exactly 2x the stake, so totalWon (net winnings)
// equals the amount staked-and-won, which makes totalWon + totalLost the total
// wagered and totalWon - totalLost the net result.
const LadderStats = ({ user, userData, darkMode }) => {
  const { textClass, mutedClass } = getThemeClasses(darkMode);
  const [stats, setStats] = useState(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    getDoc(doc(db, 'ladderGameUsers', user.uid))
      .then(snap => {
        if (cancelled) return;
        setStats(snap.exists() ? snap.data() : null);
        setLoaded(true);
      })
      .catch(e => { Sentry.captureException(e); if (!cancelled) setLoaded(true); });
    return () => { cancelled = true; };
  }, [user]);

  const totalDeposited = stats?.totalDeposited || 0;
  const totalWon = stats?.totalWon || 0;
  const totalLost = stats?.totalLost || 0;
  const gamesPlayed = stats?.gamesPlayed || 0;
  const wins = stats?.wins || 0;
  const balance = stats?.balance || 0;

  // Nothing until the doc loads, and hide entirely for anyone who has never
  // deposited or played — no point cluttering a non-gambler's profile.
  if (!loaded || !stats || (gamesPlayed === 0 && totalDeposited === 0)) return null;

  const totalWagered = totalWon + totalLost;
  const net = totalWon - totalLost;
  const winRate = gamesPlayed > 0 ? Math.round((wins / gamesPlayed) * 100) : 0;

  const colorBlindMode = userData?.colorBlindMode || false;
  const upClass = colorBlindMode ? 'text-teal-500' : 'text-green-500';
  const downClass = colorBlindMode ? 'text-purple-500' : 'text-red-500';

  return (
    <div className={`p-4 rounded-sm border ${darkMode ? 'bg-zinc-800/50 border-zinc-700' : 'bg-amber-50 border-amber-200'}`}>
      <h3 className={`font-semibold ${textClass} mb-3`}>🎰 Ladder Stats</h3>

      {/* Headline net result */}
      <div className="text-center mb-4">
        <p className={`text-3xl font-bold ${net >= 0 ? upClass : downClass}`}>
          {net >= 0 ? '+' : '-'}{formatCurrency(Math.abs(net))}
        </p>
        <p className={`text-xs ${mutedClass}`}>Net result (won minus lost)</p>
      </div>

      <div className="space-y-2 text-sm">
        <div className="flex justify-between">
          <span className={mutedClass}>Total Deposited:</span>
          <span className={`font-semibold ${textClass}`}>{formatCurrency(totalDeposited)}</span>
        </div>
        <div className="flex justify-between">
          <span className={mutedClass}>Total Wagered:</span>
          <span className={`font-semibold ${textClass}`}>{formatCurrency(totalWagered)}</span>
        </div>
        <div className="flex justify-between">
          <span className={mutedClass}>Won (from hits):</span>
          <span className={`font-semibold ${upClass}`}>+{formatCurrency(totalWon)}</span>
        </div>
        <div className="flex justify-between">
          <span className={mutedClass}>Lost (from misses):</span>
          <span className={`font-semibold ${downClass}`}>-{formatCurrency(totalLost)}</span>
        </div>
        <div className="flex justify-between">
          <span className={mutedClass}>Games Played:</span>
          <span className={`font-semibold ${textClass}`}>{gamesPlayed.toLocaleString()} ({winRate}% win rate)</span>
        </div>
        <div className="flex justify-between">
          <span className={mutedClass}>Chips In Play:</span>
          <span className={`font-semibold ${textClass}`}>{formatCurrency(balance)}</span>
        </div>
      </div>
    </div>
  );
};

export default LadderStats;
