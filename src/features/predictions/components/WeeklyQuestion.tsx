// A weekly question: its answers with pool odds, any notes about timing, and
// the player's own bet along the bottom.
import { themeClasses } from '../../../utils/theme';
import { formatCompactCurrency, formatCurrency, formatMultiplier } from '../../../utils/formatters';
import { formatDateTime } from '../../../utils/localTime';
import type { PredictionDoc, UserBet } from '../../../types';
import { PREVIEW_BET, betPayout, optionsOf, poolPayout, poolShare, poolTotal } from '../utils/odds';
import { samePick, type SlipPick } from '../types';
import AnswerLine from './AnswerLine';

interface WeeklyQuestionProps {
  prediction: PredictionDoc;
  userBet?: UserBet;
  pick: SlipPick | null;
  onPick: (pick: SlipPick) => void;
}

const WeeklyQuestion = ({ prediction: p, userBet, pick, onPick }: WeeklyQuestionProps) => {
  const { cardClass, textClass, mutedClass } = themeClasses;
  const open = (p.endsAt ?? 0) > Date.now();
  const total = poolTotal(p);
  // Odds only mean something once there's money in and betting is open.
  const quote = open && total > 0;

  const notes: string[] = [];
  if (!open) notes.push('Betting closed. Waiting on the result.');
  else if (p.reopened) notes.push(`Extended. Betting now closes ${formatDateTime(p.endsAt ?? 0)}.`);
  if (p.mayExtend) notes.push('The result may take an extra week to confirm.');

  return (
    <article className={`${cardClass} border rounded-sm overflow-hidden`}>
      <header className="px-3.5 pt-3 pb-2.5">
        <h3 className={`font-semibold leading-snug ${textClass}`}>{p.question}</h3>
        <p className={`text-xs mt-0.5 tabular-nums ${mutedClass}`}>
          {total > 0 ? `${formatCompactCurrency(total)} pool` : 'No bets yet'}
        </p>
        {notes.map((n) => (
          <p key={n} className="text-xs mt-0.5 text-amber-600 dark:text-amber-400">
            {n}
          </p>
        ))}
      </header>
      {optionsOf(p).map((o) => (
        <AnswerLine
          key={o}
          tone="weekly"
          name={o}
          share={poolShare(p, o)}
          odds={quote ? formatMultiplier(poolPayout(p, o, PREVIEW_BET) / PREVIEW_BET) : null}
          mine={userBet?.option === o}
          picked={samePick(pick, 'weekly', p.id, o)}
          disabled={!open}
          onPick={() => onPick({ kind: 'weekly', id: p.id, option: o })}
        />
      ))}
      {userBet && (
        <p className="px-3.5 py-2.5 text-xs tabular-nums border-t light:border-amber-100 light:bg-orange-50 dark:border-zinc-800 dark:bg-orange-950/20">
          <span className={mutedClass}>Your bet: </span>
          <b className={textClass}>
            {formatCurrency(userBet.amount)} on {userBet.option}
          </b>
          <span className={mutedClass}>. Potential payout {formatCurrency(betPayout(p, userBet))}.</span>
        </p>
      )}
    </article>
  );
};

export default WeeklyQuestion;
