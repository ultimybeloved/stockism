import { useMemo, useState } from 'react';
import { CHARACTERS } from '../../../characters';
import { WEEKLY_CALL } from '../../../crews';
import { formatCurrency } from '../../../utils/formatters';
import { formatDateTime } from '../../../utils/localTime';
import { themeClasses } from '../../../utils/theme';
import { callPicksOpen, callPicksCloseMs, missionWeekEndMs, type WeeklyCall } from '../../../utils/missionProgress';
import { useMarket, useSession } from '../../../context/AppContext';
import { callAccuracy } from '../../../rules/callRecord';
import type { CallDirection } from '../../../rules/missions';

const RESULT_TEXT = {
  big: 'Big call! Paid',
  win: 'You called it. Paid',
  push: 'It barely moved, so this one is a push.',
  break: 'Nothing moved this chapter, so every Call got a consolation.',
  loss: 'It went the other way.',
} as const;

export default function WeeklyCallCard({
  call,
  multiplier,
  onMakeCall,
  busy,
}: {
  call: WeeklyCall | undefined;
  multiplier: number;
  onMakeCall: (ticker: string, direction: CallDirection) => Promise<boolean> | unknown;
  busy?: boolean;
}) {
  const { textClass, mutedClass, borderClass, inputClass } = themeClasses;
  const { prices } = useMarket();
  const record = useSession().userData?.callRecord;
  const [editing, setEditing] = useState(false);
  const [query, setQuery] = useState('');
  const [ticker, setTicker] = useState<string | null>(null);

  const open = callPicksOpen();
  const reward = Math.round(WEEKLY_CALL.reward * multiplier);
  const bigReward = Math.round(WEEKLY_CALL.bigReward * multiplier);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return CHARACTERS.filter(
      (c) => prices[c.ticker] && (c.ticker.toLowerCase().startsWith(q) || c.name.toLowerCase().includes(q)),
    ).slice(0, 6);
  }, [query, prices]);

  const submit = async (direction: CallDirection) => {
    if (!ticker) return;
    const ok = await onMakeCall(ticker, direction);
    if (ok !== false) {
      setEditing(false);
      setQuery('');
      setTicker(null);
    }
  };

  const picking = open && (!call || editing);
  const name = (t: string) => CHARACTERS.find((c) => c.ticker === t)?.name || t;

  return (
    <div className={`p-3 rounded-sm border ${call?.paid ? 'border-purple-500 bg-purple-500/10' : borderClass}`}>
      <div className="flex justify-between items-start mb-1 gap-2">
        <div>
          <h3 className={`font-semibold ${textClass}`}>Your Call</h3>
          <p className={`text-xs ${mutedClass}`}>
            Pick a stock and say up or down. It's scored on the next chapter: from the halt to the reopen, before the
            opening auction.
          </p>
          {!!record?.calls && (
            <p className={`text-xs ${mutedClass} mt-0.5`}>
              Your record: {record.wins} right, {record.losses} wrong
              {callAccuracy(record) !== null ? ` (${callAccuracy(record)}%)` : ''}
              {record.streak > 1 ? `, ${record.streak} in a row` : ''}.
            </p>
          )}
        </div>
        <span className={`text-sm font-bold shrink-0 text-right ${call?.paid ? 'text-purple-500' : mutedClass}`}>
          +{formatCurrency(reward)}
          <span className="block text-[10px] font-normal">{formatCurrency(bigReward)} on a 10%+ move</span>
        </span>
      </div>

      {call && !picking && (
        <div className="mt-2 flex items-center justify-between gap-2">
          <p className={`text-sm ${textClass}`}>
            <span className="font-semibold">{call.ticker}</span>{' '}
            <span className={call.direction === 'up' ? 'text-green-500' : 'text-red-500'}>
              {call.direction === 'up' ? '▲ up' : '▼ down'}
            </span>{' '}
            <span className={`text-xs ${mutedClass}`}>{name(call.ticker)}</span>
          </p>
          {open && (
            <button onClick={() => setEditing(true)} className="text-xs font-semibold text-purple-500 hover:underline">
              Change
            </button>
          )}
        </div>
      )}
      {call?.result ? (
        <p className={`text-xs mt-1 ${call.paid ? 'text-purple-500 font-semibold' : mutedClass}`}>
          {RESULT_TEXT[call.result]}
          {call.paid ? ` ${formatCurrency(call.paid)}.` : ''}
        </p>
      ) : call ? (
        <p className={`text-xs mt-1 ${mutedClass}`}>
          {open
            ? `You can change it until ${formatDateTime(callPicksCloseMs())}.`
            : `Locked in. Scored ${formatDateTime(missionWeekEndMs() - 8 * 60 * 60 * 1000)} to ${formatDateTime(missionWeekEndMs() - 5 * 60 * 1000)}.`}
        </p>
      ) : (
        !open && (
          <p className={`text-xs mt-2 ${mutedClass}`}>
            Calls for this week closed. The next one opens {formatDateTime(missionWeekEndMs())}.
          </p>
        )
      )}

      {picking && (
        <div className="mt-2 space-y-2">
          <input
            value={ticker ? `${ticker} · ${name(ticker)}` : query}
            onChange={(e) => {
              setTicker(null);
              setQuery(e.target.value);
            }}
            placeholder="Search a stock"
            aria-label="Search a stock for your Call"
            className={`w-full px-2 py-1.5 text-sm rounded-sm border ${inputClass}`}
          />
          {!ticker && matches.length > 0 && (
            <div className={`rounded-sm border ${borderClass} divide-y divide-zinc-500/20`}>
              {matches.map((c) => (
                <button
                  key={c.ticker}
                  onClick={() => setTicker(c.ticker)}
                  className={`w-full text-left px-2 py-1 text-sm hover:bg-purple-500/10 ${textClass}`}
                >
                  <span className="font-semibold">{c.ticker}</span> <span className={mutedClass}>{c.name}</span>
                </button>
              ))}
            </div>
          )}
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => submit('up')}
              disabled={!ticker || busy}
              className="py-1.5 text-sm font-semibold rounded-sm text-white bg-green-600 hover:bg-green-700 disabled:opacity-40"
            >
              ▲ Up
            </button>
            <button
              onClick={() => submit('down')}
              disabled={!ticker || busy}
              className="py-1.5 text-sm font-semibold rounded-sm text-white bg-red-600 hover:bg-red-700 disabled:opacity-40"
            >
              ▼ Down
            </button>
          </div>
          <p className={`text-xs ${mutedClass}`}>
            Picks close {formatDateTime(callPicksCloseMs())}. A move under 1% either way is a push.
          </p>
        </div>
      )}
    </div>
  );
}
