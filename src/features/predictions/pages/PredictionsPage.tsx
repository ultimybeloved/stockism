import { useEffect, useState, type ReactNode } from 'react';
import { useSession, useMarket } from '../../../context/AppContext';
import { useNewPredictions } from '../hooks/useNewPredictions';
import { useSideGameRoom } from '../hooks/useSideGameRoom';
import { themeClasses } from '../../../utils/theme';
import { isWeeklyHalt } from '../../../utils/marketHours';
import { marketTimes } from '../../../utils/localTime';
import { getTotalInvested } from '../../../utils/calculations';
import { useWideScreen } from '../../../shared/hooks/useMediaQuery';
import { useSheetRef } from '../../../shared/hooks/useSwipeToClose';
import { useEscapeKey } from '../../../shared/hooks/useEscapeKey';
import SheetHandle from '../../../shared/components/SheetHandle';
import PixelIcon from '../../../shared/components/PixelIcon';
import type { EventMarketDoc } from '../../../types';
import type { usePredictionManagement } from '../hooks/usePredictionManagement';
import type { SlipPick } from '../types';
import ChapterHero from '../components/ChapterHero';
import WeeklyQuestion from '../components/WeeklyQuestion';
import FuturesBand from '../components/FuturesBand';
import FuturesMarket from '../components/FuturesMarket';
import SettledList from '../components/SettledList';
import OpenBets from '../components/OpenBets';
import BetSlip, { type BetSlipProps } from '../components/BetSlip';

type PredictionHandlers = ReturnType<typeof usePredictionManagement>;

interface PredictionsPageProps {
  isGuest: boolean;
  isAdmin?: boolean;
  onBet: PredictionHandlers['handleBet'];
  onHidePrediction: (predictionId: string) => void;
  onBuyEventShares: PredictionHandlers['handleBuyEventShares'];
  onSellEventShares: PredictionHandlers['handleSellEventShares'];
}

const WEEK = 7 * 24 * 60 * 60 * 1000;

// One page, top to bottom: the chapter and its weekly bets (orange), futures
// on an indigo band, then what has settled. Tapping an answer fills the bet
// slip: a right-hand column on desktop, a bottom sheet on phones.
const PredictionsPage = ({
  isGuest,
  isAdmin,
  onBet,
  onHidePrediction,
  onBuyEventShares,
  onSellEventShares,
}: PredictionsPageProps) => {
  const { userData } = useSession();
  const { marketData, predictions } = useMarket();
  const wide = useWideScreen();
  const [pick, setPick] = useState<SlipPick | null>(null);
  const close = () => setPick(null);

  // Opening the page is what clears the nav badge.
  const { markSeen } = useNewPredictions();
  useEffect(() => {
    markSeen();
  }, [markSeen]);

  const live = predictions.filter((p) => !p.hidden && !p.cancelled);
  const now = Date.now();
  // Still taking bets first, then the ones waiting on their answer.
  const weekly = live
    .filter((p) => p.type !== 'event' && !p.resolved)
    .sort((a, b) => Number((a.endsAt ?? 0) <= now) - Number((b.endsAt ?? 0) <= now));
  const futures = live
    .filter((m) => m.type === 'event' && !m.resolved)
    .sort((a, b) => Number(!!a.opensAt && now < a.opensAt) - Number(!!b.opensAt && now < b.opensAt));
  const settled = live.filter((p) => p.resolved && (p.type === 'event' || now - (p.endsAt ?? 0) < WEEK));

  const closedReason = marketData?.marketHalted
    ? `Betting is paused: ${marketData.haltReason || 'market halted'}.`
    : isWeeklyHalt()
      ? `Betting is closed for chapter review. It reopens ${marketTimes().reopen}.`
      : null;

  // One limit shared by weekly bets, futures and the ladder.
  const sideRoom = useSideGameRoom();
  const available = Math.min(sideRoom, userData?.cash || 0);
  const question = (pick && live.find((p) => p.id === pick.id)) || null;

  const slip: BetSlipProps = {
    pick,
    question: question as EventMarketDoc | null,
    userBet: pick ? userData?.bets?.[pick.id] : undefined,
    position: pick ? userData?.eventPositions?.[pick.id] : undefined,
    available,
    noInvestment: getTotalInvested(userData?.holdings, userData?.costBasis, userData?.shorts) <= 0,
    isGuest,
    closedReason,
    onBet,
    onBuy: onBuyEventShares,
    onSell: onSellEventShares,
    onPick: setPick,
    onDone: close,
  };
  const { mutedClass } = themeClasses;

  return (
    <div className="max-w-6xl mx-auto px-4 pt-6 pb-10 lg:grid lg:grid-cols-[minmax(0,1fr)_20rem] lg:gap-8 lg:items-start">
      <div className="min-w-0">
        <ChapterHero weekly={weekly} />
        {closedReason && (
          <p className="mt-4 p-3 rounded-sm text-sm light:bg-amber-100 light:text-amber-900 dark:bg-zinc-900 dark:text-zinc-300">
            <PixelIcon name="lock" className="w-4 h-4 mr-1 align-[-3px]" />
            {closedReason}
          </p>
        )}
        {weekly.length > 0 ? (
          <div className="grid sm:grid-cols-2 gap-3 mt-4 items-start">
            {weekly.map((p) => (
              <WeeklyQuestion key={p.id} prediction={p} userBet={userData?.bets?.[p.id]} pick={pick} onPick={setPick} />
            ))}
          </div>
        ) : (
          <p className={`mt-4 text-sm ${mutedClass}`}>Weekly questions go up after each chapter review.</p>
        )}

        <FuturesBand count={futures.length}>
          {futures.map((m) => (
            <FuturesMarket
              key={m.id}
              market={m}
              position={userData?.eventPositions?.[m.id]}
              pick={pick}
              onPick={setPick}
            />
          ))}
        </FuturesBand>

        <SettledList items={settled} isAdmin={isAdmin} onHide={onHidePrediction} />
      </div>

      {wide ? (
        <aside className="sticky top-20">
          <BetSlip {...slip} />
          <OpenBets weekly={weekly} futures={futures} />
        </aside>
      ) : (
        pick && (
          <SlipSheet onClose={close}>
            <BetSlip {...slip} sheet />
          </SlipSheet>
        )
      )}
    </div>
  );
};

// Phones and tablets: the slip rises from the bottom. Drag down or tap outside to close.
const SlipSheet = ({ onClose, children }: { onClose: () => void; children: ReactNode }) => {
  const ref = useSheetRef(onClose);
  useEscapeKey(onClose);
  const { sheetOverlayClass, sheetShellClass } = themeClasses;
  return (
    <div className={`${sheetOverlayClass} z-50`} onClick={onClose}>
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label="Bet slip"
        className={`${sheetShellClass} max-w-md pt-3`}
        onClick={(e) => e.stopPropagation()}
      >
        <SheetHandle />
        {children}
      </div>
    </div>
  );
};

export default PredictionsPage;
