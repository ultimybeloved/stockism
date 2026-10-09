import { useState } from 'react';
import { renameTickerFunction } from '../../../api/callables';
import { CHARACTERS } from '../../../characters';
import { ADMIN_UIDS } from '../../../constants';
import IpoTab from './IpoTab';
import PredictionsTab from './PredictionsTab';
import HoldersTab from './HoldersTab';
import UsersTab from './UsersTab';
import BotsTab from './BotsTab';
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
import SiteMessagesTab from './SiteMessagesTab';
import PriceAdjustModal from './PriceAdjustModal';
import { useAdminDividends } from '../hooks/useAdminDividends';
import { useAdminWatchlist } from '../hooks/useAdminWatchlist';
import { useAltScan } from '../hooks/useAltScan';
import { useAdminBadges } from '../hooks/useAdminBadges';
import { useAdminUserOps } from '../hooks/useAdminUserOps';
import { useAdminSeason } from '../hooks/useAdminSeason';
import { useAdminCosmetics } from '../hooks/useAdminCosmetics';
import { useAdminDiagnostics } from '../hooks/useAdminDiagnostics';
import { useAdminSpikeRepair } from '../hooks/useAdminSpikeRepair';
import { useAdminMarketTools } from '../hooks/useAdminMarketTools';
import { useAdminScheduledJobs } from '../hooks/useAdminScheduledJobs';
import { useAdminReviewJobs } from '../hooks/useAdminReviewJobs';
import { useAdminStats } from '../hooks/useAdminStats';
import { useAdminHolders } from '../hooks/useAdminHolders';
import { useAdminBots } from '../hooks/useAdminBots';
import { useAdminOrphans } from '../hooks/useAdminOrphans';
import { useAdminPriceMaintenance } from '../hooks/useAdminPriceMaintenance';
import { useAdminBackups } from '../hooks/useAdminBackups';
import { useAdminAccountRepair } from '../hooks/useAdminAccountRepair';
import { useAdminPredictionCreate } from '../hooks/useAdminPredictionCreate';
import { useAdminPredictionManage } from '../hooks/useAdminPredictionManage';
import { useAdminBets } from '../hooks/useAdminBets';
import { useAdminIpo } from '../hooks/useAdminIpo';
import { useAdminTrades } from '../hooks/useAdminTrades';
import { useAdminRecoveryTools } from '../hooks/useAdminRecoveryTools';
import { useAdminUserList } from '../hooks/useAdminUserList';
import { useAdminUserDeletion } from '../hooks/useAdminUserDeletion';
import { useAdminPortfolioSync } from '../hooks/useAdminPortfolioSync';
import { useAdminDiscordMessages } from '../hooks/useAdminDiscordMessages';
import { useAdminCashLog } from '../hooks/useAdminCashLog';
import { useAdminSiteMessages } from '../hooks/useAdminSiteMessages';
import type { User } from 'firebase/auth';
import type { MarketData } from '../../../context/AppContext';
import type { PredictionDoc, PriceMap } from '../../../types';

interface AdminPanelProps {
  user: User | null;
  predictions: PredictionDoc[];
  prices: PriceMap;
  darkMode: boolean;
  marketData: MarketData | null;
  onClose: () => void;
}

