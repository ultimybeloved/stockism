import { memo } from 'react';
import { useSession } from '../../../context/AppContext';

import { ACHIEVEMENTS, ACHIEVEMENT_MAP } from '../../../constants/achievements';
import { themeClasses } from '../../../utils/theme';
import { getMaxAchievementSlots, toggleDisplayedPin } from '../../../utils/pinSlots';
import type { PinAction } from '../hooks/usePinShop';
import AchievementIcon from '../../../shared/components/AchievementIcon';
import PixelIcon from '../../../shared/components/PixelIcon';
import AchievementCard from '../components/AchievementCard';
import { achievementProgress } from '../utils/achievementProgress';
import { ACHIEVEMENT_CATEGORIES } from '../utils/achievementCategories';

const AchievementsPage = ({
  onPinAction,
}: {
  onPinAction?: (action: PinAction, payload: unknown, cost?: number) => void;
}) => {
  const { userData } = useSession();

  const { cardClass, textClass, mutedClass } = themeClasses;

  const earnedAchievements = userData?.achievements || [];
  const allAchievements = Object.values(ACHIEVEMENTS);
  // Earned achievements can be worn as pins next to your name. Same data and
  // slot rules as the customization modal's My Look tab.
  // Client-writable, so anything that isn't a list is ignored.
  const pinList = userData?.displayedAchievementPins;
  const displayedPins = (Array.isArray(pinList) ? (pinList as string[]) : []).filter((id) =>
    earnedAchievements.includes(id),
  );
  const maxSlots = getMaxAchievementSlots(userData);
  const canWearPins = !!userData && !!onPinAction;
  const togglePin = (id: string) =>
    onPinAction?.('setAchievementPins', toggleDisplayedPin(displayedPins, id, maxSlots), 0);

  return (
    <div className="max-w-4xl mx-auto p-4">
      <div className={`${cardClass} border rounded-sm shadow-xl overflow-hidden`}>
        <div className="p-4 border-b light:border-amber-200 dark:border-zinc-800">
          <h2 className={`text-xl font-bold ${textClass}`}>
            <PixelIcon name="medal" className="w-5 h-5 mr-1.5 align-[-3px]" />
            Achievements
          </h2>
          <p className={`text-sm ${mutedClass}`}>
            {earnedAchievements.length} / {allAchievements.length} unlocked
          </p>
          {canWearPins && (
            <div className="mt-3">
              <p className={`text-xs ${mutedClass}`}>
                Pins next to your name ({displayedPins.length}/{maxSlots}). Tap one to take it off.
              </p>
              <div className="mt-1.5 flex flex-wrap gap-2">
                {displayedPins.map((id) => {
                  const a = ACHIEVEMENT_MAP[id];
                  if (!a) return null;
                  return (
                    <button
                      key={id}
                      onClick={() => togglePin(id)}
                      title="Take off"
                      className="flex items-center gap-1.5 pl-1.5 pr-2.5 py-1 rounded-sm border text-xs font-semibold text-orange-500 border-orange-500/60 bg-orange-500/10 hover:border-orange-500"
                    >
                      <AchievementIcon achievement={a} className="h-5 w-5" />
                      {a.name}
                    </button>
                  );
                })}
                {Array.from({ length: Math.max(0, maxSlots - displayedPins.length) }, (_, i) => (
                  <span
                    key={`empty-${i}`}
                    className={`flex items-center px-2.5 py-1 rounded-sm border border-dashed text-xs light:border-amber-300 dark:border-zinc-700 ${mutedClass}`}
                  >
                    Empty slot
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="p-4 space-y-6">
          {Object.entries(ACHIEVEMENT_CATEGORIES).map(([category, achievementIds]) => (
            <div key={category}>
              <h3 className={`font-semibold mb-3 ${textClass}`}>{category}</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {achievementIds.map((id) => {
                  const achievement = ACHIEVEMENT_MAP[id];
                  if (!achievement) return null;
                  const earned = earnedAchievements.includes(id);
                  const worn = displayedPins.includes(id);
                  return (
                    <AchievementCard
                      key={id}
                      achievement={achievement}
                      earned={earned}
                      progress={achievementProgress(id, userData)}
                      pin={
                        earned && canWearPins ? { worn, slotsFull: !worn && displayedPins.length >= maxSlots } : null
                      }
                      onTogglePin={() => togglePin(id)}
                    />
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

export default memo(AchievementsPage);
