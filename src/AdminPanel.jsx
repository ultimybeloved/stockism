import { useState } from 'react';
import { renameTickerFunction } from './firebase';
import { CHARACTERS } from './characters';
import { ADMIN_UIDS } from './constants';
import IpoTab from './components/admin/IpoTab';
import PredictionsTab from './components/admin/PredictionsTab';
import HoldersTab from './components/admin/HoldersTab';
import UsersTab from './components/admin/UsersTab';
import BotsTab from './components/admin/BotsTab';
import TradesTab from './components/admin/TradesTab';
import StatsTab from './components/admin/StatsTab';
import RecoveryTab from './components/admin/RecoveryTab';
import BadgesTab from './components/admin/BadgesTab';
import MarketTab from './components/admin/MarketTab';
import WatchlistTab from './components/admin/WatchlistTab';
import DiagnosticTab from './components/admin/DiagnosticTab';
import DividendsTab from './components/admin/DividendsTab';
import PriceAdjustModal from './components/admin/PriceAdjustModal';
import { useAdminDividends } from './hooks/admin/useAdminDividends';
import { useAdminWatchlist } from './hooks/admin/useAdminWatchlist';
import { useAdminBadges } from './hooks/admin/useAdminBadges';
import { useAdminUserOps } from './hooks/admin/useAdminUserOps';
import { useAdminCosmetics } from './hooks/admin/useAdminCosmetics';
import { useAdminDiagnostics } from './hooks/admin/useAdminDiagnostics';
import { useAdminSpikeRepair } from './hooks/admin/useAdminSpikeRepair';
import { useAdminMarketTools } from './hooks/admin/useAdminMarketTools';
import { useAdminStats } from './hooks/admin/useAdminStats';
import { useAdminHolders } from './hooks/admin/useAdminHolders';
import { useAdminBots } from './hooks/admin/useAdminBots';
import { useAdminOrphans } from './hooks/admin/useAdminOrphans';
import { useAdminPriceMaintenance } from './hooks/admin/useAdminPriceMaintenance';
import { useAdminBackups } from './hooks/admin/useAdminBackups';
import { useAdminAccountRepair } from './hooks/admin/useAdminAccountRepair';
import { useAdminPredictionCreate } from './hooks/admin/useAdminPredictionCreate';
import { useAdminPredictionManage } from './hooks/admin/useAdminPredictionManage';
import { useAdminBets } from './hooks/admin/useAdminBets';
import { useAdminIpo } from './hooks/admin/useAdminIpo';
import { useAdminTrades } from './hooks/admin/useAdminTrades';
import { useAdminRecoveryTools } from './hooks/admin/useAdminRecoveryTools';
import { useAdminUserList } from './hooks/admin/useAdminUserList';
import { useAdminUserDeletion } from './hooks/admin/useAdminUserDeletion';
import { useAdminPortfolioSync } from './hooks/admin/useAdminPortfolioSync';

