// The bet slip for a weekly question: stake, potential payout, place bet.
// The payout is quoted on the exact stake, since a big bet moves the odds.
import { useState } from 'react';
import { themeClasses } from '../../../utils/theme';
import { formatCurrency, formatMultiplier } from '../../../utils/formatters';
import type { PredictionDoc, UserBet } from '../../../types';
import { poolPayout } from '../utils/odds';
import SlipAmount from './SlipAmount';
import { SlipNote, SlipTotal } from './SlipParts';

interface WeeklySlipProps {
  prediction: PredictionDoc;
  option: string;
  userBet?: UserBet;
  /** Most they can stake: cash, capped by the shared side-game limit. */
  limit: number;
  onBet: (predictionId: string, option: string, amount: number) => Promise<boolean>;
  onDone: () => void;
  onSwitch: (option: string) => void;
}

const WeeklySlip = ({ prediction: p, option, userBet, limit, onBet, onDone, onSwitch }: WeeklySlipProps) => {
  const { textClass, mutedClass } = themeClasses;
  const [stake, setStake] = useState(0);
  const [busy, setBusy] = useState(false);

  // One answer per question. Some questions let you add to it, never switch.
  if (userBet && !p.allowAdditionalBets)
    return (
      <SlipNote>
        You bet {formatCurrency(userBet.amount)} on {userBet.option}. Bets are final.
      </SlipNote>
    );
  if (userBet && userBet.option !== option)
    return (
      <SlipNote>
        You can add to your bet on {userBet.option}, not switch answers.{' '}
        <button
          type="button"
          onClick={() => onSwitch(userBet.option!)}
          className="font-semibold text-orange-600 dark:text-orange-400 hover:underline"
        >
          Open {userBet.option}
        </button>
      </SlipNote>
    );
  if (!(limit > 0))
    return <SlipNote>You can bet up to what you have invested in stocks. Buy some stocks first.</SlipNote>;

  const payout = stake > 0 ? poolPayout(p, option, stake) : 0;
  const place = async () => {
    if (!(stake > 0) || busy) return;
    setBusy(true);
    try {
      if (await onBet(p.id, option, stake)) onDone();
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      {userBet && (
        <p className={`text-xs mt-2 ${mutedClass}`}>
          Adding to your {formatCurrency(userBet.amount)} on {userBet.option}.
        </p>
      )}
      <SlipAmount label="Stake" value={stake} onChange={setStake} max={limit} dollars tone="weekly" />
      <SlipTotal label="Potential payout" value={formatCurrency(payout)}>
        {stake > 0 && (
          <>
            Odds {formatMultiplier(payout / stake)}. Profit {formatCurrency(payout - stake)}
          </>
        )}
      </SlipTotal>
      <button
        type="button"
        onClick={place}
        disabled={!(stake > 0) || busy}
        className="mt-3 w-full py-3 font-bold text-white rounded-sm bg-orange-600 hover:bg-orange-700 disabled:opacity-50"
      >
        {busy ? 'Placing...' : userBet ? 'Add to bet' : 'Place bet'}
      </button>
      <p className={`text-xs mt-2 ${mutedClass}`}>
        Pool betting: the odds shift as others bet until betting closes.{' '}
        <span className={textClass}>Bets are final.</span>
      </p>
    </>
  );
};

export default WeeklySlip;
