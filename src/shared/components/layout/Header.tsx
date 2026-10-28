import { useState, useEffect, useRef, useMemo } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { ADMIN_UIDS } from '../../../constants';
import { calculatePortfolioValue } from '../../../utils/calculations';
import { useTheme, useSession, useMarket } from '../../../context/AppContext';
import { isPreMarketWindow } from '../../../utils/marketHours';
import { useNewPredictions } from '../../../features/predictions/hooks/useNewPredictions';
import { useNewCharacters } from '../../../features/market/hooks/useNewCharacters';
import { useAdminAlerts } from '../../../features/admin/hooks/useAdminAlerts';
import MyPreMarketOrdersModal from '../../../features/trading/components/MyPreMarketOrdersModal';
import { themeClasses } from '../../../utils/theme';
import { OPEN_SEARCH_EVENT } from './GlobalShortcuts';
import { MOD_LABEL } from '../../hooks/useShortcuts';
import PixelIcon from '../PixelIcon';
import AccountMenu from './AccountMenu';
import { useSoundsEnabled } from '../../hooks/useSoundsEnabled';
import { playSound, setSoundsEnabled } from '../../../utils/sounds';

export interface HeaderProps {
  setDarkMode: (dark: boolean) => void;
  onShowAdminPanel: () => void;
  isGuest: boolean;
  onShowLogin: () => void;
  notificationCount: number;
  onToggleNotifications: () => void;
  /** Crew picker, for the account menu when the player has no crew. */
  onShowCrews: () => void;
}

