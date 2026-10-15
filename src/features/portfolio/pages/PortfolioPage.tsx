// /portfolio: the player's portfolio as a full page. It used to be a window
// over the market capped at 90% of the screen; as a page it has room for the
// chart and the positions side by side on desktop, and a place in the phone
// bottom bar.
import { useState, type ComponentProps } from 'react';
import PortfolioView from '../components/PortfolioView';
import TradeLauncher from '../../trading/components/TradeLauncher';
import { useSession, useMarket } from '../../../context/AppContext';
import { calculatePortfolioValue } from '../../../utils/calculations';
import { themeClasses } from '../../../utils/theme';
import { CHARACTER_MAP } from '../../../characters';
import type { TradeAction } from '../../../types';

type ViewProps = ComponentProps<typeof PortfolioView>;

interface PortfolioPageProps {
  onTrade: ViewProps['onTrade'];
  onLimitSell?: ViewProps['onLimitSell'];
  onOpenTradeHistory: () => void;
  onToggleDrip?: ViewProps['onToggleDrip'];
  onShowLogin: () => void;
}

const PortfolioPage = ({ onTrade, onLimitSell, onOpenTradeHistory, onToggleDrip, onShowLogin }: PortfolioPageProps) => {
  const { user, userData } = useSession();
  const { prices, dividendTierOverrides } = useMarket();
  const [order, setOrder] = useState<{ ticker: string; action: TradeAction } | null>(null);
  const { bgClass, cardClass, mutedClass } = themeClasses;

  if (!user || !userData) {
    return (
      <div className={`min-h-screen ${bgClass} p-4`}>
        <div className={`max-w-md mx-auto mt-8 ${cardClass} border rounded-sm p-6 text-center`}>
          <p className={`text-sm ${mutedClass} mb-3`}>Sign in to see your portfolio.</p>
          <button
            onClick={onShowLogin}
            className="px-4 py-2 bg-orange-600 hover:bg-orange-700 text-white text-sm font-semibold rounded-sm"
          >
            Sign in
          </button>
        </div>
      </div>
    );
  }

  const orderCharacter = order ? CHARACTER_MAP[order.ticker] : undefined;

  return (
    <div className={`min-h-screen ${bgClass} p-4`}>
      <div className="max-w-7xl mx-auto">
        <PortfolioView
          currentValue={calculatePortfolioValue(userData, prices)}
          onTrade={onTrade}
          onOpenOrder={(ticker, action) => setOrder({ ticker, action })}
          onLimitSell={onLimitSell}
          onOpenTradeHistory={onOpenTradeHistory}
          ipoPurchases={userData.ipoPurchases || {}}
          holdingCohorts={userData.holdingCohorts || {}}
          dividendTierOverrides={dividendTierOverrides}
          drip={userData.drip || {}}
          onToggleDrip={onToggleDrip}
        />
      </div>
      {order && orderCharacter && (
        <TradeLauncher
          character={orderCharacter}
          action={order.action}
          onTrade={onTrade}
          onClose={() => setOrder(null)}
        />
      )}
    </div>
  );
};

export default PortfolioPage;
