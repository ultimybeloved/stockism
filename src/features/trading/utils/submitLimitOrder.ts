import { createLimitOrderFunction } from '../../../api/callables';
import { roundShares } from '../../../utils/tradeLimits';
import { isWeeklyHalt } from '../../../utils/marketHours';
import { errorMessage } from '../../../utils/errors';
import { playSound } from '../../../utils/sounds';
import type { AppContextValue } from '../../../context/AppContext';
import type { TradeAction } from '../../../types';

/**
 * The trade window's limit order / stop loss submit: checks the price, places
 * the order and tells the player. Split out of TradeActionModal to keep it
 * inside its size limit. Resolves true when the order was created.
 */
export async function submitLimitOrder({
  ticker,
  action,
  isStopLoss,
  limitPrice,
  price,
  amount,
  allowPartialFills,
  showNotification,
}: {
  ticker: string;
  action: TradeAction;
  isStopLoss: boolean;
  limitPrice: string;
  price: number;
  amount: number;
  allowPartialFills: boolean;
  showNotification: AppContextValue['showNotification'];
}): Promise<boolean> {
  // Block limit order creation during trading halt
  if (isWeeklyHalt()) {
    showNotification('error', 'Market is closed for chapter review. Orders cannot be created during trading halt.');
    return false;
  }

  const priceNum = parseFloat(limitPrice);
  if (isNaN(priceNum) || priceNum <= 0) {
    showNotification('error', `Please enter a valid ${isStopLoss ? 'stop' : 'limit'} price`);
    return false;
  }
  if (priceNum > price * 10) {
    showNotification('error', `${isStopLoss ? 'Stop' : 'Limit'} price cannot exceed 10x current price`);
    return false;
  }

  try {
    await createLimitOrderFunction({
      ticker,
      type: isStopLoss ? 'STOP_LOSS' : action.toUpperCase(),
      // Buys are whole-cent share counts; exits keep their fractional size so
      // a dust position can be queued in full.
      shares: roundShares(amount, action === 'sell'),
      limitPrice: priceNum,
      allowPartialFills,
    });
    playSound('limit');
    showNotification('success', `${isStopLoss ? 'Stop loss' : 'Limit order'} created! View your orders in Portfolio.`);
    return true;
  } catch (error) {
    console.error('Error creating order:', error);
    playSound('error');
    showNotification('error', `Failed to create order: ${errorMessage(error)}`);
    return false;
  }
}
