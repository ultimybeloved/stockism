// The command panel's top bar: title, market state, UTC clock, a player
// search that works from any screen, the price tool and close.
import { useEffect, useMemo, useState } from 'react';
import { matchesSearch, netWorth } from '../../utils/playerRows';
import { compact } from '../../utils/termFormat';
import { useAdminNav } from '../../utils/adminNav';
import { Light } from './ui';
import { t } from './terminal';
import type { AdminUser } from '../../utils/adminShared';

const Clock = () => {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(id);
  }, []);
  return (
    <span className={`${t.num} text-xs ${t.muted}`}>
      {new Date(now).toISOString().slice(0, 16).replace('T', ' ')} UTC
    </span>
  );
};

const AdminTopBar = ({
  halted,
  allUsers,
  usersLoading,
  ensureUsers,
  onAdjustPrices,
  onClose,
}: {
  halted: boolean;
  allUsers: AdminUser[];
  usersLoading: boolean;
  ensureUsers: () => void;
  onAdjustPrices: () => void;
  onClose: () => void;
}) => {
  const nav = useAdminNav();
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const hits = useMemo(
    () => (q.trim().length < 2 ? [] : allUsers.filter((u) => matchesSearch(u, q)).slice(0, 12)),
    [allUsers, q],
  );

  const pick = (uid: string) => {
    nav.openPlayer(uid);
    setQ('');
    setOpen(false);
  };

  return (
    <header className="h-12 shrink-0 flex items-center gap-4 px-4 border-b border-[var(--t-line)] bg-[var(--t-panel)]">
      <div className="flex items-center gap-2">
        <span className="t-mono text-sm font-bold tracking-[0.2em] text-[var(--t-green)]">STOCKISM</span>
        <span className="t-mono text-[10px] tracking-[0.2em] text-[var(--t-muted)]">COMMAND</span>
      </div>
      <div className="flex items-center gap-1.5 text-xs">
        <Light tone={halted ? 'red' : 'green'} live />
        <span className={`t-mono uppercase tracking-wider ${halted ? t.red : t.green}`}>
          {halted ? 'Market halted' : 'Market open'}
        </span>
      </div>
      <Clock />

      <div className="relative ml-auto w-96">
        <input
          aria-label="Find a player"
          className={`${t.input} w-full`}
          placeholder={usersLoading ? 'Loading players...' : 'Find a player (name, ID, Discord)'}
          value={q}
          onFocus={() => {
            ensureUsers();
            setOpen(true);
          }}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && hits[0]) pick(hits[0].id);
            if (e.key === 'Escape') setOpen(false);
          }}
        />
        {open && hits.length > 0 && (
          <ul className="absolute z-30 top-full mt-1 w-full bg-[var(--t-raise)] border border-[var(--t-line2)] max-h-96 overflow-y-auto">
            {hits.map((u) => (
              <li key={u.id}>
                <button
                  type="button"
                  className="w-full flex items-center justify-between px-3 py-1.5 text-sm hover:bg-[var(--t-panel2)] text-left"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => pick(u.id)}
                >
                  <span className="truncate">
                    {u.displayName}
                    {u.discordUsername && <span className={`ml-2 ${t.dim}`}>@{u.discordUsername}</span>}
                  </span>
                  <span className={`${t.num} text-xs ${t.muted}`}>{compact(netWorth(u))}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <button className={t.btnGo} onClick={onAdjustPrices}>
        Adjust prices
      </button>
      <button aria-label="Close" className={`${t.btn} px-2`} onClick={onClose}>
        Close
      </button>
    </header>
  );
};

export default AdminTopBar;
