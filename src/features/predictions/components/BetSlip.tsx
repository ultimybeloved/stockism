// The bet slip: everything about the answer you picked, and the one button.
// Desktop keeps it in the right column; phones get it as a bottom sheet,
// where a sideways swipe flips to the question's other answers.
import { useRef, type TouchEvent } from 'react';
import { themeClasses } from '../../../utils/theme';
import { formatCurrency } from '../../../utils/formatters';
import type { EventMarketDoc, EventPosition, PredictionDoc, UserBet } from '../../../types';
import { optionsOf } from '../utils/odds';
import type { SlipPick } from '../types';
import WeeklySlip from './WeeklySlip';
import FuturesSlip from './FuturesSlip';
import { SlipNote } from './SlipParts';

type TradeShares = (marketId: string, outcome: string, shares: number) => Promise<unknown>;

export interface BetSlipProps {
  pick: SlipPick | null;
  /** The question the pick points at, if it's still on the page. */
  question: PredictionDoc | EventMarketDoc | null;
  userBet?: UserBet;
  position?: EventPosition;
  /** Money available for a bet right now. */
  available: number;
  noInvestment: boolean;
  isGuest: boolean;
  /** Why trading is shut right now, or null when it's open. */
  closedReason: string | null;
  onBet: (predictionId: string, option: string, amount: number) => Promise<boolean>;
  onBuy: TradeShares;
  onSell: TradeShares;
  onPick: (pick: SlipPick) => void;
  onDone: () => void;
  /** Phones: the slip is a bottom sheet with swipe gestures. */
  sheet?: boolean;
}

const SWIPE = 50;

const BetSlip = (props: BetSlipProps) => {
  const { pick, question: q, available, isGuest, closedReason, onPick, onDone, sheet } = props;
  const { cardClass, textClass, mutedClass } = themeClasses;
  const futures = pick?.kind === 'futures';
  const options = q ? (futures ? (q as EventMarketDoc).outcomes || ['Yes', 'No'] : optionsOf(q)) : [];

  // Sideways swipe flips through the answers; up and down is left to the sheet.
  const start = useRef<{ x: number; y: number } | null>(null);
  const onTouchStart = (e: TouchEvent) => {
    const t = e.touches[0]!;
    start.current = (e.target as HTMLElement).closest('input') ? null : { x: t.clientX, y: t.clientY };
  };
  const onTouchEnd = (e: TouchEvent) => {
    const s = start.current;
    start.current = null;
    if (!s || !pick || options.length < 2) return;
    const t = e.changedTouches[0]!;
    const dx = t.clientX - s.x;
    if (Math.abs(dx) < SWIPE || Math.abs(dx) < Math.abs(t.clientY - s.y)) return;
    const at = options.indexOf(pick.option);
    onPick({ ...pick, sell: false, option: options[(at + (dx < 0 ? 1 : -1) + options.length) % options.length]! });
  };

  const body = () => {
    if (!pick || !q) return <p className={`mt-3 text-sm ${mutedClass}`}>Pick an answer to start a bet.</p>;
    if (isGuest) return <SlipNote>Sign in to place bets.</SlipNote>;
    if (closedReason) return <SlipNote>{closedReason}</SlipNote>;
    if (futures) {
      const m = q as EventMarketDoc;
      if (m.resolved) return <SlipNote>This market has settled.</SlipNote>;
      if (m.opensAt && Date.now() < m.opensAt) return <SlipNote>This market hasn't opened yet.</SlipNote>;
      return (
        <FuturesSlip
          key={`${pick.id}:${pick.option}:${pick.sell ? 's' : 'b'}`}
          market={m}
          option={pick.option}
          position={props.position}
          startOnSell={pick.sell}
          budget={available}
          noInvestment={props.noInvestment}
          onBuy={props.onBuy}
          onSell={props.onSell}
          onDone={onDone}
        />
      );
    }
    if (q.resolved || (q.endsAt ?? 0) <= Date.now()) return <SlipNote>Betting has closed on this question.</SlipNote>;
    return (
      <WeeklySlip
        key={`${pick.id}:${pick.option}`}
        prediction={q}
        option={pick.option}
        userBet={props.userBet}
        limit={available}
        onBet={props.onBet}
        onDone={onDone}
        onSwitch={(option) => onPick({ ...pick, option })}
      />
    );
  };

  return (
    <div
      className={
        sheet
          ? ''
          : `${cardClass} border slip-tear rounded-t-sm ${futures ? 'light:border-indigo-200 dark:border-indigo-900' : ''}`
      }
    >
      <div className="px-4 py-3 flex justify-between items-baseline gap-3 border-b border-dashed light:border-amber-300 dark:border-zinc-700">
        <h2 className={`font-bold ${textClass}`}>Bet slip</h2>
        {!isGuest && (
          <span className={`text-xs tabular-nums ${mutedClass}`}>{formatCurrency(available)} available</span>
        )}
      </div>
      <div
        className="px-4 pt-3 pb-4"
        onTouchStart={sheet ? onTouchStart : undefined}
        onTouchEnd={sheet ? onTouchEnd : undefined}
      >
        {pick && q && (
          <>
            <p className={`text-xs ${mutedClass}`}>{q.question}</p>
            <div className="flex items-baseline justify-between gap-2 mt-0.5">
              <p className={`text-lg font-bold leading-snug ${textClass}`}>{pick.option}</p>
              {sheet && options.length > 1 && (
                <span className={`text-[11px] shrink-0 ${mutedClass}`}>Swipe for {options.length - 1} more</span>
              )}
            </div>
          </>
        )}
        {body()}
      </div>
    </div>
  );
};

export default BetSlip;
