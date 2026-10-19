// The amount box on the bet slip: typed, or built up with the step buttons.
// Steps scale with the ceiling so they stay useful at any limit.
import { niceStep } from '../../../utils/calculations';
import type { Tone } from './AnswerLine';

const EDGE = {
  weekly: 'light:border-orange-300 dark:border-orange-900',
  futures: 'light:border-indigo-300 dark:border-indigo-800',
};

interface SlipAmountProps {
  label: string;
  value: number;
  onChange: (value: number) => void;
  /** Most the box will take. */
  max: number;
  /** Dollars get a "$" in front; share counts don't. */
  dollars?: boolean;
  tone: Tone;
}

const SlipAmount = ({ label, value, onChange, max, dollars = false, tone }: SlipAmountProps) => {
  const step = niceStep(max, 1);
  const set = (n: number) => onChange(Math.max(0, Math.min(Math.floor(n), Math.floor(max))));
  const short = (n: number) => (n >= 1000 ? `${n / 1000}k` : String(n));
  return (
    <div className="mt-3">
      <label className="block text-xs mb-1 light:text-zinc-600 dark:text-zinc-400" htmlFor="slip-amount">
        {label}
      </label>
      <div className={`flex border rounded-sm overflow-hidden light:bg-white dark:bg-zinc-950 ${EDGE[tone]}`}>
        {dollars && <span className="pl-3 py-2 light:text-zinc-400 dark:text-zinc-500">$</span>}
        <input
          id="slip-amount"
          inputMode="numeric"
          autoComplete="off"
          value={value ? value.toLocaleString('en-US') : ''}
          placeholder="0"
          onChange={(e) => set(Number(e.target.value.replace(/[^0-9]/g, '')) || 0)}
          className={`flex-1 min-w-0 py-2 ${dollars ? 'px-1' : 'px-3'} bg-transparent outline-none text-lg font-semibold tabular-nums light:text-slate-900 dark:text-zinc-100`}
        />
      </div>
      <div
        className={`mt-2 grid grid-cols-4 border rounded-sm overflow-hidden text-xs font-semibold divide-x light:text-zinc-700 dark:text-zinc-300 ${EDGE[tone]} ${tone === 'weekly' ? 'light:divide-orange-300 dark:divide-orange-900' : 'light:divide-indigo-300 dark:divide-indigo-800'}`}
      >
        {[step, step * 5, step * 10].map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => set(value + s)}
            disabled={!(max > 0)}
            className="py-2 light:hover:bg-amber-50 dark:hover:bg-zinc-800 disabled:opacity-40"
          >
            +{dollars ? short(s) : s.toLocaleString('en-US')}
          </button>
        ))}
        <button
          type="button"
          onClick={() => set(max)}
          disabled={!(max > 0)}
          className="py-2 light:hover:bg-amber-50 dark:hover:bg-zinc-800 disabled:opacity-40"
        >
          Max
        </button>
      </div>
    </div>
  );
};

export default SlipAmount;
