import { httpsCallable } from 'firebase/functions';
import { functions } from '../firebase';
import type * as Api from './types';
import type * as Panel from './adminPanelTypes';

// Every Cloud Function the site calls, typed as callable<Request, Response>('name').
// The shapes live in src/api/types.ts. Errors are classified by src/utils/errors.ts
// (errorMessage, isContentionError, isCapacityError, isExpectedRejection), so every
// caller reacts to the same failure the same way.
//
// The string is the deployed function's name. Never change it: renaming a deployed
// function deletes and recreates it.
const callable = <Req = unknown, Res = unknown>(name: string) => httpsCallable<Req, Res>(functions, name);

export const createUserFunction = callable<{ displayName: string }, { success: boolean }>('createUser');
export const checkUsernameFunction = callable<{ displayName: string }, { available: boolean }>('checkUsername');
export const deleteAccountFunction = callable<{ confirmUsername: string }>('deleteAccount');
export const changeDisplayNameFunction = callable<{ displayName: string }, { success: boolean }>('changeDisplayName');
export const purchaseCosmeticFunction = callable<{ cosmeticId: string }>('purchaseCosmetic');
export const giftCosmeticFunction = callable<
  { cosmeticId?: string; bundleId?: string; recipient: string },
  { success: boolean; price: number; recipientName: string }
>('giftCosmetic');
export const purchaseBundleFunction = callable<
  { bundleId: string },
  { success: boolean; price: number; items: string[] }
>('purchaseBundle');
export const fixBasePriceCliffsFunction = callable<Record<string, never>, Api.FixCliffsResponse>('fixBasePriceCliffs');
export const triggerManualBackupFunction = callable<void, { filename?: string }>('triggerManualBackup');
export const listBackupsFunction = callable<void, { backups?: Api.BackupFile[]; total?: number }>('listBackups');
export const restoreBackupFunction = callable<{ backupName: string }, { tickersRestored?: number }>('restoreBackup');
export const broadcastNotificationFunction = callable<
  { title: string; message: string; predictionId?: string },
  { sent?: number }
>('broadcastNotification');
// Trade execution & anti-exploit
export const executeTradeFunction = callable<Api.ExecuteTradeRequest, Api.ExecuteTradeResponse>('executeTrade');
export const sweepDustPositionsFunction = callable<{ side: 'short' } | void, Api.SweepDustResponse>(
  'sweepDustPositions',
);
export const banUserFunction = callable<{ userId: string; reason: string }>('banUser');
// Daily checkin
export const dailyCheckinFunction = callable<Record<string, never>, Api.DailyCheckinResponse>('dailyCheckin');
// Ladder game
export const playLadderGameFunction = callable<Api.PlayLadderRequest, Api.PlayLadderResponse>('playLadderGame');
export const depositToLadderGameFunction = callable<{ amount: number }>('depositToLadderGame');
export const withdrawFromLadderGameFunction = callable<{ amount: number }, Api.LadderWithdrawResponse>(
  'withdrawFromLadderGame',
);
export const getLadderLeaderboardFunction = callable<{ board: Api.LadderBoard }, Api.LadderLeaderboardResponse>(
  'getLadderLeaderboard',
);
export const triggerDailyMarketSummaryFunction = callable<Record<string, never>, Api.JobResult>(
  'triggerDailyMarketSummary',
);
export const triggerReviewChangesFunction = callable<Record<string, never>, { tickerCount?: number }>(
  'triggerReviewChanges',
);
export const triggerDailyFreeStockFunction = callable<Record<string, never>, Api.JobResult>('triggerDailyFreeStock');
// Leaderboard
export const getLeaderboardFunction = callable<Api.GetLeaderboardRequest, Api.GetLeaderboardResponse>('getLeaderboard');
export const getPublicProfileFunction = callable<{ username: string | undefined }, Api.PublicProfile>(
  'getPublicProfile',
);
export const setTrophyCaseFunction = callable<{ trophies: string[] }, { trophyCase: string[] }>('setTrophyCase');
export const searchPlayersFunction = callable<{ query: string }, { players: Api.PlayerSearchResult[] }>(
  'searchPlayers',
);
// Discord alert functions
export const achievementAlertFunction = callable<Api.AchievementAlertRequest>('achievementAlert');
export const ipoAnnouncementAlertFunction = callable<Api.IpoAnnouncementRequest>('ipoAnnouncementAlert');
// Data archiving functions
export const archivePriceHistoryFunction = callable<
  Record<string, never>,
  Api.JobResult & { archivedTickers?: number }
