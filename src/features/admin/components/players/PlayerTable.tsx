// Every player in one dense table: search, filter chips, a crew filter,
// sortable columns, tick boxes for bulk actions. Clicking a row opens the
// player's file.
import { useEffect, useMemo, useState } from 'react';
import { CREW_MAP } from '../../../../crews';
import { ADMIN_UIDS } from '../../../../constants';
import { useAdminNav } from '../../utils/adminNav';
import {
  PLAYER_FILTERS,
  activeMs,
  joinedMs,
  matchesFilter,
  matchesSearch,
  netWorth,
  sortPlayers,
} from '../../utils/playerRows';
import type { PlayerFilter, PlayerSort } from '../../utils/playerRows';
import { ago, compact, int, money, utc } from '../../utils/termFormat';
import { Empty, Tag } from '../shell/ui';
import { t } from '../shell/terminal';
import BulkBar from './BulkBar';
import type { AdminUser } from '../../utils/adminShared';

const PAGE = 100;

const COLUMNS: { id: PlayerSort; label: string; right?: boolean }[] = [
  { id: 'name', label: 'Player' },
  { id: 'netWorth', label: 'Net worth', right: true },
  { id: 'cash', label: 'Cash', right: true },
  { id: 'margin', label: 'Margin debt', right: true },
  { id: 'granted', label: 'Free money', right: true },
  { id: 'trades', label: 'Trades', right: true },
  { id: 'streak', label: 'Streak', right: true },
  { id: 'welcome', label: 'Welcome', right: true },
  { id: 'crew', label: 'Crew' },
  { id: 'joined', label: 'Joined' },
  { id: 'active', label: 'Last seen' },
];

interface Props {
  allUsers: AdminUser[];
  loadedAt: number | null;
  loading: boolean;
  handleLoadAllUsers: () => void;
  showMessage: (type: string, text: string) => void;
  onPaid: (uids: string[], amount: number) => void;
}

