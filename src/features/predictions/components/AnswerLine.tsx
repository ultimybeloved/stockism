// One answer on a question card: name, a thin bar for the crowd's share, the
// share as a percent and what it pays. Tapping it opens the bet slip.
// Weekly questions are orange and futures indigo, so the two never blur.
export type Tone = 'weekly' | 'futures';

const TONES = {
  weekly: {
    hover: 'light:hover:bg-orange-50 dark:hover:bg-orange-950/30',
    picked: 'outline-orange-500 light:bg-orange-50 dark:bg-orange-950/40',
    mine: 'shadow-[inset_3px_0_0_#ea580c]',
    name: 'text-orange-600 dark:text-orange-400',
    odds: 'text-orange-600 dark:text-orange-400',
    fill: 'light:bg-slate-400 dark:bg-zinc-500',
  },
  futures: {
    hover: 'light:hover:bg-indigo-50 dark:hover:bg-indigo-950/40',
    picked: 'outline-indigo-500 light:bg-indigo-50 dark:bg-indigo-950/50',
    mine: 'shadow-[inset_3px_0_0_#6366f1]',
    name: 'text-indigo-600 dark:text-indigo-300',
    odds: 'text-indigo-600 dark:text-indigo-400',
    fill: 'bg-indigo-500',
  },
};

interface AnswerLineProps {
  name: string;
  /** The crowd's share, 0 to 100. */
  share: number;
  /** "1.85x", or null when there is nothing to quote. */
  odds: string | null;
  tone: Tone;
  /** The player already has money on this answer. */
  mine?: boolean;
  /** Open in the bet slip right now. */
  picked?: boolean;
  disabled?: boolean;
  onPick: () => void;
}

const AnswerLine = ({ name, share, odds, tone, mine, picked, disabled, onPick }: AnswerLineProps) => {
  const t = TONES[tone];
  return (
    <button
      type="button"
      onClick={onPick}
      disabled={disabled}
      aria-pressed={picked}
      className={`w-full flex items-center gap-3 px-3.5 py-3 text-left border-t light:border-amber-100 dark:border-zinc-800 transition-colors disabled:cursor-default ${
        disabled ? '' : t.hover
      } ${picked ? `outline outline-2 -outline-offset-2 ${t.picked}` : ''} ${mine ? t.mine : ''}`}
    >
      <span
        className={`flex-1 min-w-0 leading-tight ${mine ? `font-bold ${t.name}` : 'font-medium light:text-slate-900 dark:text-zinc-100'}`}
      >
        {name}
      </span>
      <span className="w-12 sm:w-14 h-[3px] shrink-0 rounded-full overflow-hidden light:bg-amber-100 dark:bg-zinc-800">
        <span className={`block h-full ${t.fill}`} style={{ width: `${Math.min(100, share)}%` }} />
      </span>
      <span className="w-9 shrink-0 text-right text-xs tabular-nums light:text-zinc-500 dark:text-zinc-400">
        {share}%
      </span>
      {odds && <span className={`w-14 shrink-0 text-right font-extrabold tabular-nums ${t.odds}`}>{odds}</span>}
    </button>
  );
};

export default AnswerLine;
