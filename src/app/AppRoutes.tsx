import { lazy, Suspense, useEffect, type ComponentProps } from 'react';
import { Routes, Route, Navigate, useLocation, useNavigationType } from 'react-router-dom';
import ErrorBoundary from '../shared/components/ErrorBoundary';
import DiscordLinkRedirect from './DiscordLinkRedirect';

// The home page loads with the app; every other page downloads on first visit.
import HomePage from '../features/market/pages/HomePage';
const StockPage = lazy(() => import('../features/market/pages/StockPage'));
const LeaderboardPage = lazy(() => import('../features/leaderboard/pages/LeaderboardPage'));
const AchievementsPage = lazy(() => import('../features/profile/pages/AchievementsPage'));
const LadderPage = lazy(() => import('../features/ladder/pages/LadderPage'));
const ProfilePage = lazy(() => import('../features/profile/pages/ProfilePage'));
const PublicProfilePage = lazy(() => import('../features/profile/pages/PublicProfilePage'));
const PredictionsPage = lazy(() => import('../features/predictions/pages/PredictionsPage'));
const PortfolioPage = lazy(() => import('../features/portfolio/pages/PortfolioPage'));

interface AppRoutesProps {
  home: ComponentProps<typeof HomePage>;
  predictions: ComponentProps<typeof PredictionsPage>;
  profile: ComponentProps<typeof ProfilePage>;
  portfolio: ComponentProps<typeof PortfolioPage>;
  onPinAction: ComponentProps<typeof AchievementsPage>['onPinAction'];
  onTrade: ComponentProps<typeof StockPage>['onTrade'];
  onShowLogin: () => void;
}

// Every page, by URL. App builds each page's props; this only maps paths to pages.
export default function AppRoutes({
  home,
  predictions,
  profile,
  portfolio,
  onPinAction,
  onTrade,
  onShowLogin,
}: AppRoutesProps) {
  // A crashed page clears itself when the player navigates somewhere else.
  const { pathname } = useLocation();
  // A new page opens at its top; Back and Forward keep where you were.
  const navType = useNavigationType();
  useEffect(() => {
    if (navType !== 'POP') window.scrollTo(0, 0);
  }, [pathname, navType]);
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center h-64">
          <div className="w-8 h-8 border-4 border-orange-500 border-t-transparent rounded-full animate-spin" />
        </div>
      }
    >
      <ErrorBoundary resetKey={pathname}>
        <Routes>
          <Route path="/" element={<HomePage {...home} />} />
          <Route path="/leaderboard" element={<LeaderboardPage />} />
          <Route path="/achievements" element={<AchievementsPage onPinAction={onPinAction} />} />
          <Route path="/ladder" element={<LadderPage />} />
          <Route path="/predictions" element={<PredictionsPage {...predictions} />} />
          <Route path="/profile" element={<ProfilePage {...profile} />} />
          <Route path="/portfolio" element={<PortfolioPage {...portfolio} />} />
          <Route path="/link-discord" element={<DiscordLinkRedirect onShowLogin={onShowLogin} />} />
          <Route path="/u/:username" element={<PublicProfilePage />} />
          <Route path="/stock/:ticker" element={<StockPage onTrade={onTrade} />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </ErrorBoundary>
    </Suspense>
  );
}
