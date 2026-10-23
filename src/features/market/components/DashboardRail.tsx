import PredictionsTeaser from '../../predictions/components/PredictionsTeaser';
import ActivityFeed from '../../activity/components/ActivityFeed';
import WelcomeWeekCard from '../../../shared/components/WelcomeWeekCard';
import YouCard from './YouCard';
import MarketIndex from './MarketIndex';
import { usePhone } from '../../../shared/hooks/useMediaQuery';
import { useMarket, useSession } from '../../../context/AppContext';
import type { UserData } from '../../../types';

interface DashboardRailProps {
  activeUserData: UserData;
  portfolioValue: number;
  isGuest: boolean;
  checkinLoading: boolean;
  onCheckin: () => void;
  onShowLogin: () => void;
  onShowPortfolio: () => void;
  onShowBailout: () => void;
  /** Phones show only the summary bar until it is tapped open. */
  phoneOpen?: boolean;
}

// Right-hand rail on the home page: market index, the player's card, welcome
// week, the predictions teaser and recent trades. Short enough to never need
// its own scrollbar.
const DashboardRail = ({
  activeUserData,
  portfolioValue,
  isGuest,
  checkinLoading,
  onCheckin,
  onShowLogin,
  onShowPortfolio,
  onShowBailout,
  phoneOpen = false,
}: DashboardRailProps) => {
  const { prices, priceHistory, predictions } = useMarket();
  const { userData } = useSession();
  const phone = usePhone();

  return (
    <aside className="lg:order-2 lg:w-80 2xl:w-96 lg:shrink-0 lg:[@media(min-height:860px)]:sticky lg:top-20">
      <MarketIndex prices={prices} priceHistory={priceHistory} colorBlindMode={userData?.colorBlindMode} />

      {/* Phones hide this behind the summary bar (PhoneSummaryBar). */}
      <div className={phoneOpen ? '' : 'max-md:hidden'}>
        <YouCard
          activeUserData={activeUserData}
          portfolioValue={portfolioValue}
          isGuest={isGuest}
          checkinLoading={checkinLoading}
          onCheckin={onCheckin}
          onShowLogin={onShowLogin}
          onShowPortfolio={onShowPortfolio}
          onShowBailout={onShowBailout}
        />
      </div>

      <WelcomeWeekCard />

      <div className={phoneOpen ? '' : 'max-md:hidden'}>
        <PredictionsTeaser predictions={predictions} />
      </div>

      {/* Phones: two rows that open up on tap. */}
      <ActivityFeed limit={phone ? 2 : 5} compact={phone} />
    </aside>
  );
};

export default DashboardRail;
