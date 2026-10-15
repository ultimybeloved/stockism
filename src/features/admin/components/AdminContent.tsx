// Draws the admin section picked in the sidebar. AdminPanel owns the domain
// hooks and passes them in as `h`; each section gets its hook's return spread
// as props, as the tabs always have.
import { renameTickerFunction } from '../../../api/callables';
import HomeDashboard from './home/HomeDashboard';
import PlayersSection from './players/PlayersSection';
import WelcomeTracker from './welcome/WelcomeTracker';
import MoneyFlow from './money/MoneyFlow';
import DiscordActivity from './discordActivity/DiscordActivity';
import MarketGuard from './guard/MarketGuard';
import BotActivity from './bots/BotActivity';
import IpoTab from './IpoTab';
import PredictionsTab from './PredictionsTab';
import HoldersTab from './HoldersTab';
import TradesTab from './TradesTab';
import StatsTab from './StatsTab';
import RecoveryTab from './RecoveryTab';
import BadgesTab from './BadgesTab';
import MarketTab from './MarketTab';
import WatchlistTab from './WatchlistTab';
import DiagnosticTab from './DiagnosticTab';
import DividendsTab from './DividendsTab';
import DiscordTab from './DiscordTab';
import CashLogCard from './CashLogCard';
import AdminHistoryCard from './AdminHistoryCard';
import SiteMessagesTab from './SiteMessagesTab';
import type { AdminCommonProps } from './types';
import type { Character } from '../../../characters';
import type { PredictionDoc, PriceMap } from '../../../types';
import type { SetMessage, ShowMessage } from '../utils/adminShared';
import type { useAdminUserList } from '../hooks/useAdminUserList';
import type { useAdminUserOps } from '../hooks/useAdminUserOps';
import type { useAdminSeason } from '../hooks/useAdminSeason';
import type { useAdminCosmetics } from '../hooks/useAdminCosmetics';
import type { useAdminUserDeletion } from '../hooks/useAdminUserDeletion';
import type { useAdminPortfolioSync } from '../hooks/useAdminPortfolioSync';
import type { useAdminDividends } from '../hooks/useAdminDividends';
import type { useAdminWatchlist } from '../hooks/useAdminWatchlist';
import type { useAltScan } from '../hooks/useAltScan';
import type { useAdminBadges } from '../hooks/useAdminBadges';
import type { useAdminDiagnostics } from '../hooks/useAdminDiagnostics';
import type { useAdminMarketTools } from '../hooks/useAdminMarketTools';
import type { useAdminScheduledJobs } from '../hooks/useAdminScheduledJobs';
import type { useAdminReviewJobs } from '../hooks/useAdminReviewJobs';
import type { useAdminStats } from '../hooks/useAdminStats';
import type { useAdminHolders } from '../hooks/useAdminHolders';
import type { useAdminOrphans } from '../hooks/useAdminOrphans';
import type { useAdminPriceMaintenance } from '../hooks/useAdminPriceMaintenance';
import type { useAdminBackups } from '../hooks/useAdminBackups';
import type { useAdminPredictionCreate } from '../hooks/useAdminPredictionCreate';
import type { useAdminPredictionManage } from '../hooks/useAdminPredictionManage';
import type { useAdminBets } from '../hooks/useAdminBets';
import type { useAdminIpo } from '../hooks/useAdminIpo';
import type { useAdminTrades } from '../hooks/useAdminTrades';
import type { useAdminRecoveryTools } from '../hooks/useAdminRecoveryTools';
import type { useAdminDiscordMessages } from '../hooks/useAdminDiscordMessages';
import type { useAdminCashLog } from '../hooks/useAdminCashLog';
import type { useAdminSiteMessages } from '../hooks/useAdminSiteMessages';

