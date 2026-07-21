import ShortRiskAlert from '../components/ShortRiskAlert';
import IPOHypeCard from '../components/IPOHypeCard';
import IPOActiveCard from '../components/IPOActiveCard';
import DashboardRail from '../components/home/DashboardRail';
import MarketControls from '../components/home/MarketControls';
import MarketGrid from '../components/home/MarketGrid';
import { useAppContext } from '../context/AppContext';
import { getThemeClasses } from '../utils/theme';
import { useMarketBrowser } from '../hooks/useMarketBrowser';

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
  onShowCrews,
  onShowMargin,
  onShowAbout,
  onShowLogin,
  onShowPortfolio,
  onShowBailout,
}) => {
  const {
    darkMode, user, userData, prices, priceHistory,
    activeIPOs, ipoRestrictedTickers, launchedTickers,
  } = useAppContext();
  const { bgClass, mutedClass, ghostBtnClass } = getThemeClasses(darkMode);

  const browser = useMarketBrowser({ userData, prices, priceHistory, launchedTickers, ipoRestrictedTickers });

  const subHeaderBtnClass = `px-3 py-1.5 text-sm font-medium rounded-sm border transition-colors ${darkMode ? 'bg-zinc-900' : 'bg-white'} ${ghostBtnClass}`;

  return (
    <div className={`min-h-screen ${bgClass} p-4`}>
      <div className="max-w-6xl lg:max-w-none mx-auto">
        {/* Sub-header buttons */}
        <div className="flex flex-wrap gap-2 mb-4 justify-center">
          <button onClick={onShowMissions} className={subHeaderBtnClass}>
            📋 Missions
          </button>
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
          <div className={`mb-4 p-3 rounded-sm text-sm ${darkMode ? 'bg-zinc-900 border border-zinc-800 text-zinc-300' : 'bg-amber-50 border border-amber-200 text-amber-800'}`}>
            👋 Browsing as guest. <button onClick={onShowLogin} className="font-semibold text-orange-500 hover:underline">Sign in</button> to trade and save progress!
          </div>
        )}

        {/* Short margin warning — highest-stakes alert, keep at the top */}
        <ShortRiskAlert onOpenPortfolio={onShowPortfolio} />

        {/* IPO Announcements */}
        {activeIPOs.length > 0 && (
          <div className="mb-4">
            <h2 className={`text-sm font-semibold uppercase tracking-wide mb-3 ${mutedClass}`}>🚀 IPO</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {activeIPOs.map(ipo => {
                const now = Date.now();
                const inHypePhase = now < ipo.ipoStartsAt;

                return inHypePhase ? (
                  <IPOHypeCard key={ipo.ticker} ipo={ipo} />
                ) : (
                  <IPOActiveCard
                    key={ipo.ticker}
                    ipo={ipo}
                    onBuyIPO={onBuyIPO}
                  />
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
            checkinLoading={actionLoading.checkin}
            onCheckin={onCheckin}
            onShowLogin={onShowLogin}
            onShowPortfolio={onShowPortfolio}
            onShowBailout={onShowBailout}
          />

          {/* Market column */}
          <div className="lg:order-1 flex-1 min-w-0">
            <MarketControls
              marketTab={browser.marketTab} setMarketTab={browser.setMarketTab}
              crewFilter={browser.crewFilter} setCrewFilter={browser.setCrewFilter}
              sortBy={browser.sortBy} setSortBy={browser.setSortBy}
              searchQuery={browser.searchQuery} setSearchQuery={browser.setSearchQuery}
              currentPage={browser.currentPage} setCurrentPage={browser.setCurrentPage}
              totalPages={browser.totalPages}
              showAll={browser.showAll} setShowAll={browser.setShowAll}
              reviewChanges={browser.reviewChanges}
            />
            <MarketGrid
              displayedCharacters={browser.displayedCharacters}
              change24h={browser.change24h}
              activeUserData={activeUserData}
              onTrade={onTrade}
              onViewChart={onViewChart}
              limitOrderRequest={limitOrderRequest}
              onClearLimitOrderRequest={onClearLimitOrderRequest}
              onToggleWatchlist={onToggleWatchlist}
              tradeAnimation={tradeAnimation}
              onSetAlert={onSetAlert}
              marketTab={browser.marketTab}
              searchQuery={browser.searchQuery}
              currentPage={browser.currentPage} setCurrentPage={browser.setCurrentPage}
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
