import ShortRiskAlert from '../../trading/components/ShortRiskAlert';
import SeasonCard from '../../season/components/SeasonCard';
import IPOHypeCard from '../../ipo/components/IPOHypeCard';
import IPOActiveCard from '../../ipo/components/IPOActiveCard';
import DashboardRail from '../components/DashboardRail';
import PhoneSummaryBar from '../components/PhoneSummaryBar';
import StockPopup from '../components/StockPopup';
import CompareTray from '../components/CompareTray';
import CompareChartModal from '../components/CompareChartModal';
import { useDesktopMarket } from '../hooks/useDesktopMarket';
import MarketControls from '../components/MarketControls';
import MarketGrid from '../components/MarketGrid';
import { useSession, useMarket } from '../../../context/AppContext';

import { themeClasses } from '../../../utils/theme';
import { calculatePortfolioValue } from '../../../utils/calculations';
import { useMarketBrowser } from '../hooks/useMarketBrowser';
import { useMarketView } from '../hooks/useMarketView';
import { useState, type ComponentProps } from 'react';
import { useNavigate } from 'react-router-dom';
import PixelIcon from '../../../shared/components/PixelIcon';
import { useSeenFlag } from '../../../shared/hooks/useSeenFlag';
import NewBadge from '../../../shared/components/NewBadge';
import { SHOP_DROP_ID } from '../../../constants/cosmetics';
import { CREW_MAP } from '../../../crews';
import { ITEMS_PER_PAGE, LIST_ITEMS_PER_PAGE } from '../../../constants/economy';

type GridProps = ComponentProps<typeof MarketGrid>;

type HomePageProps = Pick<
  GridProps,
  'activeUserData' | 'onTrade' | 'onViewChart' | 'onToggleWatchlist' | 'tradeAnimation' | 'onSetAlert'
