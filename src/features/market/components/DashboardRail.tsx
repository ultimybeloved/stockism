import PredictionsTeaser from '../../predictions/components/PredictionsTeaser';
import ActivityFeed from '../../activity/components/ActivityFeed';
import WelcomeWeekCard from '../../../shared/components/WelcomeWeekCard';
import YouCard from './YouCard';
import { useMarket } from '../../../context/AppContext';
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

// Right-hand rail on the home page: the player's card, recent trades and the
// predictions teaser. Short enough to never need its own scrollbar; the market
// index lives above the market instead.
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
  const { predictions } = useMarket();

  return (
    <aside className="lg:order-2 lg:w-80 2xl:w-96 lg:shrink-0 lg:[@media(min-height:860px)]:sticky lg:top-20">
      {/* Phones get their own copy at the top of the home page. */}
      <WelcomeWeekCard className="max-md:hidden" />

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

      {/* Shown on phones too: it's the one card worth watching without tapping. */}
      <ActivityFeed limit={5} />

      <div className={phoneOpen ? '' : 'max-md:hidden'}>
        <PredictionsTeaser predictions={predictions} />
      </div>
    </aside>
  );
};

export default DashboardRail;
