import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAppContext } from '../context/AppContext';
import { getThemeClasses } from '../utils/theme';

const ROTATE_MS = 6000;

// Home-page teaser for the predictions page. The bars are purely decorative
// (see index.css predDrift* keyframes): no labels or numbers, so nobody can
// mistake them for live odds. Below them, the card features a real open
// weekly question (rotating through them when there are several) so people
// see what they are clicking for. The whole card is one click target.
const PredictionsTeaser = ({ predictions = [] }) => {
  const navigate = useNavigate();
  const { darkMode } = useAppContext();
  const { cardClass, mutedClass, textClass } = getThemeClasses(darkMode);
  const trackClass = darkMode ? 'bg-zinc-800' : 'bg-slate-200';

  // Same "open weekly" definition as PredictionsPage, minus resolved ones —
  // a teaser should only advertise bets you can still place.
  const openWeekly = predictions.filter(
    (p) => p.type !== 'event' && !p.hidden && !p.cancelled && !p.resolved
  );

  const [idx, setIdx] = useState(0);
  useEffect(() => {
    if (openWeekly.length < 2) return undefined;
    const t = setInterval(() => setIdx((i) => i + 1), ROTATE_MS);
    return () => clearInterval(t);
  }, [openWeekly.length]);

  const featured = openWeekly.length > 0 ? openWeekly[idx % openWeekly.length] : null;

  return (
    <button
      onClick={() => navigate('/predictions')}
      className={`${cardClass} border rounded-sm p-4 mb-4 w-full text-left cursor-pointer transition-colors hover:border-orange-600 group`}
    >
      <div className="flex justify-between items-center mb-3">
        <p className={`text-xs font-semibold uppercase ${mutedClass}`}>🔮 Predictions</p>
        {openWeekly.length > 0 ? (
          <span className="text-xs font-semibold text-orange-600">
            {openWeekly.length} live bet{openWeekly.length !== 1 ? 's' : ''} →
          </span>
        ) : (
          <span className="text-xs font-semibold text-orange-600 group-hover:translate-x-0.5 transition-transform">→</span>
        )}
      </div>

      <div className="space-y-1.5 mb-3" aria-hidden="true">
        <div className={`h-2 rounded-full overflow-hidden ${trackClass}`}>
          <div className="pred-teaser-bar-a h-full rounded-full bg-gradient-to-r from-orange-500 to-amber-400" />
        </div>
        <div className={`h-2 rounded-full overflow-hidden ${trackClass}`}>
          <div className="pred-teaser-bar-b h-full rounded-full bg-gradient-to-r from-purple-500 to-fuchsia-400" />
        </div>
        <div className={`h-2 rounded-full overflow-hidden ${trackClass}`}>
          <div className="pred-teaser-bar-c h-full rounded-full bg-gradient-to-r from-sky-500 to-cyan-400" />
        </div>
      </div>

      {featured ? (
        <div className="min-h-[3.25rem]">
          <p className={`text-[10px] font-semibold uppercase tracking-wide ${mutedClass}`}>This week</p>
          {/* key remounts the line on rotation so it fades in */}
          <p key={featured.id} className={`text-sm font-semibold leading-snug line-clamp-2 animate-fadeIn ${textClass}`}>
            {featured.question}
          </p>
        </div>
      ) : (
        <p className={`text-sm ${textClass}`}>Bet on what happens next in the story.</p>
      )}
      <p className="text-xs font-semibold text-orange-600 mt-1 group-hover:underline">Place your bets</p>
    </button>
  );
};

export default PredictionsTeaser;