// Ladder icon component - tan circle with X
const Header = ({
  setDarkMode,
  onShowAdminPanel,
  isGuest,
  onShowLogin,
  notificationCount,
  onToggleNotifications,
  onShowCrews,
}: HeaderProps) => {
  const { darkMode } = useTheme();
  const soundOn = useSoundsEnabled();
  const { user, userData } = useSession();
  const { prices } = useMarket();
  const newCharacters = useNewCharacters();
  const { textClass } = themeClasses;
  // Live value from current prices — the stored userData.portfolioValue only
  // updates on the backend sync, so it can visibly disagree with the rest of
  // the page while prices move.
  const liveValue = useMemo(() => (userData ? calculatePortfolioValue(userData, prices || {}) : 0), [userData, prices]);
  const location = useLocation();
  const navigate = useNavigate();
  const [scrolled, setScrolled] = useState(false);
  const [showNewCharsPopout, setShowNewCharsPopout] = useState(false);
  // Badge clears once the popout has been opened for the current batch of new
  // characters; a new batch (different tickers) brings it back.
  const newCharsId = newCharacters
    .map((c) => c.ticker)
    .sort()
    .join(',');
  const [seenNewCharsId, setSeenNewCharsId] = useState(() => {
    try {
      return localStorage.getItem('seenNewCharsId') || '';
    } catch {
      return '';
    }
  });
  const hasUnseenNewChars = newCharsId !== '' && newCharsId !== seenNewCharsId;
  const openNewCharsPopout = () => {
    setShowNewCharsPopout((prev) => !prev);
    setSeenNewCharsId(newCharsId);
    try {
      localStorage.setItem('seenNewCharsId', newCharsId);
    } catch {
      /* ignore */
    }
  };
  const [showPreMarketOrders, setShowPreMarketOrders] = useState(false);
  const [inPreMarket, setInPreMarket] = useState(isPreMarketWindow());

  useEffect(() => {
    const interval = setInterval(() => setInPreMarket(isPreMarketWindow()), 10000);
    return () => clearInterval(interval);
  }, []);
  const newCharsRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (newCharsRef.current && !newCharsRef.current.contains(e.target as Node)) {
        setShowNewCharsPopout(false);
      }
    };
    if (showNewCharsPopout) document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showNewCharsPopout]);

  useEffect(() => {
    const handleScroll = () => {
      setScrolled(window.scrollY > 10);
    };

    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  const isAdmin = user && ADMIN_UIDS.includes(user.uid);
  const { unreviewedCount, highSeverityCount } = useAdminAlerts(user);

  const isActivePage = (path: string) => {
    return location.pathname === path;
  };

  const { newCount: newPredictions } = useNewPredictions();

  const navLinks = [
    { path: '/leaderboard', label: 'Leaderboard', icon: <PixelIcon name="trophy" className="w-5 h-5" /> },
    {
      path: '/predictions',
      label: 'Predictions',
      icon: <PixelIcon name="crystal" className="w-5 h-5" />,
      badge: newPredictions,
    },
    { path: '/ladder', label: 'Ladder', icon: <PixelIcon name="ladder" className="w-5 h-5" /> },
    { path: '/missions', label: 'Missions', icon: <PixelIcon name="missions" className="w-5 h-5" /> },
    { path: '/portfolio', label: 'Portfolio', icon: <PixelIcon name="briefcase" set="discord" className="w-5 h-5" /> },
  ];

  return (
    <>
      {showPreMarketOrders && <MyPreMarketOrdersModal onClose={() => setShowPreMarketOrders(false)} />}
      <header className="sticky top-0 z-40 border-b shadow-sm light:bg-white light:border-amber-200 dark:bg-zinc-900 dark:border-zinc-800">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="relative flex items-center justify-between h-16">
            {/* Mobile: Logo on left */}
            <Link to="/" className="flex-shrink-0 md:hidden">
              <img
                src={darkMode ? '/stockism grey splatter.png' : '/stockism logo.png'}
                alt="Stockism"
                className="h-10 w-auto select-none cursor-pointer hover:opacity-90 transition-opacity"
                draggable="false"
                onContextMenu={(e) => e.preventDefault()}
                style={{ userSelect: 'none', WebkitUserSelect: 'none' }}
              />
            </Link>

            {/* Desktop: Nav links on left */}
            <nav className="hidden md:flex items-center space-x-1" data-tour="nav">
              {navLinks.map((link) => (
                <button
                  key={link.path}
                  title={link.label}
                  aria-label={link.label}
                  onClick={() => navigate(isActivePage(link.path) ? '/' : link.path)}
                  className={`relative inline-flex items-center px-3 py-2 rounded-sm text-sm font-medium transition-colors ${
                    isActivePage(link.path)
                      ? 'shadow-[inset_0_-2px_0_#f97316] light:bg-amber-50 light:text-slate-900 dark:bg-zinc-800/70 dark:text-zinc-50'
                      : 'light:text-zinc-600 light:hover:bg-amber-50 dark:text-zinc-300 dark:hover:bg-zinc-800'
                  }`}
                >
                  {/* Icons only until there's room for the labels and the controls. */}
                  <span className="lg:mr-1.5 flex">{link.icon}</span>
                  <span className="hidden lg:inline">{link.label}</span>
                  {!!link.badge && link.badge > 0 && (
                    <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 flex items-center justify-center rounded-full bg-red-500 text-white text-[10px] font-bold">
                      {link.badge > 9 ? '9+' : link.badge}
                    </span>
                  )}
                </button>
              ))}
            </nav>

            {/* Desktop: Centered logo - appears in header on scroll, and always on a
                profile, which has no logo on the page (Layout). */}
            <Link
              to="/"
              className={`hidden md:block absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50 transition-opacity duration-200 ease-in-out ${
                scrolled || location.pathname.startsWith('/u/') ? 'opacity-100' : 'opacity-0 pointer-events-none'
              }`}
            >
              <img
                src={darkMode ? '/stockism grey splatter.png' : '/stockism logo.png'}
                alt="Stockism"
                className="h-10 w-auto select-none cursor-pointer hover:opacity-90"
                draggable="false"
                onContextMenu={(e) => e.preventDefault()}
                style={{ userSelect: 'none', WebkitUserSelect: 'none' }}
              />
            </Link>

            {/* User Info & Controls */}
            <div className="flex items-center space-x-2 sm:space-x-4">
              {/* Quick search (Ctrl+K). Desktop only: phones have the market search. */}
              <button
                onClick={() => window.dispatchEvent(new Event(OPEN_SEARCH_EVENT))}
                className="hidden lg:flex items-center gap-2 px-3 py-1.5 text-sm rounded-md border light:border-amber-200 light:text-zinc-500 dark:border-zinc-700 dark:text-zinc-400 hover:text-orange-500"
              >
                Search
                <kbd className="text-[10px] font-mono opacity-70">{MOD_LABEL} K</kbd>
              </button>
              {/* Dark Mode Toggle */}
              <button
                onClick={() => setDarkMode(!darkMode)}
                className="p-2 rounded-md transition-colors light:hover:bg-amber-50 dark:hover:bg-zinc-800"
                aria-label="Toggle dark mode"
              >
                <PixelIcon name={darkMode ? 'sun' : 'moon'} className="w-5 h-5 block" />
              </button>
              <button
                onClick={() => {
                  setSoundsEnabled(!soundOn);
                  if (!soundOn) playSound('coin');
                }}
                className="p-2 rounded-md transition-colors light:hover:bg-amber-50 dark:hover:bg-zinc-800"
                aria-label={soundOn ? 'Turn sound effects off' : 'Turn sound effects on'}
                aria-pressed={soundOn}
                title={soundOn ? 'Sound effects on' : 'Sound effects off'}
              >
                <PixelIcon name={soundOn ? 'sound_on' : 'sound_off'} className="w-5 h-5 block" />
              </button>

              {/* Pre-Market Orders Button */}
              {user && !isGuest && inPreMarket && (
                <button
                  onClick={() => setShowPreMarketOrders(true)}
                  className="px-2 py-1 text-xs font-semibold rounded-sm border transition-colors light:border-orange-500 light:text-orange-500 light:hover:bg-orange-50 dark:border-orange-500 dark:text-orange-400 dark:hover:bg-orange-500/20"
                  title="My pre-market orders"
                >
                  <PixelIcon name="missions" className="w-3.5 h-3.5 mr-1 align-[-2px]" />
                  My Orders
                </button>
              )}

              {/* Notification Bell */}
              {user && !isGuest && (
                <button
                  onClick={onToggleNotifications}
                  className="p-2 rounded-md transition-colors relative light:hover:bg-amber-50 dark:hover:bg-zinc-800"
                  aria-label="Notifications"
                >
                  <PixelIcon name="bell" className="w-5 h-5 block" />
                  {notificationCount > 0 && (
                    <span className="absolute -top-0.5 -right-0.5 bg-orange-500 text-white text-[10px] font-bold min-w-[18px] h-[18px] rounded-full flex items-center justify-center leading-none">
                      {notificationCount > 99 ? '99+' : notificationCount}
                    </span>
                  )}
                </button>
              )}

              {/* New Characters Notification */}
              {newCharacters.length > 0 && (
                <div className="relative" ref={newCharsRef}>
                  <button
                    onClick={openNewCharsPopout}
                    className="p-2 rounded-md transition-colors relative light:hover:bg-amber-50 dark:hover:bg-zinc-800"
                    aria-label="New characters this week"
                    title="New characters this week"
                  >
                    <PixelIcon name="star" set="discord" className="w-5 h-5 align-middle" />
                    {hasUnseenNewChars && (
                      <span className="absolute -top-0.5 -right-0.5 bg-orange-500 text-white text-[10px] font-bold min-w-[18px] h-[18px] rounded-full flex items-center justify-center leading-none">
                        {newCharacters.length}
                      </span>
                    )}
                  </button>

                  {showNewCharsPopout && (
                    <div className="absolute right-0 top-full mt-2 w-72 rounded-sm border shadow-lg z-50 light:bg-white light:border-amber-200 dark:bg-zinc-900 dark:border-zinc-700">
                      <div className="px-3 py-2 border-b text-xs font-semibold uppercase tracking-wide light:border-amber-200 light:text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
                        New This Week
                      </div>
                      <div className="max-h-60 overflow-y-auto">
                        {newCharacters.map((char) => (
                          <div
                            key={char.ticker}
                            className="flex items-center justify-between px-3 py-2 border-b last:border-0 light:border-amber-100 dark:border-zinc-800"
                          >
                            <div className="min-w-0 flex-1">
                              <span className={`text-sm font-semibold ${textClass}`}>{char.name}</span>
                              <span className="text-xs ml-1 light:text-zinc-500 dark:text-zinc-400">
                                ${char.ticker}
                              </span>
                            </div>
                            <div className="text-right ml-2 shrink-0">
                              <span className={`text-sm font-bold ${textClass}`}>
                                ${(char.currentPrice || 0).toFixed(2)}
                              </span>
                              <span
                                className={`text-xs ml-1 ${
                                  userData?.colorBlindMode
                                    ? char.weeklyChange >= 0
                                      ? 'text-teal-500'
                                      : 'text-purple-500'
                                    : char.weeklyChange >= 0
                                      ? 'text-green-500'
                                      : 'text-red-500'
                                }`}
                              >
                                {char.weeklyChange >= 0 ? '▲' : '▼'}
                                {Math.abs(char.weeklyChange || 0).toFixed(1)}%
                              </span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Admin Panel (Admin Only) */}
              {isAdmin && (
                <button
                  onClick={onShowAdminPanel}
                  className="relative p-2 rounded-md transition-colors light:hover:bg-amber-50 light:text-red-600 dark:hover:bg-zinc-800 dark:text-red-400"
                  aria-label={
                    unreviewedCount
                      ? `Admin Panel, ${unreviewedCount} unreviewed alert${unreviewedCount === 1 ? '' : 's'}`
                      : 'Admin Panel'
                  }
                  title={
                    unreviewedCount
                      ? `${unreviewedCount} unreviewed watchlist alert${unreviewedCount === 1 ? '' : 's'}`
                      : 'Admin Panel'
                  }
                >
                  <PixelIcon name="gear" set="admin" className="w-5 h-5 align-middle" />
                  {unreviewedCount > 0 && (
                    <span
                      className={`absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 flex items-center justify-center rounded-full text-[10px] font-bold text-white ${
                        highSeverityCount > 0 ? 'bg-red-500' : 'bg-amber-500'
                      }`}
                    >
                      {unreviewedCount > 9 ? '9+' : unreviewedCount}
                    </span>
                  )}
                </button>
              )}

              {/* Account menu: portfolio, profile, achievements, sign out */}
              {user ? (
                <AccountMenu value={liveValue} onShowCrews={onShowCrews} />
              ) : (
                <button
                  onClick={onShowLogin}
                  className="px-3 py-2 text-sm font-medium rounded-md transition-colors light:text-green-600 light:hover:bg-amber-50 dark:text-green-400 dark:hover:bg-zinc-800"
                >
                  Sign In
                </button>
              )}
            </div>
          </div>
        </div>
      </header>
    </>
  );
};

export default Header;
