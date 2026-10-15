import { useMemo, useState } from 'react';
import { CHARACTERS } from '../../../characters';
import { ADMIN_UIDS } from '../../../constants';
import { isWeeklyHalt } from '../../../utils/marketHours';
import AdminSidebar from './shell/AdminSidebar';
import AdminTopBar from './shell/AdminTopBar';
import AdminContent from './AdminContent';
import PriceAdjustModal from './PriceAdjustModal';
import { AdminNavContext } from '../utils/adminNav';
import { useAdminDividends } from '../hooks/useAdminDividends';
import { useAdminWatchlist } from '../hooks/useAdminWatchlist';
import { useAltScan } from '../hooks/useAltScan';
import { useAdminBadges } from '../hooks/useAdminBadges';
import { useAdminUserOps } from '../hooks/useAdminUserOps';
import { useAdminSeason } from '../hooks/useAdminSeason';
import { useAdminCosmetics } from '../hooks/useAdminCosmetics';
import { useAdminDiagnostics } from '../hooks/useAdminDiagnostics';
import { useAdminMarketTools } from '../hooks/useAdminMarketTools';
import { useAdminScheduledJobs } from '../hooks/useAdminScheduledJobs';
import { useAdminReviewJobs } from '../hooks/useAdminReviewJobs';
import { useAdminStats } from '../hooks/useAdminStats';
import { useAdminHolders } from '../hooks/useAdminHolders';
import { useAdminOrphans } from '../hooks/useAdminOrphans';
import { useAdminPriceMaintenance } from '../hooks/useAdminPriceMaintenance';
import { useAdminBackups } from '../hooks/useAdminBackups';
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
import type { AdminSection, AdminSectionGroup } from './shell/AdminSidebar';
import type { User } from 'firebase/auth';
import type { MarketData } from '../../../context/AppContext';
import type { PredictionDoc, PriceMap } from '../../../types';
import { useModalFocus } from '../../../shared/hooks/useModalFocus';
import '../../../styles/adminTerminal.css';

interface AdminPanelProps {
  user: User | null;
  predictions: PredictionDoc[];
  prices: PriceMap;
  marketData: MarketData | null;
  onClose: () => void;
}

