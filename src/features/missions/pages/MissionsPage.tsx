import type { ReactNode } from 'react';
import { CREW_MAP } from '../../../crews';
import { formatCurrency } from '../../../utils/formatters';
import { themeClasses } from '../../../utils/theme';
import { type WeeklyProgress } from '../../../utils/missionProgress';
import { useSession } from '../../../context/AppContext';
import CrewPin from '../../../shared/components/CrewPin';
import { flairOf } from '../../../rules/flairCrews';
import MissionCard from '../components/MissionCard';
import RivalryTab from '../components/RivalryTab';
import RerollButton from '../components/RerollButton';
import WeekStrip from '../components/WeekStrip';
import ShopCreditProgress from '../components/ShopCreditProgress';
import WeekRecapCard from '../components/WeekRecapCard';
import { useWeeklyRecap } from '../hooks/useWeeklyRecap';
import { useMissionBoard } from '../hooks/useMissionBoard';

type ClaimReward = (missionId: string, reward: number) => unknown;

interface MissionsPageProps {
  isGuest: boolean;
  onClaimReward: ClaimReward;
  onClaimWeeklyReward: ClaimReward;
  onRerollMissions: () => unknown;
  onOpenCrewSelection: () => void;
  onShowLogin: () => void;
  claimLoading?: boolean;
  claimWeeklyLoading?: boolean;
  rerollLoading?: boolean;
}

const Section = ({ title, aside, children }: { title: string; aside?: ReactNode; children: ReactNode }) => (
  <section className="space-y-2">
    <div className="flex items-center justify-between gap-2 min-h-7">
      <h2 className={`text-lg font-semibold ${themeClasses.textClass}`}>{title}</h2>
      {aside}
    </div>
    {children}
  </section>
);

// /missions: the week at a glance, this week's and today's missions, and the
// crew rivalry.
export default function MissionsPage({
  isGuest,
  onClaimReward,
  onClaimWeeklyReward,
  onRerollMissions,
  onOpenCrewSelection,
  onShowLogin,
  claimLoading,
  claimWeeklyLoading,
  rerollLoading,
}: MissionsPageProps) {
  const { userData } = useSession();
  const board = useMissionBoard();
  const { recap } = useWeeklyRecap();
  const { cardClass, mutedClass } = themeClasses;

  if (isGuest) {
    return (
      <div className="max-w-xl mx-auto p-4">
        <div className={`${cardClass} border rounded-sm p-6 text-center`}>
          <h1 className="text-xl font-bold text-orange-500 mb-2">Missions</h1>
          <p className={`text-sm ${mutedClass} mb-4`}>
            Finish daily and weekly missions for cash rewards, and help your crew win its rivalry.
          </p>
          <button
            onClick={onShowLogin}
            className="px-4 py-2 bg-orange-600 hover:bg-orange-700 text-white text-sm font-semibold rounded-sm"
          >
            Sign in
          </button>
        </div>
      </div>
    );
  }

  const weekly = (userData?.weeklyMissions?.[board.weekId] || {}) as WeeklyProgress;
  const crew = board.crew ? CREW_MAP[board.crew] : null;
  const flair = flairOf(userData);

  return (
    <div className="max-w-6xl mx-auto p-4 space-y-4">
      <WeekStrip weekly={weekly} />
      <ShopCreditProgress total={userData?.totalMissionsCompleted || 0} credit={userData?.shopCredit || 0} />

      {board.multiplier > 1 && (
        <p className="px-3 py-2 rounded-sm border border-orange-500/30 bg-orange-500/10 text-orange-500 text-sm font-semibold">
          Underdog bonus: all mission rewards x{board.multiplier} this week
        </p>
      )}

      <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
        <div className="space-y-6 min-w-0">
          <Section
            title="Weekly"
            aside={board.weeklyClaimable > 0 && <span className="text-sm text-purple-500">Ready to claim</span>}
          >
            <div className="grid gap-3 sm:grid-cols-2">
              {board.weeklyMissions.map((m) => (
                <MissionCard
                  key={m.id}
                  mission={m}
                  accent="purple"
                  onClaim={onClaimWeeklyReward}
                  claiming={claimWeeklyLoading}
                />
              ))}
            </div>
          </Section>

          <Section
            title="Today"
            aside={
              board.canReroll ? (
                <RerollButton onReroll={onRerollMissions} loading={rerollLoading} />
              ) : (
                board.hasRerolled && <span className={`text-xs ${mutedClass} italic`}>Rerolled this week</span>
              )
            }
          >
            <p className={`text-xs ${mutedClass}`}>
              New missions at 00:00 UTC. Earned today:{' '}
              <span className="text-orange-500">{formatCurrency(board.dailyTotals.earned)}</span> of{' '}
              {formatCurrency(board.dailyTotals.total)}
            </p>
            <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-1 xl:grid-cols-3">
              {board.dailyMissions.map((m) => (
                <MissionCard key={m.id} mission={m} accent="orange" onClaim={onClaimReward} claiming={claimLoading} />
              ))}
            </div>
          </Section>

          {recap && <WeekRecapCard recap={recap} />}

          <div className={`p-3 rounded-sm border ${themeClasses.borderClass} space-y-1`}>
            <p className={`text-xs ${mutedClass}`}>
              A trade counts if it's at least 1 share, or $50 worth if you buy part of a share. You don't have to keep
              what you buy.
            </p>
            {crew && (
              <p className={`text-xs ${mutedClass} flex items-center flex-wrap gap-1`}>
                <CrewPin crew={crew} className="w-4 h-4 inline" />
                {crew.name} members: {crew.members.join(', ')}
              </p>
            )}
            {crew && flair && (
              <p className={`text-xs ${mutedClass} flex items-center flex-wrap gap-1`}>
                <CrewPin crew={crew} flair={flair} className="w-4 h-4 inline" />
                {flair.name} members: {flair.members.length ? flair.members.join(', ') : 'none on the site yet'}
              </p>
            )}
          </div>
        </div>

        <div data-tour="rivalry" className="self-start">
          <Section title="Rivalry">
            <RivalryTab multiplier={board.multiplier} onJoinCrew={onOpenCrewSelection} />
          </Section>
        </div>
      </div>
    </div>
  );
}
