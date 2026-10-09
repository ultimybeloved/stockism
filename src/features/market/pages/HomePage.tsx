import ShortRiskAlert from '../../trading/components/ShortRiskAlert';
import SeasonCard from '../../season/components/SeasonCard';
import IPOHypeCard from '../../ipo/components/IPOHypeCard';
import IPOActiveCard from '../../ipo/components/IPOActiveCard';
import DashboardRail from '../components/DashboardRail';
import MarketControls from '../components/MarketControls';
import MarketGrid from '../components/MarketGrid';
import { useSession, useMarket } from '../../../context/AppContext';

import { themeClasses } from '../../../utils/theme';
import { useMarketBrowser } from '../hooks/useMarketBrowser';
import type { ComponentProps } from 'react';

type GridProps = ComponentProps<typeof MarketGrid>;

type HomePageProps = Pick<
  GridProps,
  | 'activeUserData'
  | 'onTrade'
  | 'onViewChart'
  | 'onToggleWatchlist'
  | 'tradeAnimation'
  | 'limitOrderRequest'
  | 'onClearLimitOrderRequest'
  | 'onSetAlert'
> &
  Pick<
    ComponentProps<typeof DashboardRail>,
    'portfolioValue' | 'isGuest' | 'onShowLogin' | 'onShowPortfolio' | 'onShowBailout'
  > &
  Pick<ComponentProps<typeof IPOActiveCard>, 'onBuyIPO'> & {
    /** In-flight action flags, keyed by action ('checkin', ...). */
    actionLoading: Record<string, boolean | undefined>;
    onCheckin: () => void;
    onShowMissions: () => void;
    onShowPinShop: () => void;
    onShowCrews: () => void;
    onShowMargin: () => void;
    onShowAbout: () => void;
  };

// The market home page: sub-header shortcuts, IPO section, dashboard rail,
// and the browsable character grid. Modal open/close state stays in App;
// this page receives openers and trade callbacks as props.
const HomePage = ({
  isGuest,
  activeUserData,
  portfolioValue,
  actionLoading,
  onCheckin,
  onBuyIPO,
  onTrade,
  onViewChart,
  onToggleWatchlist,
  tradeAnimation,
  limitOrderRequest,
  onClearLimitOrderRequest,
  onSetAlert,
  onShowMissions,
  onShowPinShop,
  onShowCrews,
  onShowMargin,
  onShowAbout,
  onShowLogin,
  onShowPortfolio,
  onShowBailout,
}: HomePageProps) => {
  const { user, userData } = useSession();
  const { prices, priceHistory, activeIPOs, ipoRestrictedTickers, launchedTickers, storedReviewChanges } = useMarket();
  const { bgClass, mutedClass, ghostBtnClass } = themeClasses;

  const browser = useMarketBrowser({
    userData,
    prices,
    priceHistory,
    launchedTickers,
    ipoRestrictedTickers,
    storedReviewChanges,
  });

  const subHeaderBtnClass = `px-3 py-1.5 text-sm font-medium rounded-sm border transition-colors light:bg-white dark:bg-zinc-900 ${ghostBtnClass}`;

  return (
    <div className={`min-h-screen ${bgClass} p-4`}>
      <div className="max-w-6xl lg:max-w-none mx-auto">
        {/* Sub-header buttons */}
        <div className="flex flex-wrap gap-2 mb-4 justify-center">
          <button onClick={onShowMissions} className={subHeaderBtnClass}>
            📋 Missions
          </button>
          {user && !isGuest && (
            <button onClick={onShowPinShop} className={subHeaderBtnClass}>
              🎨 Customization
            </button>
          )}
          {(!userData?.crew || isGuest) && (
            <button onClick={onShowCrews} className={subHeaderBtnClass}>
              👥 Crews
            </button>
          )}
          {user && !isGuest && (
            <button onClick={onShowMargin} className={subHeaderBtnClass}>
              💰 Margin
            </button>
          )}
          <button onClick={onShowAbout} className={subHeaderBtnClass}>
            ℹ️ About
          </button>
        </div>

        {/* Guest Banner */}
        {isGuest && (
          <div className="mb-4 p-3 rounded-sm text-sm light:bg-amber-50 light:border light:border-amber-200 light:text-amber-800 dark:bg-zinc-900 dark:border dark:border-zinc-800 dark:text-zinc-300">
            👋 Browsing as guest.{' '}
            <button onClick={onShowLogin} className="font-semibold text-orange-500 hover:underline">
              Sign in
            </button>{' '}
            to trade and save progress!
          </div>
        )}

        {/* Short margin warning — highest-stakes alert, keep at the top */}
        {!isGuest && <SeasonCard />}

        <ShortRiskAlert onOpenPortfolio={onShowPortfolio} />

        {/* IPO Announcements */}
        {activeIPOs.length > 0 && (
          <div className="mb-4">
            <h2 className={`text-sm font-semibold uppercase tracking-wide mb-3 ${mutedClass}`}>🚀 IPO</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {activeIPOs.map((ipo) => {
                const now = Date.now();
                const inHypePhase = now < ipo.ipoStartsAt;

                return inHypePhase ? (
                  <IPOHypeCard key={ipo.ticker} ipo={ipo} />
                ) : (
                  <IPOActiveCard key={ipo.ticker} ipo={ipo} onBuyIPO={onBuyIPO} />
                );
              })}
            </div>
          </div>
        )}

        {/* Desktop: market fills the left, dashboard rail pinned on the right with
            its own scroll. Mobile/tablet: everything stacks exactly as before
            (DOM order = mobile order; the order classes flip it on desktop). */}
        <div className="lg:flex lg:items-start lg:gap-6">
          <DashboardRail
            activeUserData={activeUserData}
            portfolioValue={portfolioValue}
            isGuest={isGuest}
            checkinLoading={!!actionLoading.checkin}
            onCheckin={onCheckin}
            onShowLogin={onShowLogin}
            onShowPortfolio={onShowPortfolio}
            onShowBailout={onShowBailout}
          />

          {/* Market column */}
          <div className="lg:order-1 flex-1 min-w-0">
            <MarketControls
              filters={browser.filters}
              setFilter={browser.setFilter}
              clearFilters={browser.clearFilters}
              sortBy={browser.sortBy}
              setSortBy={browser.setSortBy}
              currentPage={browser.currentPage}
              setCurrentPage={browser.setCurrentPage}
              totalPages={browser.totalPages}
              showAll={browser.showAll}
              setShowAll={browser.setShowAll}
              reviewChanges={browser.reviewChanges}
            />
            <MarketGrid
              displayedCharacters={browser.displayedCharacters}
              activeUserData={activeUserData}
              onTrade={onTrade}
              onViewChart={onViewChart}
              limitOrderRequest={limitOrderRequest}
              onClearLimitOrderRequest={onClearLimitOrderRequest}
              onToggleWatchlist={onToggleWatchlist}
              tradeAnimation={tradeAnimation}
              onSetAlert={onSetAlert}
              marketTab={browser.filters.tab}
              reviewChanges={browser.reviewChanges}
              reviewSections={browser.reviewSections}
              searchQuery={browser.filters.search}
              currentPage={browser.currentPage}
              setCurrentPage={browser.setCurrentPage}
              totalPages={browser.totalPages}
              showAll={browser.showAll}
            />
          </div>
        </div>
      </div>
    </div>
  );
};

export default HomePage;
