import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import type { MarketData } from '../../../context/AppContext';

// A renamed ticker keeps turning up long after the rename: in old bell
// notifications, in links posted to Discord, in someone's browser history.
// market/current.tickerAliases maps every retired name to its current one, so
// those land on the right stock instead of an "unknown ticker" dead end.
// Returns the ticker it is redirecting to, if any.
export function useTickerAliasRedirect(ticker: string, known: boolean, marketData: MarketData | null) {
  const navigate = useNavigate();
  const aliasTarget = marketData?.tickerAliases?.[ticker];
  useEffect(() => {
    if (!known && aliasTarget) navigate(`/stock/${aliasTarget}`, { replace: true });
  }, [known, aliasTarget, navigate]);
  return aliasTarget;
}