>('archivePriceHistory');
// Secure operations
export const claimMissionRewardFunction = callable<Api.ClaimMissionRewardRequest, Api.ClaimMissionRewardResponse>(
  'claimMissionReward',
);
export const rerollMissionsFunction = callable<void, Api.RerollMissionsResponse>('rerollMissions');
export const purchasePinFunction = callable<Api.PurchasePinRequest>('purchasePin');
export const placeBetFunction = callable<Api.PlaceBetRequest>('placeBet');
export const claimPredictionPayoutFunction = callable<
  Api.ClaimPredictionPayoutRequest,
  Api.ClaimPredictionPayoutResponse
>('claimPredictionPayout');
export const createLimitOrderFunction = callable<Api.CreateLimitOrderRequest, Api.CreateLimitOrderResponse>(
  'createLimitOrder',
);
export const createPreMarketOrderFunction = callable<Api.CreatePreMarketOrderRequest, { success: boolean }>(
  'createPreMarketOrder',
);
export const cancelPreMarketOrderFunction = callable<{ orderId: string }, { success: boolean }>('cancelPreMarketOrder');
export const buyIPOSharesFunction = callable<Api.BuyIPOSharesRequest>('buyIPOShares');
// Event prediction markets (long-term, AMM-priced)
export const buyEventSharesFunction = callable<Api.EventSharesRequest, Api.EventSharesResponse>('buyEventShares');
export const sellEventSharesFunction = callable<Api.EventSharesRequest, Api.EventSharesResponse>('sellEventShares');
export const triggerEventSettlementsFunction = callable<void>('triggerEventSettlements');
export const adminCancelPredictionFunction = callable<{ predictionId: string }, { refunded?: number; total?: number }>(
  'adminCancelPrediction',
);
export const cancelEventMarketFunction = callable<{ marketId: string }, { refunded?: number; total?: number }>(
  'cancelEventMarket',
);
export const repayMarginFunction = callable<{ amount: number }, Api.RepayMarginResponse>('repayMargin');
export const bailoutFunction = callable<Record<string, never>, Api.BailoutResponse>('bailout');
export const leaveCrewFunction = callable<Record<string, never>, Api.CrewPenaltyResponse>('leaveCrew');
export const switchCrewFunction = callable<Api.SwitchCrewRequest, Api.CrewPenaltyResponse>('switchCrew');
export const toggleMarginFunction = callable<{ enable: boolean }>('toggleMargin');
export const chargeMarginInterestFunction = callable<Record<string, never>, Api.ChargeMarginInterestResponse>(
  'chargeMarginInterest',
);
// Server-side portfolio sync
export const syncPortfolioFunction = callable<void, Api.SyncPortfolioResponse>('syncPortfolio');
// Admin: remove achievement from user
export const removeAchievementFunction = callable<{ userId: string; achievementId: string }>('removeAchievement');
// Admin: reinstate bankrupt user
export const reinstateUserFunction = callable<{ userId: string }>('reinstateUser');
// Admin: directly set user cash (for account repairs)
export const adminSetCashFunction = callable<Api.AdminSetCashRequest, { previousCash: number; newCash: number }>(
  'adminSetCash',
);
// Admin: force-transfer cash <-> ladder game balance
export const adminTransferToLadderFunction = callable<
  { userId: string; amount: number },
  { newCash: number; newLadderBalance: number }
