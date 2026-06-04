import { useState, useEffect } from 'react';
import { getTodayDateString, toUTCDateString, msUntilUTCMidnight } from '../utils/date';
import { CHECKIN_STREAK_REWARDS } from '../constants/economy';

const CAP_DAY = CHECKIN_STREAK_REWARDS.length; // streak length where the reward stops climbing

// Reward for a given streak day (1-based), capped at the last tier.
const rewardForStreak = (streak) =>
  CHECKIN_STREAK_REWARDS[Math.min(Math.max(streak, 1) - 1, CAP_DAY - 1)];

const CheckInButton = ({ isGuest, lastCheckin, checkinStreak = 0, onCheckin, darkMode, loading }) => {
  const [showTooltip, setShowTooltip] = useState(false);
  const [timeUntilReset, setTimeUntilReset] = useState('');

  const today = getTodayDateString(); // UTC YYYY-MM-DD, matches server
  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().split('T')[0];
  const lastCheckinStr = toUTCDateString(lastCheckin);
  const hasCheckedIn = !isGuest && lastCheckinStr === today;

  // checkinStreak is the streak as of the last check-in.
  const currentStreak = checkinStreak || 0;
  const continuing = lastCheckinStr === yesterday;        // last check-in was yesterday → streak carries
  const claimStreak = continuing ? currentStreak + 1 : 1; // streak the user reaches if they claim now
  // Bars show the streak already banked: today's once claimed, the live streak if
  // yesterday counts, otherwise nothing (a missed day has killed it).
  const displayStreak = hasCheckedIn ? currentStreak : (continuing ? currentStreak : 0);
  const filledDays = Math.min(displayStreak, CAP_DAY);

  const claimReward = rewardForStreak(claimStreak);            // what claiming now pays
  const nextReward = rewardForStreak(currentStreak + 1);       // what tomorrow pays after today's check-in
  const atCap = displayStreak >= CAP_DAY;
  const lostStreak = !hasCheckedIn && !isGuest && currentStreak > 0 && !continuing;

  useEffect(() => {
    if (!hasCheckedIn) return;

    const updateTimer = () => {
      const diff = msUntilUTCMidnight();
      const hours = Math.floor(diff / (1000 * 60 * 60));
      const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
      const seconds = Math.floor((diff % (1000 * 60)) / 1000);

      setTimeUntilReset(`${hours}h ${minutes}m ${seconds}s`);
    };

    updateTimer();
    const interval = setInterval(updateTimer, 1000);
    return () => clearInterval(interval);
  }, [hasCheckedIn]);

  // Toggle tooltip on click/tap for mobile support
  const handleButtonClick = () => {
    if (hasCheckedIn) {
      setShowTooltip(prev => !prev);
    } else {
      onCheckin();
    }
  };

  // One short status line under the ladder.
  let statusLine;
  if (isGuest) {
    statusLine = 'Sign in to start your streak.';
  } else if (hasCheckedIn) {
    statusLine = atCap
      ? `Max streak. Back tomorrow for +$${nextReward}.`
      : `${currentStreak} day streak. Tomorrow: +$${nextReward}.`;
  } else if (lostStreak) {
    statusLine = 'Streak reset. Start a new one today.';
  } else if (claimStreak >= CAP_DAY) {
    statusLine = `Max streak. Claim +$${claimReward}.`;
  } else if (claimStreak === 1) {
    statusLine = 'Check in to start your streak.';
  } else {
    statusLine = `Day ${claimStreak} of ${CAP_DAY}. Keep it going.`;
  }

  return (
    <div className="relative mt-2">
      {/* Streak ladder: one segment per day, brighter gold on the final (max) rung */}
      <div className="flex items-center gap-0.5 mb-1">
        {CHECKIN_STREAK_REWARDS.map((reward, i) => {
          const day = i + 1;
          const reached = day <= filledDays;
          const isCap = day === CAP_DAY;
          return (
            <div
              key={day}
              title={`Day ${day}${isCap ? '+' : ''}: $${reward}`}
              className={`flex-1 h-1.5 rounded-full transition-colors ${
                reached
                  ? (isCap ? 'bg-amber-400' : 'bg-orange-500')
                  : darkMode ? 'bg-zinc-700' : 'bg-zinc-200'
              }`}
            />
          );
        })}
      </div>
      <p className={`text-[10px] leading-tight mb-1 text-center ${darkMode ? 'text-zinc-400' : 'text-zinc-500'}`}>
        {statusLine}
      </p>

      <button
        onClick={handleButtonClick}
        onMouseEnter={() => hasCheckedIn && setShowTooltip(true)}
        onMouseLeave={() => setShowTooltip(false)}
        disabled={loading}
        className={`w-full py-1.5 text-xs font-semibold uppercase rounded-sm ${
          hasCheckedIn
            ? 'bg-slate-400 cursor-pointer'
            : loading
              ? 'bg-orange-600 opacity-50 cursor-not-allowed'
              : 'bg-orange-600 hover:bg-orange-700'
        } text-white`}
      >
        {loading ? 'Checking in...' : hasCheckedIn ? 'Checked In ✓' : `Daily Check-in (+$${claimReward})`}
      </button>

      {showTooltip && hasCheckedIn && (
        <div className={`absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 px-3 py-2 rounded-sm text-xs whitespace-nowrap z-50 ${
          darkMode ? 'bg-zinc-800 text-zinc-100' : 'bg-zinc-900 text-white'
        } shadow-lg`}>
          <div className="text-center">
            <div className="font-semibold">Next check-in available in:</div>
            <div className="text-orange-400 font-mono mt-1">{timeUntilReset}</div>
          </div>
          <div className={`absolute top-full left-1/2 transform -translate-x-1/2 border-4 border-transparent ${
            darkMode ? 'border-t-slate-700' : 'border-t-slate-800'
          }`} />
        </div>
      )}
    </div>
  );
};

export default CheckInButton;
