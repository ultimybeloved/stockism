import { useState, useEffect } from 'react';
import { toDateString } from '../utils/date';

const CheckInButton = ({ isGuest, lastCheckin, onCheckin, darkMode, loading }) => {
  const [showTooltip, setShowTooltip] = useState(false);
  const [timeUntilReset, setTimeUntilReset] = useState('');

  const today = new Date().toDateString();
  const lastCheckinStr = toDateString(lastCheckin);
  const hasCheckedIn = !isGuest && lastCheckinStr === today;

  useEffect(() => {
    if (!hasCheckedIn) return;

    const updateTimer = () => {
      const now = new Date();
      const tomorrow = new Date(now);
      tomorrow.setDate(tomorrow.getDate() + 1);
      tomorrow.setHours(0, 0, 0, 0);

      const diff = tomorrow - now;
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

  return (
    <div className="relative mt-2">
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
        {loading ? 'Checking in...' : hasCheckedIn ? 'Checked In ✓' : 'Daily Check-in (+$300)'}
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
