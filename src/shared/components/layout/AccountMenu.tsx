// The account corner of the header: your name and total value. Clicking it
// opens a short menu (Portfolio, Profile and settings, Achievements, Sign out),
// the way most sites handle the account corner, so the portfolio is one click
// away on every page without another button in the header.
import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { signOut } from 'firebase/auth';
import { auth } from '../../../firebase';
import { useSession } from '../../../context/AppContext';
import { useEscapeKey } from '../../hooks/useEscapeKey';
import { formatCurrency } from '../../../utils/formatters';
import PixelIcon from '../PixelIcon';

const ITEMS = [
  { path: '/portfolio', label: 'Portfolio', icon: 'cash', hint: 'P' },
  { path: '/profile', label: 'Profile and settings', icon: 'profile' },
  { path: '/achievements', label: 'Achievements', icon: 'medal' },
] as const;

const AccountMenu = ({ value }: { value: number }) => {
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

  const name = userData?.displayName || user?.email?.split('@')[0] || 'Anonymous';
  const valueColor = userData?.colorBlindMode ? 'text-teal-600' : 'text-green-600';
  const item =
    'w-full flex items-center gap-3 px-3 py-2.5 text-sm text-left transition-colors light:text-zinc-700 light:hover:bg-amber-50 dark:text-zinc-200 dark:hover:bg-zinc-800';

  return (
    <div className="relative" ref={ref}>
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
          {ITEMS.map((it) => {
            const here = location.pathname === it.path;
            return (
              <button
                key={it.path}
                type="button"
                role="menuitem"
                onClick={() => navigate(it.path)}
                className={`${item} ${here ? 'font-semibold text-orange-500' : ''}`}
              >
                <PixelIcon name={it.icon} className="w-5 h-5 shrink-0" />
                <span className="flex-1">{it.label}</span>
                {it.path === '/portfolio' && (
                  <span className={`text-xs font-semibold ${valueColor}`}>{formatCurrency(value)}</span>
                )}
                {'hint' in it && (
                  <kbd className="hidden lg:inline text-[10px] font-mono opacity-60 border rounded px-1 light:border-zinc-300 dark:border-zinc-600">
                    {it.hint}
                  </kbd>
                )}
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