export interface AdminHooks {
  userList: ReturnType<typeof useAdminUserList>;
  userOps: ReturnType<typeof useAdminUserOps>;
  seasonOps: ReturnType<typeof useAdminSeason>;
  cosmetics: ReturnType<typeof useAdminCosmetics>;
  userDeletion: ReturnType<typeof useAdminUserDeletion>;
  portfolioSync: ReturnType<typeof useAdminPortfolioSync>;
  dividends: ReturnType<typeof useAdminDividends>;
  watchlist: ReturnType<typeof useAdminWatchlist>;
  altScan: ReturnType<typeof useAltScan>;
  badges: ReturnType<typeof useAdminBadges>;
  diagnostics: ReturnType<typeof useAdminDiagnostics>;
  marketTools: ReturnType<typeof useAdminMarketTools>;
  scheduledJobs: ReturnType<typeof useAdminScheduledJobs>;
  reviewJobs: ReturnType<typeof useAdminReviewJobs>;
  stats: ReturnType<typeof useAdminStats>;
  holders: ReturnType<typeof useAdminHolders>;
  orphans: ReturnType<typeof useAdminOrphans>;
  priceMaintenance: ReturnType<typeof useAdminPriceMaintenance>;
  backupTools: ReturnType<typeof useAdminBackups>;
  predictionCreate: ReturnType<typeof useAdminPredictionCreate>;
  predictionManage: ReturnType<typeof useAdminPredictionManage>;
  bets: ReturnType<typeof useAdminBets>;
  ipo: ReturnType<typeof useAdminIpo>;
  trades: ReturnType<typeof useAdminTrades>;
  recoveryTools: ReturnType<typeof useAdminRecoveryTools>;
  discordMessages: ReturnType<typeof useAdminDiscordMessages>;
  cashLog: ReturnType<typeof useAdminCashLog>;
  siteMessages: ReturnType<typeof useAdminSiteMessages>;
}

interface Props {
  section: string;
  common: AdminCommonProps;
  showMessage: ShowMessage;
  setMessage: SetMessage;
  prices: PriceMap;
  predictions: PredictionDoc[];
  unresolvedPredictions: PredictionDoc[];
  sortedCharacters: Character[];
  halted: boolean;
  h: AdminHooks;
}

const AdminContent = ({
  section,
  common,
  showMessage,
  setMessage,
  prices,
  predictions,
  unresolvedPredictions,
  sortedCharacters,
  halted,
  h,
}: Props) => {
  switch (section) {
    case 'home':
      return <HomeDashboard predictions={predictions} halted={halted} />;
    case 'players':
      return (
        <PlayersSection
          common={common}
          prices={prices}
          showMessage={showMessage}
          userList={h.userList}
          userOps={h.userOps}
          cosmetics={h.cosmetics}
          portfolioSync={h.portfolioSync}
          userDeletion={h.userDeletion}
        />
      );
    case 'welcome':
      return <WelcomeTracker />;
    case 'money':
      return <MoneyFlow />;
    case 'discordActivity':
      return <DiscordActivity />;
    case 'guard':
      return <MarketGuard />;
    case 'bots':
      return <BotActivity />;
    case 'ipo':
      return <IpoTab {...common} {...h.ipo} setMessage={setMessage} />;
    case 'predictions':
      return (
        <PredictionsTab
          {...common}
          predictions={predictions}
          unresolvedPredictions={unresolvedPredictions}
          {...h.predictionCreate}
          {...h.predictionManage}
          {...h.bets}
          onCancelPrediction={h.predictionManage.handleCancelPrediction}
        />
      );
    case 'holders':
      return <HoldersTab {...common} prices={prices} {...h.holders} />;
    case 'trades':
      return <TradesTab {...common} {...h.trades} />;
    case 'stats':
      return <StatsTab {...common} {...h.stats} {...h.priceMaintenance} {...h.orphans} />;
    case 'recovery':
      return (
        <RecoveryTab
          {...common}
          {...h.userOps}
          {...h.backupTools}
          {...h.recoveryTools}
          showMessage={showMessage}
          renameTickerFunction={renameTickerFunction}
          tradeFilterTicker={h.trades.tradeFilterTicker}
          setTradeFilterTicker={h.trades.setTradeFilterTicker}
          sortedCharacters={sortedCharacters}
          prices={prices}
        />
      );
    case 'badges':
      return <BadgesTab {...common} {...h.badges} />;
    case 'market':
      return (
        <MarketTab
          {...common}
          prices={prices}
          {...h.marketTools}
          {...h.scheduledJobs}
          {...h.reviewJobs}
          {...h.seasonOps}
        />
      );
    case 'watchlist':
      return (
        <WatchlistTab
          {...common}
          {...h.watchlist}
          altScanning={h.altScan.scanning}
          altScanResult={h.altScan.result}
          runAltScan={h.altScan.runScan}
          markAlertReviewed={h.altScan.markReviewed}
        />
      );
    case 'diagnostic':
      return <DiagnosticTab {...common} {...h.diagnostics} />;
    case 'history':
      return (
        <div className="space-y-4">
          <AdminHistoryCard {...common} />
          <CashLogCard {...common} {...h.cashLog} />
        </div>
      );
    case 'siteMessages':
      return <SiteMessagesTab {...common} {...h.siteMessages} />;
    case 'discord':
      return <DiscordTab {...common} {...h.discordMessages} />;
    case 'dividends':
      return <DividendsTab {...common} {...h.dividends} prices={prices} />;
    default:
      return null;
  }
};

export default AdminContent;
