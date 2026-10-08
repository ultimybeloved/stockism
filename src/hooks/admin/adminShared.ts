import type { Dispatch, SetStateAction } from 'react';
import type { MarketData } from '../../context/AppContext';
import type { PriceMap, ShareMap, ShortMap, UserBet, UserData } from '../../types';
import { doc } from 'firebase/firestore';
import { db } from '../../firebase';

// Chart history lives in its own doc (market/priceHistory), keyed by ticker.
// Shared by the price tools, trade rollback, and maintenance hooks.
export const priceHistoryDocRef = () => doc(db, 'market', 'priceHistory');

// ---- Shared hook inputs ----
// AdminPanel hands every domain hook some subset of these.

export type ShowMessage = (type: string, text: string) => void;
export type SetMessage = (message: { type: string; text: string } | null) => void;
export type SetLoading = (loading: boolean) => void;

/** A user doc as the admin panel holds it: the doc fields plus its id. */
export interface AdminUser extends UserData {
  id: string;
}

/** A user doc loaded through the user list, where these fields are filled with defaults. */
export interface LoadedAdminUser extends AdminUser {
  holdings: ShareMap;
  shorts: ShortMap;
  bets: Record<string, UserBet>;
  costBasis: Record<string, number>;
}

export type SetSelectedUser = Dispatch<SetStateAction<AdminUser | null>>;

export interface AdminHookDeps {
  showMessage: ShowMessage;
  setMessage: SetMessage;
  setLoading: SetLoading;
  setSelectedUser: SetSelectedUser;
  prices: PriceMap;
  marketData: MarketData | null;
}
