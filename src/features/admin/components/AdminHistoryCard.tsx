// Every admin action, newest first, with what it was before and what it became
// (see functions/src/shared/adminLog.ts). For spotting a mistyped edit and
// putting the old value back by hand.
import { useMemo, useState } from 'react';
import { adminListLogFunction } from '../../../api/callables';
import { errorMessage } from '../../../utils/errors';
import { formatDateTime } from '../../../utils/localTime';
import type { AdminCommonProps } from './types';
import type { AdminLogEntry } from '../../../api/types';

type AdminHistoryCardProps = Pick<AdminCommonProps, 'textClass' | 'mutedClass' | 'inputClass'>;

const ACTION_LABELS: Record<string, string> = {
  set_cash: 'Set cash',
  reinstate: 'Reinstate',
  ban: 'Ban',
  set_holding: 'Set holding',
  set_margin: 'Set margin',
  set_crew: 'Set crew',
  rename: 'Rename',
  grant_achievement: 'Grant achievement',
  remove_achievement: 'Remove achievement',
  grant_cosmetic: 'Grant cosmetic',
  revoke_cosmetic: 'Revoke cosmetic',
  grant_pin: 'Grant pin',
  revoke_pin: 'Revoke pin',
  transfer_to_ladder: 'Ladder transfer',
  remove_coord_profit: 'Remove coordination profit',
  season_exclude: 'Exclude from Plat/Diamond',
  season_restore: 'Restore to Plat/Diamond',
  set_discord_wall: 'Discord wall',
  unlink_discord: 'Unlink Discord',
  free_discord: 'Free Discord ID',
  move_discord_link: 'Move Discord link',
  broadcast: 'Broadcast',
  cancel_prediction: 'Cancel prediction',
  cancel_event_market: 'Cancel event market',
  halt_market: 'Halt market',
  resume_market: 'Resume market',
  start_season: 'Start season',
  end_season: 'End season',
  rename_ticker: 'Rename ticker',
  split_stock: 'Split stock',
  init_prices: 'Initialise prices',
  restore_backup: 'Restore backup',
  recover_ticker: 'Recover ticker',
  repair_spike_victim: 'Repair account',
  repair_spike_victims_all: 'Repair all accounts',
  reconstruct_history: 'Rebuild chart history',
  fix_price_cliffs: 'Fix price cliffs',
  create_bots: 'Create bots',
  // Browser-side panel tools (utils/panelLog.ts)
  repair_corrupted_account: 'Repair corrupted account',
  sync_portfolio: 'Sync portfolio',
  sync_all_portfolios: 'Sync all portfolios',
  set_dividend_tier: 'Dividend tier',
  create_ipo: 'Create IPO',
  cancel_ipo: 'Cancel IPO',
  adjust_price: 'Adjust price',
  cleanup_base_prices: 'Clean base prices',
  sync_prices_to_history: 'Sync prices to chart',
  reset_all_prices: 'Reset all prices',
  create_prediction: 'Create prediction',
  create_event_market: 'Create event market',
  resolve_prediction: 'Resolve prediction',
  delete_prediction: 'Delete prediction',
  extend_prediction: 'Extend prediction',
  set_site_messages: 'Site messages',
  delete_bot: 'Delete bot',
  delete_orphan: 'Delete orphan account',
  delete_user: 'Delete account',
  transfer_account: 'Transfer account',
};

// Short, readable form of a stored value: numbers as numbers, objects as key: value.
const show = (v: unknown): string => {
  if (v === null || v === undefined) return '-';
  if (typeof v === 'number')
    return Number.isInteger(v) ? v.toLocaleString() : v.toLocaleString(undefined, { maximumFractionDigits: 4 });
  if (typeof v !== 'object') return String(v);
  return Object.entries(v as Record<string, unknown>)
    .map(([k, x]) => `${k}: ${typeof x === 'object' && x !== null ? JSON.stringify(x) : show(x)}`)
    .join(', ');
};

const AdminHistoryCard = ({ textClass, mutedClass, inputClass }: AdminHistoryCardProps) => {
  const [entries, setEntries] = useState<AdminLogEntry[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await adminListLogFunction({});
      setEntries(res.data.entries || []);
    } catch (e) {
      setError(errorMessage(e) || 'Could not load the admin history.');
    } finally {
      setLoading(false);
    }
  };

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return entries || [];
    return (entries || []).filter((e) =>
      [e.name, e.uid, e.action, ACTION_LABELS[e.action], show(e.detail)].some((s) =>
        (s || '').toLowerCase().includes(q),
      ),
    );
  }, [entries, search]);

  const rowBorder = 'light:border-slate-200 dark:border-slate-700';

  return (
    <div className="p-3 rounded-sm light:bg-slate-50 dark:bg-slate-700/50">
      <div className="flex items-start justify-between gap-3 mb-2">
        <div>
          <h3 className={`text-sm font-bold mb-1 ${textClass}`}>📜 Admin History</h3>
          <p className={`text-xs ${mutedClass}`}>
            Every admin change to a player or the market since 2026-10-11, with what it was before. To undo a mistake,
            set the "Before" value back with the same tool.
          </p>
        </div>
        <button
          onClick={load}
          disabled={loading}
          className="shrink-0 px-3 py-1.5 text-xs font-semibold rounded-sm disabled:opacity-50 bg-teal-600 hover:bg-teal-700 text-white"
        >
          {loading ? 'Loading...' : entries ? 'Refresh' : 'Load history'}
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
              aria-label="Search history"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search player, action or ticker"
              className={`flex-1 min-w-[10rem] px-2 py-1.5 text-sm rounded-sm border ${inputClass}`}
            />
            <span className={`text-xs ${mutedClass}`}>
              {visible.length} action{visible.length === 1 ? '' : 's'}
            </span>
          </div>
          {visible.length === 0 ? (
            <p className={`text-xs ${mutedClass}`}>Nothing recorded yet.</p>
          ) : (
            <div className="overflow-x-auto max-h-[28rem] overflow-y-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className={`text-left ${mutedClass}`}>
                    <th className="py-1 pr-3 font-semibold">When</th>
                    <th className="py-1 pr-3 font-semibold">Action</th>
                    <th className="py-1 pr-3 font-semibold">Player</th>
                    <th className="py-1 pr-3 font-semibold">Before</th>
                    <th className="py-1 pr-3 font-semibold">After</th>
                    <th className="py-1 font-semibold">Details</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((e) => (
                    <tr key={e.id} className={`border-t align-top ${rowBorder} ${textClass}`}>
                      <td className="py-1.5 pr-3 whitespace-nowrap">{e.at ? formatDateTime(e.at) : '-'}</td>
                      <td className="py-1.5 pr-3 whitespace-nowrap font-semibold">
                        {ACTION_LABELS[e.action] || e.action}
                      </td>
                      <td className="py-1.5 pr-3">
                        {e.name || (e.uid ? <span className={mutedClass}>{e.uid}</span> : '-')}
                      </td>
                      <td className="py-1.5 pr-3">{show(e.before)}</td>
                      <td className="py-1.5 pr-3">{show(e.after)}</td>
                      <td className={`py-1.5 ${mutedClass}`}>{show(e.detail)}</td>
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

export default AdminHistoryCard;
