import { Link } from 'react-router-dom';
import Header from './Header';
import MobileBottomNav from './MobileBottomNav';
import Footer from './Footer';
import MarketTicker from '../../../features/market/components/MarketTicker';
import SiteMessageBar from '../SiteMessageBar';
import { useTheme } from '../../../context/AppContext';
import { usePageTitle } from '../../hooks/usePageTitle';
import type { ReactNode } from 'react';
import type { HeaderProps } from './Header';

type LayoutProps = HeaderProps & { children?: ReactNode };

const Layout = ({
  children,
  setDarkMode,
  onShowAdminPanel,
  isGuest,
  onShowLogin,
  notificationCount,
  onToggleNotifications,
}: LayoutProps) => {
  const { darkMode } = useTheme();
  usePageTitle();
  return (
    <div className="min-h-screen light:bg-amber-50 dark:bg-zinc-950">
      <Header
        setDarkMode={setDarkMode}
        onShowAdminPanel={onShowAdminPanel}
        isGuest={isGuest}
        onShowLogin={onShowLogin}
        notificationCount={notificationCount}
        onToggleNotifications={onToggleNotifications}
      />

      <MarketTicker />
      <SiteMessageBar />

      {/* Desktop Hero Logo - sits below ticker, scrolls away naturally */}
      <div className="hidden md:flex justify-center py-2">
        <Link to="/">
          <img
            src={darkMode ? '/stockism grey splatter.png' : '/stockism logo.png'}
            alt="Stockism"
            className="h-40 w-auto select-none cursor-pointer hover:opacity-90 transition-opacity"
            draggable="false"
            onContextMenu={(e) => e.preventDefault()}
            style={{ userSelect: 'none', WebkitUserSelect: 'none' }}
          />
        </Link>
      </div>

      <main className="pb-20 md:pb-6">{children}</main>

      <Footer />
      <MobileBottomNav />
    </div>
  );
};

export default Layout;
