import { useState } from 'react';
import { useAppContext } from '../context/AppContext';
import { CREW_MAP } from '../crews';
import { usePortfolioHistory } from '../components/portfolio/usePortfolioHistory';
import PortfolioAnalytics from '../components/PortfolioAnalytics';
import { getThemeClasses } from '../utils/theme';
import ProfileHeader from '../components/profile/ProfileHeader';
import DiscordLinkBanner from '../components/profile/DiscordLinkBanner';
import CrewSection from '../components/profile/CrewSection';
import ProfileChart from '../components/profile/ProfileChart';
import TradingStats from '../components/profile/TradingStats';
import LadderStats from '../components/profile/LadderStats';
import ProfileSettings from '../components/profile/ProfileSettings';
import PredictionHistory from '../components/profile/PredictionHistory';
import DeleteAccountSection from '../components/profile/DeleteAccountSection';

const ProfilePage = ({ onOpenCrewSelection, onDeleteAccount }) => {
  const { darkMode, user, userData, predictions, prices, holdings, shorts, costBasis } = useAppContext();
  // History is fetched per selected chart range so we only read what the
  // chart shows (the full subcollection can be thousands of docs).
  const [chartTimeRange, setChartTimeRange] = useState('1m');
  const { history: portfolioHistory } = usePortfolioHistory(user, chartTimeRange);

  const { cardClass, mutedClass } = getThemeClasses(darkMode);
  const colorBlindMode = userData?.colorBlindMode || false;

  const bets = userData?.bets || {};
  const predictionWins = userData?.predictionWins || 0;
  const userCrew = userData?.crew;
  const crewData = userCrew ? CREW_MAP[userCrew] : null;

  // Portfolio value
  const holdingsValue = Object.entries(holdings || {}).reduce((sum, [ticker, shares]) => sum + (prices[ticker] || 0) * shares, 0);
  const shortsValue = Object.entries(shorts || {}).reduce((sum, [ticker, position]) => {
    if (!position || typeof position !== 'object') return sum;
    const shares = Number(position.shares) || 0;
    if (shares <= 0) return sum;
    const entryPrice = Number(position.costBasis || position.entryPrice) || 0;
    const currentPrice = prices[ticker] || entryPrice;
    const collateral = Number(position.margin) || 0;
    const value = position.system === 'v2'
      ? collateral + (entryPrice - currentPrice) * shares
      : collateral - (currentPrice * shares);
    return sum + (isNaN(value) ? 0 : value);
  }, 0);
  const portfolioValue = (userData?.cash || 0) + holdingsValue + shortsValue;

  // Get all predictions user has bet on
  const userBetHistory = Object.entries(bets).map(([predictionId, betData]) => {
    const prediction = predictions?.find(p => p.id === predictionId);
    return {
      predictionId,
      ...betData,
      prediction
    };
  }).sort((a, b) => (b.placedAt || 0) - (a.placedAt || 0));

  if (!user || !userData) {
    return (
      <div className="max-w-2xl mx-auto p-4">
        <div className={`${cardClass} border rounded-sm shadow-xl p-8 text-center`}>
          <p className={mutedClass}>Please sign in to view your profile</p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto p-4">
      <div className={`${cardClass} border rounded-sm shadow-xl overflow-hidden`}>
        <ProfileHeader userData={userData} darkMode={darkMode} />

        <div className="p-4 space-y-4 max-h-[75vh] overflow-y-auto">
          <DiscordLinkBanner />

          <CrewSection
            userCrew={userCrew}
            crewData={crewData}
            userData={userData}
            darkMode={darkMode}
            onOpenCrewSelection={onOpenCrewSelection}
          />

          <ProfileChart
            portfolioValue={portfolioValue}
            portfolioHistory={portfolioHistory}
            darkMode={darkMode}
            colorBlindMode={colorBlindMode}
            timeRange={chartTimeRange}
            onTimeRangeChange={setChartTimeRange}
          />

          <TradingStats
            userData={userData}
            holdings={holdings}
            shorts={shorts}
            prices={prices}
            costBasis={costBasis}
            predictionWins={predictionWins}
            betsPlaced={userBetHistory.length}
            darkMode={darkMode}
          />

          <LadderStats user={user} userData={userData} darkMode={darkMode} />

          <PortfolioAnalytics
            darkMode={darkMode}
            holdings={holdings}
            shorts={shorts}
            prices={prices}
            costBasis={costBasis}
            portfolioValue={portfolioValue}
          />

          <ProfileSettings userData={userData} user={user} darkMode={darkMode} />

          <PredictionHistory userBetHistory={userBetHistory} userData={userData} darkMode={darkMode} />

          <DeleteAccountSection userData={userData} darkMode={darkMode} onDeleteAccount={onDeleteAccount} />
        </div>
      </div>
    </div>
  );
};

export default ProfilePage;
