import { MISSION_MIN_TRADE_FLOOR, MISSION_MIN_TRADE_CAP } from '../../../rules/missions';
import { useState } from 'react';
import RivalryTab from './RivalryTab';
import MissionCard from './MissionCard';
import { CREW_MAP } from '../../../crews';
import { formatCurrency } from '../../../utils/formatters';
import { formatDateTime } from '../../../utils/localTime';
import { missionWeekEndMs } from '../../../utils/missionProgress';
import { themeClasses } from '../../../utils/theme';
import { useSession } from '../../../context/AppContext';
import { useEscapeKey } from '../../../shared/hooks/useEscapeKey';
import { useModalFocus } from '../../../shared/hooks/useModalFocus';
import PixelIcon from '../../../shared/components/PixelIcon';
import CrewPin from '../../../shared/components/CrewPin';
import { useMissionBoard } from '../hooks/useMissionBoard';

type ClaimReward = (missionId: string, reward: number) => unknown;
type MissionTab = 'daily' | 'weekly' | 'rivalry';

interface DailyMissionsModalProps {
  onClose: () => void;
  onClaimReward: ClaimReward;
  onClaimWeeklyReward: ClaimReward;
  onRerollMissions: () => unknown;
  onOpenCrewSelection: () => void;
  isGuest?: boolean;
  claimLoading?: boolean;
  claimWeeklyLoading?: boolean;
  rerollLoading?: boolean;
}

const TABS: { id: MissionTab; label: string; active: string }[] = [
  { id: 'daily', label: 'Daily', active: 'text-orange-500 border-orange-500 bg-orange-500/10' },
  { id: 'weekly', label: 'Weekly', active: 'text-purple-500 border-purple-500 bg-purple-500/10' },
  { id: 'rivalry', label: 'Rivalry', active: 'text-blue-500 border-blue-500 bg-blue-500/10' },
];

