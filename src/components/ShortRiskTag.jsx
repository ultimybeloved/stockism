import { formatCurrency } from '../utils/formatters';
import { getShortRisk } from '../utils/calculations';

// The "X short (P/L)" status shown on a stock card, plus a force-cover warning sign
// when the short is getting close to auto-liquidation. Hover the sign for the price.
const ShortRiskTag = ({ shortPosition, ticker, price, colorBlindMode }) => {
  if (!shortPosition || !(shortPosition.shares > 0)) return null;
  const entry = Number(shortPosition.costBasis || shortPosition.entryPrice) || 0;
  const shortPL = (entry - price) * shortPosition.shares;
  const risk = getShortRisk(shortPosition, price);
  const plColor = shortPL >= 0
    ? (colorBlindMode ? 'text-teal-500' : 'text-green-500')
    : (colorBlindMode ? 'text-purple-500' : 'text-red-500');

  return (
    <span className={`text-xs font-semibold ${plColor}`}>
      {shortPosition.shares} short ({shortPL >= 0 ? '+' : ''}{formatCurrency(shortPL)})
      {risk?.isAtRisk && risk.liquidationPrice && (
        <span
          className="text-orange-500 ml-1"
          title={`Force-covered if $${ticker} rises to ${formatCurrency(risk.liquidationPrice)}`}
        >
          ⚠️
        </span>
      )}
    </span>
  );
};

export default ShortRiskTag;