> &
  Pick<ComponentProps<typeof DashboardRail>, 'isGuest' | 'onShowLogin' | 'onShowPortfolio' | 'onShowBailout'> &
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
  actionLoading,
  onCheckin,
  onBuyIPO,
  onTrade,
  onViewChart,
  onToggleWatchlist,
  tradeAnimation,
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
  const portfolioValue = calculatePortfolioValue(activeUserData, prices);
  const { bgClass, mutedClass, ghostBtnClass } = themeClasses;

  const { view, setView } = useMarketView();
  const browser = useMarketBrowser({
    perPage: view === 'list' ? LIST_ITEMS_PER_PAGE : ITEMS_PER_PAGE,
    userData,
    prices,
    priceHistory,
    launchedTickers,
    ipoRestrictedTickers,
    storedReviewChanges,
  });

  const [railOpen, setRailOpen] = useState(false);
  const desk = useDesktopMarket({
    characters: browser.reviewSections
      ? browser.reviewSections.flatMap((s) => s.characters)
      : browser.displayedCharacters,
    onViewChart,
  });

  const [shopDropUnseen] = useSeenFlag(`customize:${SHOP_DROP_ID}`);
  const navigate = useNavigate();
  const subHeaderBtnClass = `shrink-0 whitespace-nowrap px-3 py-1.5 text-sm font-medium rounded-sm border transition-colors light:bg-white dark:bg-zinc-900 ${ghostBtnClass}`;

  return (
    <div className={`min-h-screen ${bgClass} p-4`}>
      <div className="max-w-6xl lg:max-w-none mx-auto">
        {/* Sub-header buttons */}
        <div className="flex gap-2 mb-4 sm:flex-wrap sm:justify-center max-sm:overflow-x-auto max-sm:-mx-4 max-sm:px-4 max-sm:pt-2 no-scrollbar">
          <button onClick={isGuest ? onShowLogin : onShowMissions} className={subHeaderBtnClass}>
            <PixelIcon name="missions" className="w-4 h-4 mr-1.5 align-[-3px]" />
            Missions
          </button>
          {user && !isGuest && (
            <button onClick={onShowPinShop} className={`relative ${subHeaderBtnClass}`}>
              <PixelIcon name="palette" className="w-4 h-4 mr-1.5 align-[-3px]" />
              Customization
              {shopDropUnseen && <NewBadge />}
            </button>
          )}
          <button onClick={() => navigate('/achievements')} className={subHeaderBtnClass}>
            <PixelIcon name="medal" className="w-4 h-4 mr-1.5 align-[-3px]" />
            Achievements
          </button>
          {userData?.crew && !isGuest && CREW_MAP[userData.crew] && (
            <button onClick={() => navigate(`/crew/${userData.crew}`)} className={subHeaderBtnClass}>
              <PixelIcon name="crews" className="w-4 h-4 mr-1.5 align-[-3px]" />
              My Crew
            </button>
          )}
          {(!userData?.crew || isGuest) && (
            <button onClick={onShowCrews} className={subHeaderBtnClass}>
              <PixelIcon name="crews" className="w-4 h-4 mr-1.5 align-[-3px]" />
              Crews
            </button>
          )}
          {user && !isGuest && (
            <button onClick={onShowMargin} className={subHeaderBtnClass}>
              <PixelIcon name="margin" className="w-4 h-4 mr-1.5 align-[-3px]" />
              Margin
            </button>
          )}
          <button onClick={onShowAbout} className={subHeaderBtnClass}>
            <PixelIcon name="about" className="w-4 h-4 mr-1.5 align-[-3px]" />
            About
          </button>
        </div>

        <PhoneSummaryBar
          activeUserData={activeUserData}
          portfolioValue={portfolioValue}
          isGuest={isGuest}
          open={railOpen}
          onToggle={() => setRailOpen((o) => !o)}
          checkinLoading={!!actionLoading.checkin}
          onCheckin={onCheckin}
          onShowLogin={onShowLogin}
          onShowBailout={onShowBailout}
        />

        {/* Guest Banner */}
        {isGuest && (
          <div className="mb-4 p-3 rounded-sm text-sm light:bg-amber-50 light:border light:border-amber-200 light:text-amber-800 dark:bg-zinc-900 dark:border dark:border-zinc-800 dark:text-zinc-300">
            Browsing as guest.{' '}
            <button onClick={onShowLogin} className="font-semibold text-orange-500 hover:underline">
              Sign in
            </button>{' '}
            to trade and save progress!
          </div>
        )}

        {/* Short margin warning: highest-stakes alert, keep it above everything else */}
        <ShortRiskAlert onOpenPortfolio={onShowPortfolio} />

        {!isGuest && <SeasonCard />}

        {/* IPO Announcements */}
        {activeIPOs.length > 0 && (
          <div className="mb-4">
            <h2 className={`text-sm font-semibold uppercase tracking-wide mb-3 ${mutedClass}`}>
              <PixelIcon name="rocket" className="w-4 h-4 mr-1.5 align-[-3px]" />
              IPO
            </h2>
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
            phoneOpen={railOpen}
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
              view={view}
              setView={setView}
            />
            <MarketGrid
              displayedCharacters={browser.displayedCharacters}
              activeUserData={activeUserData}
              onTrade={onTrade}
              onViewChart={desk.openStock}
              selectedTicker={desk.panelCharacter?.ticker}
              compareTickers={desk.compare}
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
              view={view}
              sortBy={browser.sortBy}
              setSortBy={(s) => {
                browser.setSortBy(s);
                browser.setCurrentPage(1);
              }}
            />
          </div>
        </div>
      </div>

      {desk.panelCharacter && (
        <StockPopup
          character={desk.panelCharacter}
          onClose={desk.closePanel}
          onStep={desk.step}
          onTrade={onTrade}
          onToggleWatchlist={onToggleWatchlist}
          onSetAlert={onSetAlert}
          inCompare={desk.compare.includes(desk.panelCharacter.ticker)}
          onToggleCompare={desk.toggleCompare}
          pendingAction={desk.pendingAction}
          onPendingHandled={desk.clearPendingAction}
        />
      )}

      <CompareTray
        tickers={desk.compare}
        onRemove={desk.toggleCompare}
        onClear={desk.clearCompare}
        onCompare={() => desk.setComparing(true)}
      />
      {desk.comparing && (
        <CompareChartModal
          tickers={desk.compare}
          onRemove={desk.toggleCompare}
          onClose={() => desk.setComparing(false)}
        />
      )}
    </div>
  );
};

export default HomePage;
