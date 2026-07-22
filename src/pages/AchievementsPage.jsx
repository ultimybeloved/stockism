import { useAppContext } from '../context/AppContext';
import { ACHIEVEMENTS } from '../constants/achievements';
import { getThemeClasses } from '../utils/theme';
import { getMaxAchievementSlots, toggleDisplayedPin } from '../utils/pinSlots';

const AchievementsPage = ({ onPinAction }) => {
  const { darkMode, userData } = useAppContext();

  const { cardClass, textClass, mutedClass } = getThemeClasses(darkMode);

  const earnedAchievements = userData?.achievements || [];
  const allAchievements = Object.values(ACHIEVEMENTS);
  // Earned achievements can be worn as pins next to your name. Same data and
  // slot rules as the customization modal's My Look tab.
  const displayedPins = (userData?.displayedAchievementPins || []).filter(id => earnedAchievements.includes(id));
  const maxSlots = getMaxAchievementSlots(userData);
  const canWearPins = !!userData && !!onPinAction;

  // Group achievements by category
  const categories = {
    'Trading': ['FIRST_BLOOD', 'SHARK', 'DIVERSIFIED', 'UNIFIER', 'MONOPOLY', 'TRADER_20', 'TRADER_100', 'THATS_A_BIG_DEAL', 'TOPPED_OFF'],
    'Profits': ['BULL_RUN', 'DIAMOND_HANDS', 'COLD_BLOODED', 'NPC_LOVER', 'DISCOUNT_DEACON', 'PROFIT_CHAMPION', 'YOURE_A_WORKER', 'ANIMAL_INSTINCT'],
    'Portfolio': ['BROKE_2K', 'BROKE_5K', 'BROKE_10K', 'BROKE_25K', 'BROKE_50K', 'BROKE_100K', 'BROKE_250K', 'BROKE_500K', 'BROKE_1M', 'DIVIDEND_DEMON'],
    'Predictions': ['ORACLE', 'PROPHET', 'UNDERDOG'],
    'Ladder Game': ['COMPULSIVE_GAMBLER', 'ADDICTED', 'CASINO_CHAMPION', 'JIHOISM'],
    'Dedication': ['DEDICATED_7', 'DEDICATED_14', 'DEDICATED_30', 'DEDICATED_100'],
    'Missions': ['MISSION_10', 'MISSION_50', 'MISSION_100'],
    'Leaderboard': ['TOP_10', 'TOP_3', 'TOP_1'],
    'Crew': ['CROWNED', 'DYNASTY', 'USURPER'],
    'Community': ['DISCORD_LINKED']
  };

  return (
    <div className="max-w-4xl mx-auto p-4">
      <div className={`${cardClass} border rounded-sm shadow-xl overflow-hidden`}>
        <div className={`p-4 border-b ${darkMode ? 'border-zinc-800' : 'border-amber-200'}`}>
          <h2 className={`text-xl font-bold ${textClass}`}>🏆 Achievements</h2>
          <p className={`text-sm ${mutedClass}`}>
            {earnedAchievements.length} / {allAchievements.length} unlocked
          </p>
          {canWearPins && (
            <p className={`text-xs ${mutedClass} mt-1`}>
              📌 Equipped {displayedPins.length}/{maxSlots} as pins next to your name. Tap Equip on an earned achievement to show it off.
            </p>
          )}
        </div>

        <div className="p-4 space-y-6">
          {/* Achievement Categories */}
          {Object.entries(categories).map(([category, achievementIds]) => (
            <div key={category}>
              <h3 className={`font-semibold mb-3 ${textClass}`}>{category}</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {achievementIds.map(id => {
                  const achievement = ACHIEVEMENTS[id];
                  const earned = earnedAchievements.includes(id);

                  return (
                    <div
                      key={id}
                      className={`p-3 rounded-sm border ${
                        earned
                          ? (darkMode ? 'bg-orange-900/30 border-orange-700' : 'bg-orange-50 border-orange-300')
                          : (darkMode ? 'bg-zinc-800/30 border-zinc-700' : 'bg-amber-50 border-amber-200')
                      }`}
                    >
                      <div className="flex items-start gap-3">
                        <span className={`text-2xl inline-flex items-center justify-center ${earned ? '' : 'grayscale opacity-50'}`}>
                          {achievement.icon ? (
                            <img src={`/pins/${achievement.icon}`} alt={achievement.name} className="h-7 w-7 object-contain" />
                          ) : achievement.emoji}
                        </span>
                        <div className="flex-1 min-w-0">
                          <div className={`font-semibold text-sm ${earned ? 'text-orange-500' : mutedClass}`}>
                            {achievement.name}
                          </div>
                          <div className={`text-xs ${mutedClass}`}>
                            {earned ? achievement.description : achievement.hint}
                          </div>
                          {earned && canWearPins && (() => {
                            const isWorn = displayedPins.includes(id);
                            const slotsFull = !isWorn && displayedPins.length >= maxSlots;
                            return (
                              <button
                                onClick={() => !slotsFull && onPinAction('setAchievementPins', toggleDisplayedPin(displayedPins, id, maxSlots), 0)}
                                disabled={slotsFull}
                                className={`mt-1.5 px-2 py-0.5 text-xs font-semibold rounded-sm border ${
                                  isWorn
                                    ? 'border-orange-500 text-orange-500 bg-orange-500/10'
                                    : slotsFull
                                      ? (darkMode ? 'border-zinc-700 text-zinc-600 cursor-not-allowed' : 'border-slate-200 text-slate-400 cursor-not-allowed')
                                      : (darkMode ? 'border-zinc-600 text-zinc-300 hover:border-orange-500 hover:text-orange-500' : 'border-slate-300 text-slate-600 hover:border-orange-500 hover:text-orange-500')
                                }`}
                              >
                                {isWorn ? '📌 Equipped ✓' : slotsFull ? '📌 Slots full' : '📌 Equip'}
                              </button>
                            );
                          })()}
                        </div>
                        {earned && <span className={`text-sm ${userData?.colorBlindMode ? 'text-teal-500' : 'text-green-500'}`}>✓</span>}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default AchievementsPage;
