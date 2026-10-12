import { useAdminBetsList } from './useAdminBetsList';
import type { AdminHookDeps } from '../utils/adminShared';

// Predictions tab: bet listing. Kept as its own hook so AdminPanel spreads one object.
export function useAdminBets({ showMessage }: Pick<AdminHookDeps, 'showMessage'>) {
  return {
    ...useAdminBetsList({ showMessage }),
  };
}