>('adminTransferToLadder');
// Admin: flag/clear the Discord-link wall on a user
export const adminSetDiscordWallFunction = callable<{ userId: string; value: boolean }, { alreadyLinked?: boolean }>(
  'adminSetDiscordWall',
);
// Admin: clear a user's Discord link so they can link a different one
export const adminUnlinkDiscordFunction = callable<{ userId: string }, { alreadyUnlinked?: boolean }>(
  'adminUnlinkDiscord',
);
// Admin: move a Discord link off a throwaway account onto the player's original one
export const adminMoveDiscordLinkFunction = callable<
  { sourceUserId: string; targetUserId: string },
  { alreadyMoved?: boolean; discordId?: string }
>('adminMoveDiscordLink');
// Admin: clear the delete-tombstone / unlink-binding holding a Discord ID hostage
export const adminFreeDiscordFunction = callable<
  { discordId: string },
  { clearedTombstone?: boolean; clearedBinding?: boolean }
>('adminFreeDiscord');
// Mints the single-use code that starts the Discord link flow (see useDiscordLink)
export const startDiscordLinkFunction = callable<void, Api.StartDiscordLinkResponse>('startDiscordLink');
// Disconnect your own Discord (Profile → Discord → Unlink)
export const unlinkOwnDiscordFunction = callable<void>('unlinkOwnDiscord');
// Admin: grant/revoke a cosmetic on a user (giveaways)
export const adminGrantCosmeticFunction = callable<{
  userId: string;
  cosmeticId?: string;
  pinId?: string;
  revoke?: boolean;
}>('adminGrantCosmetic');
// Admin: direct edits to one user's game state (see functions/src/admin/adminUserEdit.js)
export const adminChangeDisplayNameFunction = callable<{ userId: string; displayName: string }>(
  'adminChangeDisplayName',
);
// Admin: 30-day return distribution, for calibrating season tier thresholds
export const adminReturnDistributionFunction = callable<Record<string, never>, Api.ReturnDistributionReport>(
  'adminReturnDistribution',
);
// Seasons — standings are public; the rest are admin-only
export const getSeasonStandingsFunction = callable<Record<string, never>, Api.SeasonStandingsResponse>(
  'getSeasonStandings',
);
export const adminStartSeasonFunction = callable<
  { name: string; preseason: boolean; countThisWeek: boolean },
  Api.StartSeasonResponse
>('adminStartSeason');
export const adminEndSeasonFunction = callable<Record<string, never>, Api.EndSeasonResponse>('adminEndSeason');
export const triggerSeasonCheckpointFunction = callable<Record<string, never>, Api.SeasonCheckpointResponse>(
  'triggerSeasonCheckpoint',
);
// Keeping repeat coordinators out of Platinum/Diamond — admin-only
export const getSeasonCoordFlagsFunction = callable<Record<string, never>, { players?: Api.SeasonCoordPlayer[] }>(
  'getSeasonCoordFlags',
);
export const setSeasonTopTierExclusionFunction = callable<{ uid: string; excluded: boolean }>(
  'setSeasonTopTierExclusion',
);
export const getCoordProfitFunction = callable<{ uid: string }, Api.CoordProfitResponse>('getCoordProfit');
export const adminRemoveCoordProfitFunction = callable<Api.RemoveCoordProfitRequest, Api.CoordRemovalPreview>(
  'adminRemoveCoordProfit',
);
// Season dry runs — the weekly rehearsal that runs while no season is on
export const triggerSeasonDryRunFunction = callable<Record<string, never>, { ran?: boolean; reason?: string }>(
  'triggerSeasonDryRun',
);
export const adminSeasonDryRunReportFunction = callable<Record<string, never>, Api.SeasonDryRunReport>(
  'adminSeasonDryRunReport',
);
export const adminSetCrewFunction = callable<{ userId: string; crewId: string | null }, { unchanged?: boolean }>(
  'adminSetCrew',
);
export const adminGrantAchievementFunction = callable<
  { userId: string; achievementId: string },
  { alreadyEarned?: boolean }
