import React from 'react';
import { useAppContext } from '../context/AppContext';
import { ACHIEVEMENTS } from '../constants/achievements';

const AchievementsPage = () => {
  const { darkMode, userData } = useAppContext();

  const cardClass = darkMode ? 'bg-zinc-900 border-zinc-800' : 'bg-white border-amber-200';
  const textClass = darkMode ? 'text-zinc-100' : 'text-slate-900';
  const mutedClass = darkMode ? 'text-zinc-400' : 'text-zinc-600';

  const earnedAchievements = userData?.achievements || [];
  const allAchievements = Object.values(ACHIEVEMENTS);

  // Group achievements by category
  const categories = {
    'Trading': ['FIRST_BLOOD', 'SHARK', 'DIVERSIFIED', 'UNIFIER', 'TRADER_20', 'TRADER_100'],
    'Profits': ['BULL_RUN', 'DIAMOND_HANDS', 'COLD_BLOODED', 'NPC_LOVER'],
    'Portfolio': ['BROKE_2K', 'BROKE_5K', 'BROKE_10K', 'BROKE_25K', 'BROKE_50K', 'BROKE_100K', 'BROKE_250K', 'BROKE_500K', 'BROKE_1M'],
    'Predictions': ['ORACLE', 'PROPHET'],
    'Ladder Game': ['COMPULSIVE_GAMBLER', 'ADDICTED'],
    'Dedication': ['DEDICATED_7', 'DEDICATED_14', 'DEDICATED_30', 'DEDICATED_100'],
    'Missions': ['MISSION_10', 'MISSION_50', 'MISSION_100'],
    'Leaderboard': ['TOP_10', 'TOP_3', 'TOP_1']
  };

  return (
    <div className="max-w-4xl mx-auto p-4">
      <div className={`${cardClass} border rounded-sm shadow-xl overflow-hidden`}>
        <div className={`p-4 border-b ${darkMode ? 'border-zinc-800' : 'border-amber-200'}`}>
          <h2 className={`text-xl font-bold ${textClass}`}>🏆 Achievements</h2>
          <p className={`text-sm ${mutedClass}`}>
            {earnedAchievements.length} / {allAchievements.length} unlocked
          </p>
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
                        <span className={`text-2xl ${earned ? '' : 'grayscale opacity-50'}`}>
                          {achievement.emoji}
                        </span>
                        <div className="flex-1 min-w-0">
                          <div className={`font-semibold text-sm ${earned ? 'text-orange-500' : mutedClass}`}>
                            {achievement.name}
                          </div>
                          <div className={`text-xs ${mutedClass}`}>
                            {earned ? achievement.description : achievement.hint}
                          </div>
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