const PlayerTable = ({ allUsers, loadedAt, loading, handleLoadAllUsers, showMessage, onPaid }: Props) => {
  const nav = useAdminNav();
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<PlayerFilter>('all');
  const [crew, setCrew] = useState('');
  const [sort, setSort] = useState<PlayerSort>('netWorth');
  const [desc, setDesc] = useState(true);
  const [page, setPage] = useState(0);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const now = Date.now();

  useEffect(() => {
    if (!loadedAt && !loading) handleLoadAllUsers();
    // Load once when the table first opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const rows = useMemo(() => {
    const list = allUsers.filter(
      (u) => matchesFilter(u, filter, now) && matchesSearch(u, query) && (!crew || u.crew === crew),
    );
    return sortPlayers(list, sort, desc);
    // now changes every render; the filter only needs minute precision.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allUsers, filter, query, crew, sort, desc]);

  useEffect(() => setPage(0), [filter, query, crew, sort, desc]);

  const pageRows = rows.slice(page * PAGE, (page + 1) * PAGE);
  const pages = Math.max(1, Math.ceil(rows.length / PAGE));
  const allPicked = rows.length > 0 && rows.every((u) => picked.has(u.id));
  const totalWorth = rows.reduce((s, u) => s + netWorth(u), 0);

  const toggle = (id: string) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const sortBy = (id: PlayerSort) => {
    if (sort === id) setDesc(!desc);
    else {
      setSort(id);
      setDesc(id !== 'name' && id !== 'crew');
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <input
          aria-label="Search players"
          className={`${t.input} w-80`}
          placeholder="Search name, ID, or Discord"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <select aria-label="Crew" className={t.input} value={crew} onChange={(e) => setCrew(e.target.value)}>
          <option value="">Any crew</option>
          {Object.values(CREW_MAP).map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <span className={`${t.num} text-xs ${t.muted}`}>
          {int(rows.length)} players · {compact(totalWorth)} net worth
        </span>
        <span className={`ml-auto ${t.label}`}>{loadedAt ? `Loaded ${utc(loadedAt)} UTC` : ''}</span>
        <button className={t.btn} onClick={handleLoadAllUsers} disabled={loading}>
          {loading ? 'Loading' : 'Reload'}
        </button>
      </div>

      <div className="flex flex-wrap gap-1">
        {PLAYER_FILTERS.map((f) => (
          <button key={f.id} className={filter === f.id ? t.btnGo : t.btn} onClick={() => setFilter(f.id)}>
            {f.label}
          </button>
        ))}
      </div>

      {picked.size > 0 && (
        <BulkBar uids={[...picked]} onClear={() => setPicked(new Set())} showMessage={showMessage} onPaid={onPaid} />
      )}

      {allUsers.length === 0 ? (
        <Empty>{loading ? 'Loading every player...' : 'No players loaded'}</Empty>
      ) : (
        <div className={`${t.panel} overflow-x-auto`}>
          <table className="w-full text-sm">
            <thead>
              <tr>
                <th className={`${t.th} w-8`}>
                  <input
                    type="checkbox"
                    aria-label="Select all shown"
                    checked={allPicked}
                    onChange={() =>
                      setPicked(allPicked ? new Set() : new Set(rows.filter((u) => !u.isBot).map((u) => u.id)))
                    }
                  />
                </th>
                {COLUMNS.map((c) => (
                  <th key={c.id} className={`${t.th} ${c.right ? 'text-right' : ''}`}>
                    <button className="hover:text-[var(--t-text)] uppercase" onClick={() => sortBy(c.id)}>
                      {c.label}
                      {sort === c.id ? (desc ? ' ▼' : ' ▲') : ''}
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {pageRows.map((u) => {
                const crewInfo = u.crew ? CREW_MAP[u.crew] : null;
                const day = u.welcomeStreak?.day || 0;
                return (
                  <tr key={u.id} className={`${t.row} cursor-pointer`} onClick={() => nav.openPlayer(u.id)}>
                    <td className={t.td} onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        aria-label={`Select ${u.displayName}`}
                        checked={picked.has(u.id)}
                        onChange={() => toggle(u.id)}
                      />
                    </td>
                    <td className={t.td}>
                      <span className="font-semibold">{u.displayName}</span>
                      <span className="ml-2 inline-flex gap-1 align-middle">
                        {ADMIN_UIDS.includes(u.id) && <Tag tone="amber">admin</Tag>}
                        {!!u.isBanned && <Tag tone="red">banned</Tag>}
                        {u.isBot && <Tag>bot</Tag>}
                        {u.isBankrupt && <Tag tone="red">bankrupt</Tag>}
                        {u.isCrewHead && <Tag tone="amber">crew head</Tag>}
                        {u.discordId && <Tag tone="violet">discord</Tag>}
                      </span>
                    </td>
                    <td className={`${t.td} ${t.num} text-right`}>{money(netWorth(u))}</td>
                    <td className={`${t.td} ${t.num} text-right ${t.muted}`}>{money(u.cash)}</td>
                    <td className={`${t.td} ${t.num} text-right ${u.marginUsed ? t.amber : t.dim}`}>
                      {u.marginUsed ? money(u.marginUsed) : '-'}
                    </td>
                    <td className={`${t.td} ${t.num} text-right ${t.muted}`}>
                      {u.grantedValue ? compact(u.grantedValue) : '-'}
                    </td>
                    <td className={`${t.td} ${t.num} text-right`}>{int(u.totalTrades)}</td>
                    <td className={`${t.td} ${t.num} text-right`}>{u.checkinStreak || '-'}</td>
                    <td className={`${t.td} ${t.num} text-right ${day >= 7 ? t.green : day ? t.amber : t.dim}`}>
                      {day ? `${day}/7` : '-'}
                    </td>
                    <td className={t.td}>
                      {crewInfo ? (
                        <span className="inline-flex items-center gap-1.5">
                          <span className="w-2 h-2" style={{ background: crewInfo.color }} />
                          {crewInfo.name}
                        </span>
                      ) : (
                        <span className={t.dim}>-</span>
                      )}
                    </td>
                    <td className={`${t.td} ${t.num} ${t.muted}`} title={utc(joinedMs(u))}>
                      {ago(joinedMs(u), now)}
                    </td>
                    <td className={`${t.td} ${t.num} ${t.muted}`} title={utc(activeMs(u))}>
                      {ago(activeMs(u), now)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {pages > 1 && (
        <div className="flex items-center justify-center gap-2">
          <button className={t.btn} disabled={page === 0} onClick={() => setPage(page - 1)}>
            Prev
          </button>
          <span className={`${t.num} text-xs ${t.muted}`}>
            Page {page + 1} of {pages}
          </span>
          <button className={t.btn} disabled={page >= pages - 1} onClick={() => setPage(page + 1)}>
            Next
          </button>
        </div>
      )}
    </div>
  );
};

export default PlayerTable;
