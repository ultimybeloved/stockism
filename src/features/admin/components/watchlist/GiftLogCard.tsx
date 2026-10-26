// Every gift sent between players, newest first, with a flag on any pair that
// looks like one person on two accounts (see functions/src/admin/adminGiftLog.ts).
// The worry is an alt spending its cash on its main.
import { useMemo, useState } from 'react';
import { adminListGiftsFunction } from '../../../../api/callables';
import { errorMessage } from '../../../../utils/errors';
import { formatDateTime } from '../../../../utils/localTime';
import { formatCurrency } from '../../../../utils/formatters';
import type { AdminCommonProps } from '../types';
import type { GiftLogEntry } from '../../../../api/types';
import AdminIcon from '../AdminIcon';

type GiftLogCardProps = Pick<AdminCommonProps, 'textClass' | 'mutedClass' | 'inputClass'>;

const GiftLogCard = ({ textClass, mutedClass, inputClass }: GiftLogCardProps) => {
  const [entries, setEntries] = useState<GiftLogEntry[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [onlyFlagged, setOnlyFlagged] = useState(false);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await adminListGiftsFunction({});
      setEntries(res.data.entries || []);
    } catch (e) {
      setError(errorMessage(e) || 'Could not load the gift log.');
    } finally {
      setLoading(false);
    }
  };

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (entries || []).filter(
      (e) =>
        (!onlyFlagged || e.flags.length > 0) &&
        (!q || [e.fromName, e.toName, e.fromUid, e.toUid].some((s) => (s || '').toLowerCase().includes(q))),
    );
  }, [entries, search, onlyFlagged]);

  const rowBorder = 'light:border-slate-200 dark:border-slate-700';
  const name = (n: string | null, uid: string) => n || <span className={mutedClass}>{uid}</span>;

  return (
    <div className="p-3 rounded-sm light:bg-indigo-50 dark:bg-slate-700/50">
      <div className="flex items-start justify-between gap-3 mb-2">
        <div>
          <h3 className={`text-sm font-bold mb-1 ${textClass}`}>
            <AdminIcon name="gift" />
            Gift Log
          </h3>
          <p className={`text-xs ${mutedClass}`}>
            Who gifted what to whom. A flag means the two accounts share a connection (signup, trades, or gifts), were
            paired by the alt scan, are linked on the watchlist, or the receiver is under a week old.
          </p>
        </div>
        <button
          onClick={load}
          disabled={loading}
          className="shrink-0 px-3 py-1.5 text-xs font-semibold rounded-sm disabled:opacity-50 light:bg-indigo-500 light:hover:bg-indigo-600 light:text-white dark:bg-indigo-600 dark:hover:bg-indigo-500 dark:text-white"
        >
          {loading ? 'Loading...' : entries ? 'Refresh' : 'Load gifts'}
        </button>
      </div>
      {error && (
        <p role="alert" className="text-xs text-red-500">
          {error}
        </p>
      )}

      {entries && (
        <>
          <div className="flex flex-wrap items-center gap-3 mb-2">
            <input
              aria-label="Search gifts"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search player"
              className={`flex-1 min-w-[10rem] px-2 py-1.5 text-sm rounded-sm border ${inputClass}`}
            />
            <label className={`flex items-center gap-2 text-xs ${textClass}`}>
              <input type="checkbox" checked={onlyFlagged} onChange={(e) => setOnlyFlagged(e.target.checked)} />
              Only flagged
            </label>
            <span className={`text-xs ${mutedClass}`}>
              {visible.length} gift{visible.length === 1 ? '' : 's'},{' '}
              {formatCurrency(visible.reduce((s, e) => s + e.price, 0))} paid
            </span>
          </div>
          {visible.length === 0 ? (
            <p className={`text-xs ${mutedClass}`}>Nothing matches.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className={`text-left ${mutedClass} border-b ${rowBorder}`}>
                    <th className="py-1.5 pr-3 font-semibold">When</th>
                    <th className="py-1.5 pr-3 font-semibold">From</th>
                    <th className="py-1.5 pr-3 font-semibold">To</th>
                    <th className="py-1.5 pr-3 font-semibold">Item</th>
                    <th className="py-1.5 pr-3 font-semibold text-right">Paid</th>
                    <th className="py-1.5 font-semibold">Flags</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((e) => (
                    <tr key={e.id} className={`border-b ${rowBorder} ${e.flags.length ? 'bg-red-500/10' : ''}`}>
                      <td className={`py-1.5 pr-3 whitespace-nowrap ${mutedClass}`}>
                        {e.at ? formatDateTime(e.at) : 'unknown'}
                      </td>
                      <td className={`py-1.5 pr-3 ${textClass}`}>{name(e.fromName, e.fromUid)}</td>
                      <td className={`py-1.5 pr-3 ${textClass}`}>{name(e.toName, e.toUid)}</td>
                      <td className={`py-1.5 pr-3 ${textClass}`}>{e.itemName}</td>
                      <td className={`py-1.5 pr-3 text-right whitespace-nowrap ${textClass}`}>
                        {formatCurrency(e.price)}
                      </td>
                      <td className="py-1.5 text-red-500 font-semibold">{e.flags.join(', ')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default GiftLogCard;
