import { useAdminBetsList } from './useAdminBetsList';
import { useAdminBetRecovery } from './useAdminBetRecovery';

// Predictions tab: bet listing plus the stuck-payout recovery tool. Both halves
// live in their own hook; this composes them so AdminPanel still spreads one
// object.
export function useAdminBets({ showMessage, setLoading }) {
  return {
    ...useAdminBetsList({ showMessage }),
    ...useAdminBetRecovery({ showMessage, setLoading }),
  };
}