>('adminGrantAchievement');
export const adminSetMarginFunction = callable<
  { userId: string; enabled: boolean; clearDebt: boolean },
  { marginEnabled?: boolean; clearedDebt?: boolean; previousMarginUsed: number }
>('adminSetMargin');
export const adminSetHoldingFunction = callable<
  { userId: string; ticker: string; shares: number; costBasis: number | null },
  { previousShares: number; shares: number }
>('adminSetHolding');
// Admin: delete an account with the full clean-up (archive, tombstones, sign-in)
export const adminDeleteUserFunction = callable<{ userId: string }, { success: boolean; userId: string }>(
  'adminDeleteUser',
);
// Admin: move an account onto another uid; the old account is removed
export const adminTransferAccountFunction = callable<
  { fromUserId: string; toUserId: string },
  { success: boolean; fromName: string | null }
>('adminTransferAccount');
// Admin: rename ticker across all data
export const renameTickerFunction = callable<Api.RenameTickerRequest, Api.RenameTickerResponse>('renameTicker');
export const splitStockFunction = callable<Api.SplitStockRequest, Api.SplitStockResponse>('splitStock');
export const setMarketHaltFunction = callable<{ halted: boolean; reason: string }>('setMarketHalt');
export const adminDelayOpenFunction = callable<{ minutes: number }, { success: boolean; openAt: number | null }>(
  'adminDelayOpen',
);
// Admin: watchlist management
export const addWatchedUserFunction = callable<
  { userId: string; reason: string; maxAccountsPerIP: number },
  { displayName?: string; knownIPCount?: number }
>('addWatchedUser');
export const removeWatchedUserFunction = callable<{ userId: string }>('removeWatchedUser');
export const linkAltAccountFunction = callable<{ watchedUserId: string; altAccountId: string }, { altName?: string }>(
  'linkAltAccount',
);
export const addWatchedIPFunction = callable<{ userId: string; ip: string }>('addWatchedIP');
export const getWatchlistFunction = callable<void, Api.WatchlistResponse>('getWatchlist');
export const getIpTrackingHealthFunction = callable<void, Api.IpHealthReport>('getIpTrackingHealth');
export const getRecentSignupReportFunction = callable<{ hoursBack: number }, Api.SignupReport>('getRecentSignupReport');
// Admin: proactive alt detection
export const triggerAltScanFunction = callable<{ dryRun: boolean }, Api.AltScanResponse>('triggerAltScan');
export const reviewWatchlistAlertFunction = callable<
  { alertId: string } | { all: true },
  { success: boolean; marked?: number }
>('reviewWatchlistAlert');
// Price alerts
export const createPriceAlertFunction = callable<Api.CreatePriceAlertRequest>('createPriceAlert');
export const deletePriceAlertFunction = callable<{ alertId: string }>('deletePriceAlert');
// Admin: drop audit
export const auditUserDropsFunction = callable<{ uid?: string; username?: string }, Api.DropAuditResponse>(
  'auditUserDrops',
);
// Dividends
export const runDividendPayoutNowFunction = callable<void, Api.DividendRunResponse>('runDividendPayoutNow');
// Username reservation audit
export const auditUsernamesFunction = callable<Record<string, never>, Api.AuditUsernamesResponse>('migrateUsernames');
// Name players who have none, with a free name change each
export const adminNameUnnamedFunction = callable<{ dryRun: boolean }, Api.NameUnnamedResponse>('adminNameUnnamed');
// Admin: initialize prices for new characters
export const initNewCharacterPricesFunction = callable<void, { initialized: { ticker: string }[]; message: string }>(
  'initNewCharacterPrices',
);
// Admin: recompute crew underdog multipliers (+ optionally re-post Discord rankings)
export const triggerWeeklyCrewRankingsFunction = callable<
  { skipDiscord?: boolean; rolesOnly?: boolean; dryRun?: boolean },
  Api.CrewRankingsResponse