const DailyMissionsModal = ({
  onClose,
  onClaimReward,
  onClaimWeeklyReward,
  onRerollMissions,
  onOpenCrewSelection,
  isGuest,
  claimLoading,
  claimWeeklyLoading,
  rerollLoading,
}: DailyMissionsModalProps) => {
  useEscapeKey(onClose);
  const dialogRef = useModalFocus();
  const { userData } = useSession();
  const board = useMissionBoard();
  const [activeTab, setActiveTab] = useState<MissionTab>('daily');
  const [confirmReroll, setConfirmReroll] = useState(false);
  const { textClass, mutedClass, overlayClass, modalShellClass, cardEdgeClass } = themeClasses;
  const dot = <span className={`ml-1 ${userData?.colorBlindMode ? 'text-teal-500' : 'text-green-500'}`}>●</span>;
  const joinCrew = () => {
    onClose();
    onOpenCrewSelection();
  };

  return (
    <div className={`${overlayClass} z-50`} onClick={onClose}>
      <div
        ref={dialogRef}
        className={`${modalShellClass} max-w-md overflow-hidden`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className={`p-4 border-b ${cardEdgeClass}`}>
          <div className="flex justify-between items-center">
            <h2 className={`text-lg font-semibold ${textClass}`}>
              <PixelIcon name="missions" className="w-5 h-5 mr-1.5 align-[-3px]" />
              Missions
            </h2>
            <button aria-label="Close" onClick={onClose} className={`p-2 ${mutedClass} hover:text-orange-500 text-xl`}>
              <span aria-hidden="true">×</span>
            </button>
          </div>
        </div>

        <div className={`grid grid-cols-3 border-b ${cardEdgeClass}`}>
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setActiveTab(t.id)}
              className={`py-2.5 text-sm font-semibold transition-colors ${
                activeTab === t.id ? `border-b-2 ${t.active}` : `${mutedClass} hover:bg-slate-500/10`
              }`}
            >
              {t.label}
              {t.id === 'daily' && board.dailyTotals.claimable > 0 && dot}
              {t.id === 'weekly' && board.weeklyClaimable > 0 && dot}
            </button>
          ))}
        </div>

        {!isGuest && activeTab !== 'rivalry' && (
          <div className="px-4 py-2 light:bg-amber-50 dark:bg-zinc-800/50 flex items-center justify-between gap-2">
            <p className={`text-xs ${mutedClass}`}>
              {activeTab === 'daily' ? (
                <>
                  Resets daily at 00:00 UTC • Earned:{' '}
                  <span className="text-orange-500">{formatCurrency(board.dailyTotals.earned)}</span> /{' '}
                  {formatCurrency(board.dailyTotals.total)}
                </>
              ) : (
                <>New week {formatDateTime(missionWeekEndMs())}</>
              )}
            </p>
            {board.canReroll && (
              <button
                onClick={() => {
                  if (!confirmReroll) return setConfirmReroll(true);
                  setConfirmReroll(false);
                  onRerollMissions();
                }}
                onBlur={() => setConfirmReroll(false)}
                disabled={rerollLoading}
                className={`flex items-center gap-1 px-2 py-1 text-xs font-semibold rounded-sm transition-colors shrink-0 ${
                  rerollLoading
                    ? 'opacity-50 cursor-not-allowed'
                    : 'light:bg-amber-200 light:hover:bg-amber-300 light:text-amber-800 dark:bg-zinc-700 dark:hover:bg-zinc-600 dark:text-zinc-200'
                }`}
                title="Reroll today's missions and this week's mission ($50)"
              >
                {rerollLoading ? (
                  '...'
                ) : confirmReroll ? (
                  'Confirm reroll for $50?'
                ) : (
                  <>
                    <PixelIcon name="reroll" className="w-3.5 h-3.5 mr-1 align-[-2px]" />
                    Reroll $50
                  </>
                )}
              </button>
            )}
            {board.hasRerolled && <span className={`text-xs ${mutedClass} italic shrink-0`}>Rerolled ✓</span>}
          </div>
        )}

        {!isGuest && board.multiplier > 1 && (
          <div className="px-4 py-1.5 light:bg-orange-100 dark:bg-orange-900/30 border-b border-orange-500/30">
            <p className="text-orange-500 text-xs text-center font-semibold">
              Underdog bonus: all mission rewards x{board.multiplier} this week
            </p>
          </div>
        )}

        <div className="p-4 space-y-3 max-h-[28rem] overflow-y-auto">
          {isGuest ? (
            <div className="p-4 rounded-sm light:bg-amber-50 dark:bg-zinc-800/50 text-center">
              <p className="text-amber-500 mb-2">Sign in to access missions!</p>
              <p className={`text-xs ${mutedClass}`}>Complete missions to earn bonus cash rewards.</p>
            </div>
          ) : activeTab === 'rivalry' ? (
            <RivalryTab multiplier={board.multiplier} onJoinCrew={joinCrew} />
          ) : activeTab === 'daily' ? (
            board.dailyMissions.map((m) => (
              <MissionCard key={m.id} mission={m} accent="orange" onClaim={onClaimReward} claiming={claimLoading} />
            ))
          ) : (
            board.weeklyMissions.map((m) => (
              <MissionCard
                key={m.id}
                mission={m}
                accent="purple"
                onClaim={onClaimWeeklyReward}
                claiming={claimWeeklyLoading}
              />
            ))
          )}

          {!isGuest && activeTab !== 'rivalry' && (
            <div className="p-2 rounded-sm light:bg-amber-50 dark:bg-zinc-800/30 space-y-1">
              <p className={`text-xs ${mutedClass}`}>
                Trades count when they're worth {formatCurrency(board.minTrade)} or more (1% of your net worth, between
                ${MISSION_MIN_TRADE_FLOOR} and ${MISSION_MIN_TRADE_CAP}). For missions that say "keep", own the shares
                until you claim the reward. After that you can sell. Sells count on shares you've held a day.
              </p>
              {board.crew ? (
                <p className={`text-xs ${mutedClass} flex items-center flex-wrap gap-1`}>
                  <CrewPin crew={CREW_MAP[board.crew]} className="w-4 h-4 inline" />
                  {CREW_MAP[board.crew]?.name} members: {CREW_MAP[board.crew]?.members.join(', ')}
                </p>
              ) : (
                <p className={`text-xs ${mutedClass}`}>
                  <button onClick={joinCrew} className="text-orange-500 font-semibold hover:underline">
                    Join a crew
                  </button>{' '}
                  for crew missions and Rivalries.
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default DailyMissionsModal;