// The admin command panel: full screen, desktop only, terminal look. A menu on
// the left picks the section; every section's state lives in its own hook in
// src/features/admin/hooks/*, and AdminContent draws the active one.
const AdminPanel = ({ user, predictions, prices, marketData, onClose }: AdminPanelProps) => {
  const [section, setSection] = useState('home');
  const dialogRef = useModalFocus();
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ type: string; text: string } | null>(null);

  const isAdmin = user && ADMIN_UIDS.includes(user.uid);

  // The older tabs still take these; adminTerminal.css repaints them.
  const textClass = 'light:text-slate-900 dark:text-slate-100';
  const mutedClass = 'light:text-slate-600 dark:text-slate-400';
  const inputClass =
    'light:bg-white light:border-slate-300 light:text-slate-900 dark:bg-slate-900 dark:border-slate-600 dark:text-slate-100';
  const cardClass = 'light:bg-white light:border-slate-300 dark:bg-slate-800 dark:border-slate-700';

  const showMessage = (type: string, text: string) => {
    setMessage({ type, text });
    setTimeout(() => setMessage(null), 5000);
  };
  const common = { textClass, mutedClass, inputClass, loading };

  // Domain hooks. Order matters only where one hook consumes another's state.
  const userList = useAdminUserList({ showMessage, setLoading, prices });
  const userOps = useAdminUserOps({ showMessage, setLoading, setSelectedUser: userList.setSelectedUser });
  const seasonOps = useAdminSeason({ showMessage, setLoading });
  const cosmetics = useAdminCosmetics({ showMessage, setLoading, setSelectedUser: userList.setSelectedUser });
  const userDeletion = useAdminUserDeletion({ showMessage, setLoading, prices, setAllUsers: userList.setAllUsers });
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
  const marketTools = useAdminMarketTools({ setMessage, showMessage, setLoading, prices, marketData });
  const scheduledJobs = useAdminScheduledJobs({ showMessage, setLoading });
  const reviewJobs = useAdminReviewJobs({ showMessage, setLoading });
  const stats = useAdminStats({ showMessage, prices });
  const holders = useAdminHolders({ showMessage, prices });
  const orphans = useAdminOrphans({ showMessage, setLoading });
  const priceMaintenance = useAdminPriceMaintenance({ showMessage, setLoading });
  const backupTools = useAdminBackups({
    showMessage,
    setMessage,
    setLoading,
    handleSyncPricesToHistory: priceMaintenance.handleSyncPricesToHistory,
  });
  const predictionCreate = useAdminPredictionCreate({ showMessage, setLoading });
  const predictionManage = useAdminPredictionManage({
    showMessage,
    setLoading,
    getEndTime: predictionCreate.getEndTime,
  });
  const bets = useAdminBets({ showMessage });
  const ipo = useAdminIpo({ showMessage, setLoading });
  const trades = useAdminTrades({ showMessage });
  const recoveryTools = useAdminRecoveryTools();
  const discordMessages = useAdminDiscordMessages({ showMessage });
  const cashLog = useAdminCashLog({ showMessage });
  const siteMessages = useAdminSiteMessages({ showMessage });

  const unresolvedPredictions = predictions.filter((p) => !p.resolved && !p.cancelled);
  const sortedCharacters = useMemo(() => [...CHARACTERS].sort((a, b) => a.name.localeCompare(b.name)), []);
  const halted = !!marketData?.marketHalted || isWeeklyHalt();

  const groups: AdminSectionGroup[] = [
    { label: 'Overview', items: [{ id: 'home', label: 'Home' }] },
    {
      label: 'Players',
      items: [
        { id: 'players', label: 'Players', load: () => userList.selectUser(null) },
        { id: 'welcome', label: 'Welcome week' },
        {
          id: 'watchlist',
          label: 'Watchlist',
          load: () => {
            if (!watchlist.watchlistLoaded) watchlist.loadWatchlist();
          },
        },
        { id: 'guard', label: 'Market guard' },
        { id: 'badges', label: 'Badges', load: badges.loadBadgeUsers },
      ],
    },
    {
      label: 'Money',
      items: [
        { id: 'money', label: 'Money flow' },
        { id: 'dividends', label: 'Dividends', load: dividends.loadDividendConfig },
        {
          id: 'history',
          label: 'Admin history',
          load: () => {
            if (!cashLog.cashLogLoaded) cashLog.loadCashLog();
          },
        },
      ],
    },
    {
      label: 'Market',
      items: [
        { id: 'market', label: 'Market controls' },
        {
          id: 'trades',
          label: 'Trades',
          load: () =>
            trades.loadRecentTrades(
              trades.tradeTimePeriod,
              trades.tradeTypeFilter,
              trades.tradeFilterTicker,
              trades.tradeBotFilter,
            ),
        },
        { id: 'holders', label: 'Holders' },
        { id: 'stats', label: 'Stats', load: stats.loadMarketStats },
        { id: 'ipo', label: 'IPOs', load: ipo.loadIPOs },
        { id: 'predictions', label: 'Bets and markets', badge: unresolvedPredictions.length, load: bets.loadAllBets },
      ],
    },
    {
      label: 'Community',
      items: [
        { id: 'discordActivity', label: 'Discord activity' },
        {
          id: 'discord',
          label: 'Bot messages',
          load: () => {
            if (!discordMessages.discordLoaded) discordMessages.loadDiscordMessages();
          },
        },
        {
          id: 'siteMessages',
          label: 'Site messages',
          load: () => {
            if (!siteMessages.siteMessagesLoaded) siteMessages.loadSiteMessages();
          },
        },
      ],
    },
    {
      label: 'Tools',
      items: [
        { id: 'diagnostic', label: 'Drop audit' },
        { id: 'recovery', label: 'Recovery' },
      ],
    },
  ];
  const allSections = groups.flatMap((g) => g.items);

  const select = (item: AdminSection) => {
    setSection(item.id);
    item.load?.();
  };

  const nav = {
    openPlayer: (uid: string) => {
      setSection('players');
      void userList.selectUser(uid);
    },
    goTo: (id: string) => {
      const item = allSections.find((s) => s.id === id);
      if (item) select(item);
    },
    nameOf: (uid: string) => userList.allUsers.find((u) => u.id === uid)?.displayName || null,
  };

  if (!isAdmin) {
    return (
      <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-50" onClick={onClose}>
        <div
          className={`w-full max-w-md ${cardClass} border rounded-sm shadow-xl p-6 text-center`}
          onClick={(e) => e.stopPropagation()}
        >
          <p className="text-red-500 text-lg mb-4">Admin access required</p>
          <p className={mutedClass}>
            Your UID: <code className="text-xs bg-slate-700 px-2 py-1 rounded">{user?.uid || 'Not logged in'}</code>
          </p>
          <button onClick={onClose} className="mt-4 px-4 py-2 bg-slate-600 text-white rounded-sm">
            Close
          </button>
        </div>
      </div>
    );
  }

  return (
    <AdminNavContext.Provider value={nav}>
      {/* Full screen on purpose: the panel is only used on desktop. `dark` forces
          every themed class to its dark form whatever the site theme is. */}
      <div
        ref={dialogRef}
        role="dialog"
        aria-label="Admin panel"
        className="dark admin-terminal fixed inset-0 z-50 flex flex-col"
      >
        <AdminTopBar
          halted={halted}
          allUsers={userList.allUsers}
          usersLoading={loading && userList.allUsers.length === 0}
          ensureUsers={() => {
            if (!userList.loadedAt && !loading) userList.handleLoadAllUsers();
          }}
          onAdjustPrices={() => marketTools.setShowPriceModal(true)}
          onClose={onClose}
        />
        <div className="flex flex-1 min-h-0">
          <AdminSidebar groups={groups} active={section} onSelect={select} />
          <main className="flex-1 overflow-y-auto p-4">
            <AdminContent
              section={section}
              common={common}
              showMessage={showMessage}
              setMessage={setMessage}
              prices={prices}
              predictions={predictions}
              unresolvedPredictions={unresolvedPredictions}
              sortedCharacters={sortedCharacters}
              halted={halted}
              h={{
                userList,
                userOps,
                seasonOps,
                cosmetics,
                userDeletion,
                portfolioSync,
                dividends,
                watchlist,
                altScan,
                badges,
                diagnostics,
                marketTools,
                scheduledJobs,
                reviewJobs,
                stats,
                holders,
                orphans,
                priceMaintenance,
                backupTools,
                predictionCreate,
                predictionManage,
                bets,
                ipo,
                trades,
                recoveryTools,
                discordMessages,
                cashLog,
                siteMessages,
              }}
            />
          </main>
        </div>

        {message && (
          <div
            role="status"
            className={`fixed top-14 right-4 z-[60] max-w-md px-4 py-2.5 border t-mono text-sm shadow-xl ${
              message.type === 'error'
                ? 'bg-[#2a1111] border-[var(--t-red)] text-[var(--t-red)]'
                : 'bg-[#0f2418] border-[var(--t-green)] text-[var(--t-green)]'
            }`}
          >
            {message.text}
          </div>
        )}

        {marketTools.showPriceModal && (
          <PriceAdjustModal
            cardClass={cardClass}
            textClass={textClass}
            mutedClass={mutedClass}
            prices={prices}
            loading={loading}
            {...marketTools}
          />
        )}
      </div>
    </AdminNavContext.Provider>
  );
};

export default AdminPanel;