// Orchestrator only: state and handlers live in src/features/admin/hooks/*, one hook per
// domain, and each tab component receives its hook's return spread as props.
const AdminPanel = ({ user, predictions, prices, darkMode, marketData, onClose }: AdminPanelProps) => {
  const [activeTab, setActiveTab] = useState('users');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ type: string; text: string } | null>(null);

  const isAdmin = user && ADMIN_UIDS.includes(user.uid);

  const cardClass = darkMode ? 'bg-slate-800 border-slate-700' : 'bg-white border-slate-300';
  const textClass = darkMode ? 'text-slate-100' : 'text-slate-900';
  const mutedClass = darkMode ? 'text-slate-400' : 'text-slate-600';
  const inputClass = darkMode
    ? 'bg-slate-900 border-slate-600 text-slate-100'
    : 'bg-white border-slate-300 text-slate-900';

  const showMessage = (type: string, text: string) => {
    setMessage({ type, text });
    setTimeout(() => setMessage(null), 4000);
  };

  // Shared theme/status props consumed by every tab
  const common = { darkMode, textClass, mutedClass, inputClass, loading };

  // Domain hooks. Order matters only where one hook consumes another's state.
  const userList = useAdminUserList({ showMessage, setLoading, prices });
  const userOps = useAdminUserOps({ showMessage, setLoading, setSelectedUser: userList.setSelectedUser });
  const seasonOps = useAdminSeason({ showMessage, setLoading });
  const cosmetics = useAdminCosmetics({ showMessage, setLoading, setSelectedUser: userList.setSelectedUser });
  const userDeletion = useAdminUserDeletion({
    showMessage,
    setLoading,
    prices,
    allUsers: userList.allUsers,
    setAllUsers: userList.setAllUsers,
    setUserSearchResults: userList.setUserSearchResults,
  });
  const portfolioSync = useAdminPortfolioSync({
    showMessage,
    setLoading,
    prices,
    selectedUser: userList.selectedUser,
    setSelectedUser: userList.setSelectedUser,
    calculateLivePortfolioValue: userList.calculateLivePortfolioValue,
    handleLoadAllUsers: userList.handleLoadAllUsers,
  });
  const dividends = useAdminDividends({ showMessage });
  const watchlist = useAdminWatchlist({ showMessage, setLoading });
  const altScan = useAltScan(showMessage, watchlist.loadWatchlist);
  const badges = useAdminBadges({ showMessage, setLoading });
  const diagnostics = useAdminDiagnostics({ setMessage });
  const spikeRepair = useAdminSpikeRepair({ showMessage });
  const marketTools = useAdminMarketTools({ setMessage, showMessage, setLoading, prices, marketData });
  const scheduledJobs = useAdminScheduledJobs({ showMessage, setLoading });
  const reviewJobs = useAdminReviewJobs({ showMessage, setLoading });
  const stats = useAdminStats({ showMessage, prices });
  const holders = useAdminHolders({ showMessage, prices });
  const bots = useAdminBots({ showMessage, setLoading });
  const orphans = useAdminOrphans({ showMessage, setLoading });
  const priceMaintenance = useAdminPriceMaintenance({ showMessage, setLoading });
  const backupTools = useAdminBackups({
    showMessage,
    setMessage,
    setLoading,
    handleSyncPricesToHistory: priceMaintenance.handleSyncPricesToHistory,
  });
  const accountRepair = useAdminAccountRepair({ setMessage, setLoading });
  const predictionCreate = useAdminPredictionCreate({ showMessage, setLoading });
  const predictionManage = useAdminPredictionManage({
    showMessage,
    setLoading,
    getEndTime: predictionCreate.getEndTime,
  });
  const bets = useAdminBets({ showMessage, setLoading });
  const ipo = useAdminIpo({ showMessage, setLoading });
  const trades = useAdminTrades({ showMessage });
  const recoveryTools = useAdminRecoveryTools({ showMessage, setLoading });
  const discordMessages = useAdminDiscordMessages({ showMessage });
  const cashLog = useAdminCashLog({ showMessage });
  const siteMessages = useAdminSiteMessages({ showMessage });

  // Check admin access
  if (!isAdmin) {
    return (
      <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-50" onClick={onClose}>
        <div
          className={`w-full max-w-md ${cardClass} border rounded-sm shadow-xl p-6 text-center`}
          onClick={(e) => e.stopPropagation()}
        >
          <p className="text-red-500 text-lg mb-4">🔒 Admin Access Required</p>
          <p className={mutedClass}>
            Your UID: <code className="text-xs bg-slate-700 px-2 py-1 rounded">{user?.uid || 'Not logged in'}</code>
          </p>
          <p className={`text-xs ${mutedClass} mt-2`}>Add this UID to ADMIN_UIDS in AdminPanel.jsx</p>
          <button onClick={onClose} className="mt-4 px-4 py-2 bg-slate-600 text-white rounded-sm">
            Close
          </button>
        </div>
      </div>
    );
  }

  const unresolvedPredictions = predictions.filter((p) => !p.resolved && !p.cancelled);

  // Sort characters by name for the dropdown
  const sortedCharacters = [...CHARACTERS].sort((a, b) => a.name.localeCompare(b.name));

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-50" onClick={onClose}>
      {/* 13 tabs of dense controls do not fit in 3xl — the pills wrapped and every
          panel was squeezed into a tall thin column. */}
      <div
        className={`w-full max-w-6xl ${cardClass} border rounded-sm shadow-xl overflow-hidden max-h-[92vh] flex flex-col`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className={`p-4 border-b ${darkMode ? 'border-slate-700' : 'border-slate-200'}`}>
          <div className="flex justify-between items-center">
            <h2 className={`text-lg font-semibold ${textClass}`}>🔧 Admin Panel</h2>
            <div className="flex gap-2">
              <button
                onClick={() => marketTools.setShowPriceModal(true)}
                className="px-3 py-1.5 bg-teal-600 hover:bg-teal-700 text-white text-sm font-semibold rounded-sm"
              >
                💰 Adjust Prices
              </button>
              <button onClick={onClose} className={`p-2 ${mutedClass} hover:text-teal-600 text-xl`}>
                ×
              </button>
            </div>
          </div>
        </div>

        {/* Tabs — uniform pills, wrap as needed */}
        <div className={`px-3 py-2.5 border-b ${darkMode ? 'border-slate-700' : 'border-slate-200'}`}>
          <div className="flex flex-wrap gap-1.5">
            {[
              { id: 'users', icon: '👥', label: 'Users' },
              {
                id: 'trades',
                icon: '💹',
                label: 'Trades',
                load: () =>
                  trades.loadRecentTrades(
                    trades.tradeTimePeriod,
                    trades.tradeTypeFilter,
                    trades.tradeFilterTicker,
                    trades.tradeBotFilter,
                  ),
              },
              { id: 'holders', icon: '📊', label: 'Holders' },
              { id: 'market', icon: '🏛️', label: 'Market' },
              { id: 'stats', icon: '📈', label: 'Stats', load: stats.loadMarketStats },
              { id: 'ipo', icon: '🚀', label: 'IPO', load: ipo.loadIPOs },
              {
                id: 'predictions',
                icon: '🎲',
                label: 'Bets',
                badge: unresolvedPredictions.length,
                load: bets.loadAllBets,
              },
              { id: 'dividends', icon: '💵', label: 'Dividends', load: dividends.loadDividendConfig },
              { id: 'bots', icon: '🤖', label: 'Bots', load: bots.handleLoadBots },
              { id: 'badges', icon: '🏅', label: 'Badges', load: badges.loadBadgeUsers },
              {
                id: 'watchlist',
                icon: '👁️',
                label: 'Watchlist',
                load: () => {
                  if (!watchlist.watchlistLoaded) watchlist.loadWatchlist();
                },
              },
              {
                id: 'giveaways',
                icon: '💸',
                label: 'Giveaways',
                load: () => {
                  if (!cashLog.cashLogLoaded) cashLog.loadCashLog();
                },
              },
              {
                id: 'siteMessages',
                icon: '📣',
                label: 'Site Msgs',
                load: () => {
                  if (!siteMessages.siteMessagesLoaded) siteMessages.loadSiteMessages();
                },
              },
              {
                id: 'discord',
                icon: '💬',
                label: 'Discord',
                load: () => {
                  if (!discordMessages.discordLoaded) discordMessages.loadDiscordMessages();
                },
              },
              { id: 'diagnostic', icon: '🔍', label: 'Diagnostics' },
              { id: 'recovery', icon: '🔧', label: 'Recovery' },
            ].map((tab) => (
              <button
                key={tab.id}
                onClick={() => {
                  setActiveTab(tab.id);
                  if (tab.load) tab.load();
                }}
                className={`px-3 py-1.5 text-xs font-semibold rounded-full transition-colors ${
                  activeTab === tab.id
                    ? 'bg-teal-600 text-white'
                    : `${mutedClass} ${darkMode ? 'bg-slate-800 hover:bg-slate-700' : 'bg-slate-100 hover:bg-slate-200'}`
                }`}
              >
                {tab.icon} {tab.label}
                {(tab.badge ?? 0) > 0 ? ` (${tab.badge})` : ''}
              </button>
            ))}
          </div>
        </div>

        {/* Message */}
        {message && (
          <div
            className={`mx-4 mt-4 p-3 rounded-sm text-sm font-semibold ${
              message.type === 'error' ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'
            }`}
          >
            {message.text}
          </div>
        )}

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4">
          {/* IPO TAB */}
          {activeTab === 'ipo' && <IpoTab {...common} {...ipo} setMessage={setMessage} />}
          {/* PREDICTIONS TAB (Consolidated: Create + Resolve + View All + Bets) */}
          {activeTab === 'predictions' && (
            <PredictionsTab
              {...common}
              predictions={predictions}
              unresolvedPredictions={unresolvedPredictions}
              {...predictionCreate}
              {...predictionManage}
              {...bets}
              onCancelPrediction={predictionManage.handleCancelPrediction}
            />
          )}

          {/* HOLDERS TAB */}
          {activeTab === 'holders' && <HoldersTab {...common} prices={prices} {...holders} />}

          {/* USERS TAB */}
          {activeTab === 'users' && (
            <UsersTab
              {...common}
              prices={prices}
              {...userList}
              {...userOps}
              {...cosmetics}
              {...userDeletion}
              {...portfolioSync}
            />
          )}

          {/* BOTS TAB */}
          {activeTab === 'bots' && <BotsTab {...common} prices={prices} {...bots} />}

          {/* TRADES TAB */}
          {activeTab === 'trades' && <TradesTab {...common} {...trades} />}

          {/* STATS TAB */}
          {activeTab === 'stats' && <StatsTab {...common} {...stats} {...priceMaintenance} {...orphans} />}

          {/* RECOVERY TAB */}
          {activeTab === 'recovery' && (
            <RecoveryTab
              {...common}
              {...userOps}
              {...spikeRepair}
              {...backupTools}
              {...accountRepair}
              {...recoveryTools}
              showMessage={showMessage}
              renameTickerFunction={renameTickerFunction}
              tradeFilterTicker={trades.tradeFilterTicker}
              setTradeFilterTicker={trades.setTradeFilterTicker}
              sortedCharacters={sortedCharacters}
              prices={prices}
            />
          )}

          {/* BADGES TAB */}
          {activeTab === 'badges' && <BadgesTab {...common} {...badges} />}

          {/* MARKET TAB */}
          {activeTab === 'market' && (
            <MarketTab {...common} prices={prices} {...marketTools} {...scheduledJobs} {...reviewJobs} {...seasonOps} />
          )}

          {/* WATCHLIST TAB */}
          {activeTab === 'watchlist' && (
            <WatchlistTab
              {...common}
              {...watchlist}
              altScanning={altScan.scanning}
              altScanResult={altScan.result}
              runAltScan={altScan.runScan}
              markAlertReviewed={altScan.markReviewed}
            />
          )}

          {/* DIAGNOSTIC TAB */}
          {activeTab === 'diagnostic' && <DiagnosticTab {...common} {...diagnostics} />}

          {/* GIVEAWAYS TAB */}
          {activeTab === 'giveaways' && <CashLogCard {...common} {...cashLog} />}

          {activeTab === 'siteMessages' && <SiteMessagesTab {...common} {...siteMessages} />}

          {/* DISCORD TAB */}
          {activeTab === 'discord' && <DiscordTab {...common} {...discordMessages} />}

          {/* DIVIDENDS TAB */}
          {activeTab === 'dividends' && <DividendsTab {...common} {...dividends} prices={prices} />}
        </div>
      </div>

      {/* Price Adjustment Modal — a sibling of the card on purpose, it is its
          own overlay. Everything above must stay INSIDE the card: these five
          tabs used to sit out here, which made them lay out beside the panel in
          the centred overlay and let their clicks reach the close handler. */}
      {marketTools.showPriceModal && (
        <PriceAdjustModal
          darkMode={darkMode}
          cardClass={cardClass}
          textClass={textClass}
          mutedClass={mutedClass}
          prices={prices}
          loading={loading}
          {...marketTools}
        />
      )}
    </div>
  );
};

export default AdminPanel;