>('triggerWeeklyCrewRankings');
// Admin: re-post the weekly market report to Discord now
export const triggerWeeklyMarketSummaryFunction = callable<
  Record<string, never>,
  Api.JobResult & { posted?: boolean; weeklyTrades?: number; activeUsers?: number }
>('triggerWeeklyMarketSummary');
// Admin: write the trade records that old limit/stop-loss/pre-market fills never wrote

// Admin: Discord message manager (post / edit / delete bot messages from the panel)
export const adminListDiscordChannelsFunction = callable<void, { channels?: Api.DiscordChannel[]; reason?: string }>(
  'adminListDiscordChannels',
);
export const adminListDiscordMessagesFunction = callable<void, { messages?: Api.TrackedDiscordMessage[] }>(
  'adminListDiscordMessages',
);
export const adminSendDiscordMessageFunction = callable<
  Api.DiscordMessagePayload,
  { message: Api.TrackedDiscordMessage }
>('adminSendDiscordMessage');
export const adminUpdateDiscordMessageFunction = callable<
  Api.DiscordMessagePayload & { id: string },
  { message: Api.TrackedDiscordMessage }
>('adminUpdateDiscordMessage');
export const adminDeleteDiscordMessageFunction = callable<{ id: string; forget: boolean }>('adminDeleteDiscordMessage');
export const adminImportDiscordMessageFunction = callable<
  { channelId: string; messageId: string; label?: string },
  { message: Api.TrackedDiscordMessage; alreadyTracked?: boolean }
>('adminImportDiscordMessage');

// Admin: read the cash adjustment audit log
export const adminListGiftsFunction = callable<Record<string, never>, Api.GiftLogResponse>('adminListGifts');
export const adminListLogFunction = callable<{ limit?: number }, Api.AdminLogResponse>('adminListLog');
export const adminListCashLogFunction = callable<Record<string, never>, Api.CashLogResponse>('adminListCashLog');

// Admin command panel (functions/src/admin/adminPlayerFile.ts, adminDashboard.ts,
// adminMoneyFlow.ts, adminBulk.ts)
export const adminGetPlayerFileFunction = callable<{ uid: string }, Panel.PlayerFileResponse>('adminGetPlayerFile');
export const adminAddPlayerNoteFunction = callable<{ uid: string; text: string }, { note: Panel.PlayerNote }>(
  'adminAddPlayerNote',
);
export const adminDeletePlayerNoteFunction = callable<{ uid: string; noteId: string }, { ok: boolean }>(
  'adminDeletePlayerNote',
);
export const adminDashboardFunction = callable<void, Panel.DashboardResponse>('adminDashboard');
export const adminWelcomeTrackerFunction = callable<void, Panel.WelcomeTrackerResponse>('adminWelcomeTracker');
export const adminDiscordActivityFunction = callable<void, Panel.DiscordActivityResponse>('adminDiscordActivity');
export const adminMoneyFlowFunction = callable<{ days: number }, Panel.MoneyFlowResponse>('adminMoneyFlow');
export const adminBulkActionFunction = callable<Panel.BulkActionRequest, Panel.BulkActionResponse>('adminBulkAction');
export const adminCutAccountFunction = callable<
  { uid: string; target: number; note?: string; dm?: boolean; preview: boolean },
  Panel.CutAccountResponse
>('adminCutAccount');
export const adminSetChapterNoteFunction = callable<
  { weekId: string; label: string; note: string },
  { success: boolean }
>('adminSetChapterNote');
export const adminCoTradersFunction = callable<{ uid: string; days: number }, Panel.CoTradersResponse>(
  'adminCoTraders',
);
export const adminMarketGuardFunction = callable<Panel.MarketGuardRequest, Panel.MarketGuardResponse>(
  'adminMarketGuard',
);
// Same backend function, the Bots screen view.
export const adminBotActivityFunction = callable<{ action: 'bots' }, Panel.BotActivityResponse>('adminMarketGuard');
