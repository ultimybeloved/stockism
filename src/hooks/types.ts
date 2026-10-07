// Shapes shared by the action hooks that App.jsx assembles (useDailyOperations,
// useIPOManagement, useTradeManagement, ...). Each receives the same handful of
// app-level values; these name them once.
import type { Dispatch, SetStateAction } from 'react';
import type { User } from 'firebase/auth';
import type { AppContextValue, MarketData } from '../context/AppContext';
import type { UserData } from '../types';

export type SetUserData = Dispatch<SetStateAction<UserData | null>>;

/** Flags a named action as in flight, so its button can show a spinner. */
export type SetLoadingKey = (key: string, loading: boolean) => void;

export interface ActionHookDeps {
  user: User | null;
  userData: UserData | null;
  showNotification: AppContextValue['showNotification'];
  setUserData: SetUserData;
  setLoadingKey: SetLoadingKey;
  marketData?: MarketData | null;
}