// Orchestrator only: state and handlers live in src/hooks/admin/*, one hook per
// domain, and each tab component receives its hook's return spread as props.
const AdminPanel = ({ user, predictions, prices, darkMode, marketData, onClose }) => {
  const [activeTab, setActiveTab] = useState('users');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState(null);

  const isAdmin = user && ADMIN_UIDS.includes(user.uid);

  const cardClass = darkMode ? 'bg-slate-800 border-slate-700' : 'bg-white border-slate-300';
  const textClass = darkMode ? 'text-slate-100' : 'text-slate-900';
  const mutedClass = darkMode ? 'text-slate-400' : 'text-slate-600';
  const inputClass = darkMode
    ? 'bg-slate-900 border-slate-600 text-slate-100'
    : 'bg-white border-slate-300 text-slate-900';

  const showMessage = (type, text) => {
    setMessage({ type, text });
    setTimeout(() => setMessage(null), 4000);
  };

  // Shared theme/status props consumed by every tab
  const common = { darkMode, textClass, mutedClass, inputClass, loading };

  // Domain hooks. Order matters only where one hook consumes another's state.
  const userList = useAdminUserList({ showMessage, setLoading, prices });
  const userOps = useAdminUserOps({ showMessage, setLoading, setSelectedUser: userList.setSelectedUser });
  const cosmetics = useAdminCosmetics({ showMessage, setLoading, setSelectedUser: userList.setSelectedUser });
  const userDeletion = useAdminUserDeletion({
    showMessage, setLoading, prices,
    allUsers: userList.allUsers, setAllUsers: userList.setAllUsers,
    setUserSearchResults: userList.setUserSearchResults,
  });
  const portfolioSync = useAdminPortfolioSync({
    showMessage, setLoading, prices,
    selectedUser: userList.selectedUser, setSelectedUser: userList.setSelectedUser,
    calculateLivePortfolioValue: userList.calculateLivePortfolioValue,
    handleLoadAllUsers: userList.handleLoadAllUsers,
  });
  const dividends = useAdminDividends({ showMessage });
  const watchlist = useAdminWatchlist({ showMessage, setLoading });
  const badges = useAdminBadges({ showMessage, setLoading });
  const diagnostics = useAdminDiagnostics({ setMessage });
  const spikeRepair = useAdminSpikeRepair({ showMessage });
  const marketTools = useAdminMarketTools({ setMessage, showMessage, setLoading, prices, marketData });
  const stats = useAdminStats({ showMessage, prices });
  const holders = useAdminHolders({ showMessage, prices });
  const bots = useAdminBots({ showMessage, setLoading });
  const orphans = useAdminOrphans({ showMessage, setLoading });
  const priceMaintenance = useAdminPriceMaintenance({ showMessage, setLoading });
  const backupTools = useAdminBackups({
    showMessage, setMessage, setLoading,
    handleSyncPricesToHistory: priceMaintenance.handleSyncPricesToHistory,
  });
  const accountRepair = useAdminAccountRepair({ setMessage, setLoading });
  const predictionCreate = useAdminPredictionCreate({ showMessage, setLoading });
  const predictionManage = useAdminPredictionManage({ showMessage, setLoading, getEndTime: predictionCreate.getEndTime });
  const bets = useAdminBets({ showMessage, setLoading });
  const ipo = useAdminIpo({ showMessage, setLoading });
  const trades = useAdminTrades({ showMessage });
  const recoveryTools = useAdminRecoveryTools({ showMessage, setLoading });

  // Check admin access
  if (!isAdmin) {
    return (
      <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-50" onClick={onClose}>
        <div className={`w-full max-w-md ${cardClass} border rounded-sm shadow-xl p-6 text-center`} onClick={e => e.stopPropagation()}>
          <p className="text-red-500 text-lg mb-4">🔒 Admin Access Required</p>
          <p className={mutedClass}>Your UID: <code className="text-xs bg-slate-700 px-2 py-1 rounded">{user?.uid || 'Not logged in'}</code></p>
          <p className={`text-xs ${mutedClass} mt-2`}>Add this UID to ADMIN_UIDS in AdminPanel.jsx</p>
          <button onClick={onClose} className="mt-4 px-4 py-2 bg-slate-600 text-white rounded-sm">Close</button>
        </div>
      </div>
    );
  }

  const unresolvedPredictions = predictions.filter(p => !p.resolved && !p.cancelled);

  // Sort characters by name for the dropdown
  const sortedCharacters = [...CHARACTERS].sort((a, b) => a.name.localeCompare(b.name));

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-50" onClick={onClose}>
      <div className={`w-full max-w-3xl ${cardClass} border rounded-sm shadow-xl overflow-hidden max-h-[90vh] flex flex-col`}
        onClick={e => e.stopPropagation()}>

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
              <button onClick={onClose} className={`p-2 ${mutedClass} hover:text-teal-600 text-xl`}>×</button>
            </div>
          </div>
        </div>

        {/* Tabs — uniform pills, wrap as needed */}
        <div className={`px-3 py-2.5 border-b ${darkMode ? 'border-slate-700' : 'border-slate-200'}`}>
          <div className="flex flex-wrap gap-1.5">
            {[
              { id: 'users', icon: '👥', label: 'Users' },
              { id: 'trades', icon: '💹', label: 'Trades', load: () => trades.loadRecentTrades(trades.tradeTimePeriod, trades.tradeTypeFilter, trades.tradeFilterTicker, trades.tradeBotFilter) },
              { id: 'holders', icon: '📊', label: 'Holders' },
              { id: 'market', icon: '🏛️', label: 'Market' },
              { id: 'stats', icon: '📈', label: 'Stats', load: stats.loadMarketStats },
              { id: 'ipo', icon: '🚀', label: 'IPO', load: ipo.loadIPOs },
              { id: 'predictions', icon: '🎲', label: 'Bets', badge: unresolvedPredictions.length, load: bets.loadAllBets },
              { id: 'dividends', icon: '💵', label: 'Dividends', load: dividends.loadDividendConfig },
              { id: 'bots', icon: '🤖', label: 'Bots', load: bots.handleLoadBots },
              { id: 'badges', icon: '🏅', label: 'Badges', load: badges.loadBadgeUsers },
              { id: 'watchlist', icon: '👁️', label: 'Watchlist', load: () => { if (!watchlist.watchlistLoaded) watchlist.loadWatchlist(); } },
              { id: 'diagnostic', icon: '🔍', label: 'Diagnostics' },
              { id: 'recovery', icon: '🔧', label: 'Recovery' },
            ].map(tab => (
              <button
                key={tab.id}
                onClick={() => { setActiveTab(tab.id); if (tab.load) tab.load(); }}
                className={`px-3 py-1.5 text-xs font-semibold rounded-full transition-colors ${
                  activeTab === tab.id
                    ? 'bg-teal-600 text-white'
                    : `${mutedClass} ${darkMode ? 'bg-slate-800 hover:bg-slate-700' : 'bg-slate-100 hover:bg-slate-200'}`
                }`}
              >
                {tab.icon} {tab.label}{tab.badge > 0 ? ` (${tab.badge})` : ''}
              </button>
            ))}
          </div>
        </div>

        {/* Message */}
        {message && (
          <div className={`mx-4 mt-4 p-3 rounded-sm text-sm font-semibold ${
            message.type === 'error' ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'
          }`}>
            {message.text}
          </div>
        )}

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4">

          {/* IPO TAB */}
          {activeTab === 'ipo' && (
            <IpoTab {...common} {...ipo} setMessage={setMessage} />
          )}
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
          {activeTab === 'holders' && (
            <HoldersTab {...common} prices={prices} {...holders} />
          )}

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
          {activeTab === 'bots' && (
            <BotsTab {...common} prices={prices} {...bots} />
          )}

                    {/* TRADES TAB */}
          {activeTab === 'trades' && (
            <TradesTab {...common} {...trades} />
          )}

                    {/* STATS TAB */}
          {activeTab === 'stats' && (
            <StatsTab {...common} {...stats} {...priceMaintenance} {...orphans} />
          )}

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
        </div>
      </div>

      {/* Price Adjustment Modal */}
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

      {/* BADGES TAB */}
      {activeTab === 'badges' && (
        <BadgesTab {...common} {...badges} />
      )}

            {/* MARKET TAB */}
      {activeTab === 'market' && (
        <MarketTab {...common} setLoading={setLoading} setMessage={setMessage} user={user} prices={prices} {...marketTools} />
      )}

            {/* WATCHLIST TAB */}
      {activeTab === 'watchlist' && (
        <WatchlistTab {...common} {...watchlist} />
      )}

            {/* DIAGNOSTIC TAB */}
      {activeTab === 'diagnostic' && (
        <DiagnosticTab {...common} {...diagnostics} />
      )}

            {activeTab === 'dividends' && (
        <DividendsTab {...common} {...dividends} />
      )}

        </div>
  );
};

export default AdminPanel;
