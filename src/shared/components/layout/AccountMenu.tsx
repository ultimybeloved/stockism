// The account corner of the header: your name and total value. Clicking it
// opens a short menu: your public profile, Stats and settings, Achievements,
// your crew (or the crew picker), Sign out. Portfolio is in the top nav.
import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { signOut } from 'firebase/auth';
import { auth } from '../../../firebase';
import { useSession } from '../../../context/AppContext';
import { useEscapeKey } from '../../hooks/useEscapeKey';
import { formatCurrency } from '../../../utils/formatters';
import PixelIcon from '../PixelIcon';
import { startTour } from '../../../features/tour/hooks/useTour';

import { CREW_MAP } from '../../../crews';

const AccountMenu = ({ value, onShowCrews }: { value: number; onShowCrews: () => void }) => {
  const { user, userData } = useSession();
  const navigate = useNavigate();
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  useEscapeKey(() => setOpen(false), open);

  // Close on any navigation and on a click anywhere else.
  useEffect(() => setOpen(false), [location.pathname]);
  useEffect(() => {
    if (!open) return undefined;
    const away = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', away);
    return () => document.removeEventListener('mousedown', away);
  }, [open]);

  const handleSignOut = async () => {
    setOpen(false);
    try {
      await signOut(auth);
    } catch (error) {
      console.error('Error signing out:', error);
    }
  };

  const crew = userData?.crew && CREW_MAP[userData.crew] ? userData.crew : null;
  // phoneOnly: shown only below the md breakpoint, where the bottom bar has no room for it.
  const items: ({ label: string; icon: string; set?: 'admin'; phoneOnly?: boolean } & (
    { path: string } | { run: () => void }
  ))[] = [
    ...(userData?.displayName
      ? [{ path: `/u/${userData.displayName.toLowerCase()}`, label: 'My profile', icon: 'profile' }]
      : []),
    { path: '/profile', label: 'Stats and settings', icon: 'gear', set: 'admin' },
    { path: '/achievements', label: 'Achievements', icon: 'medal' },
    { path: '/ladder', label: 'Ladder', icon: 'ladder', phoneOnly: true },
    crew
      ? { path: `/crew/${crew}`, label: 'My Crew', icon: 'crews' }
      : { run: onShowCrews, label: 'Join a crew', icon: 'crews' },
    { run: startTour, label: 'Replay the tour', icon: 'book' },
  ];

  const name = userData?.displayName || user?.email?.split('@')[0] || 'Anonymous';
  const valueColor = userData?.colorBlindMode ? 'text-teal-600' : 'text-green-600';
  const item =
    'w-full flex items-center gap-3 px-3 py-2.5 text-sm text-left transition-colors light:text-zinc-700 light:hover:bg-amber-50 dark:text-zinc-200 dark:hover:bg-zinc-800';

  return (
    <div className="relative" ref={ref} data-tour="account">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        className={`flex items-center space-x-2 px-2 py-1 sm:px-3 sm:py-2 rounded-md text-sm font-medium transition-colors ${
          open ? 'light:bg-amber-50 dark:bg-zinc-800' : 'light:hover:bg-amber-50 dark:hover:bg-zinc-800'
        } light:text-zinc-600 dark:text-zinc-300`}
      >
        <PixelIcon name="profile" className="w-5 h-5 sm:w-6 sm:h-6" />
        <div className="text-right">
          <div className="text-[10px] sm:text-xs light:text-zinc-600 dark:text-zinc-400">{name}</div>
          <div className={`text-xs sm:text-sm font-semibold ${valueColor}`}>{formatCurrency(value)}</div>
        </div>
        <span aria-hidden="true" className={`text-[10px] transition-transform ${open ? 'rotate-180' : ''}`}>
          ▼
        </span>
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full mt-2 w-60 rounded-sm border shadow-lg z-50 overflow-hidden light:bg-white light:border-amber-200 dark:bg-zinc-900 dark:border-zinc-700"
        >
          {items.map((it) => {
            const here = 'path' in it && location.pathname === it.path;
            return (
              <button
                key={it.label}
                type="button"
                role="menuitem"
                onClick={() => {
                  setOpen(false);
                  if ('path' in it) navigate(it.path);
                  else it.run();
                }}
                className={`${item} ${here ? 'font-semibold text-orange-500' : ''} ${it.phoneOnly ? 'md:hidden' : ''}`}
              >
                <PixelIcon name={it.icon} set={it.set} className="w-5 h-5 shrink-0" />
                <span className="flex-1">{it.label}</span>
              </button>
            );
          })}
          <div className="border-t light:border-amber-200 dark:border-zinc-700" />
          <button
            type="button"
            role="menuitem"
            onClick={() => void handleSignOut()}
            className={`${item} ${userData?.colorBlindMode ? '' : 'light:text-red-600 dark:text-red-400'}`}
          >
            <span className="w-5 shrink-0" />
            Sign out
          </button>
        </div>
      )}
    </div>
  );
};

export default AccountMenu;
