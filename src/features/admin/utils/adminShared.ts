import type { Dispatch, SetStateAction } from 'react';
import type { MarketData } from '../../../context/AppContext';
import type { PriceMap, ShareMap, ShortMap, UserBet, UserData } from '../../../types';
import { doc } from 'firebase/firestore';
import { db } from '../../../firebase';

// Chart history lives in its own doc (market/priceHistory), keyed by ticker.
// Shared by the price tools, trade rollback, and maintenance hooks.
export const priceHistoryDocRef = () => doc(db, 'market', 'priceHistory');

// ---- Shared hook inputs ----
// AdminPanel hands every domain hook some subset of these.

export type ShowMessage = (type: string, text: string) => void;
export type SetMessage = (message: { type: string; text: string } | null) => void;
export type SetLoading = (loading: boolean) => void;

/**
 * A user doc as the admin panel holds it: the doc fields plus its id, with the
 * fields the panel reads filled with defaults (see withUserDefaults).
 */
export interface AdminUser extends UserData {
  id: string;
  displayName: string;
  cash: number;
  portfolioValue: number;
  holdings: ShareMap;
  shorts: ShortMap;
  bets: Record<string, UserBet>;
  costBasis: Record<string, number>;
}

/** @deprecated Same as AdminUser now; kept so existing imports read naturally. */
export type LoadedAdminUser = AdminUser;

export type SetSelectedUser = Dispatch<SetStateAction<AdminUser | null>>;

export interface AdminHookDeps {
  showMessage: ShowMessage;
  setMessage: SetMessage;
  setLoading: SetLoading;
  setSelectedUser: SetSelectedUser;
  prices: PriceMap;
  marketData: MarketData | null;
}

// Containers the user card indexes into directly — UserPositions does
// Object.keys(selectedUser.holdings) with no guard, and there are several more
// like it. A raw user document may be missing any of them: new, reset and
// bankrupt accounts often have no holdings/shorts/bets field at all. Both the
// list rows and the full-document load run through here so neither can hand a
// component an undefined where it expects an object.
export const withUserDefaults = (data: UserData) => ({
  displayName: data.displayName || 'Unknown',
  cash: data.cash || 0,
  portfolioValue: data.portfolioValue || 0,
  holdings: data.holdings || {},
  shorts: data.shorts || {},
  bets: data.bets || {},
  costBasis: data.costBasis || {},
  transactionLog: data.transactionLog || [],
  ownedCosmetics: data.ownedCosmetics || [],
  activeCosmetics: data.activeCosmetics || {},
  lowestWhileHolding: data.lowestWhileHolding || {},
  peakPortfolioValue: data.peakPortfolioValue || 0,
  totalTrades: data.totalTrades || 0,
  totalCheckins: data.totalCheckins || 0,
  isAdmin: data.isAdmin || false,
  isBankrupt: data.isBankrupt || false,
  marginEnabled: data.marginEnabled || false,
  marginUsed: data.marginUsed || 0,
  activeLoan: data.activeLoan || null,
  crew: data.crew || null,
  discordId: data.discordId || null,
  discordUsername: data.discordUsername || null,
  requiresDiscordLink: data.requiresDiscordLink || false,
});
