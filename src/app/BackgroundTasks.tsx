import { useMarket, useSession } from '../context/AppContext';
import { useAccountMaintenance } from '../features/account/hooks/useAccountMaintenance';

// Account upkeep that runs on price ticks (payout claims, portfolio sync, ...).
// Its own component so those ticks re-render this, which draws nothing, rather
// than App.
export default function BackgroundTasks() {
  const { user, userData, showNotification } = useSession();
  const { prices, predictions } = useMarket();
  useAccountMaintenance({ user, userData, prices, predictions, showNotification });
  return null;
}
