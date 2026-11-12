import { useState, type TouchEvent } from 'react';
import { createPortal } from 'react-dom';
import TradeActionModal from '../../trading/components/TradeActionModal';
import PreMarketModal from '../../trading/components/PreMarketModal';
import { useSession } from '../../../context/AppContext';
import { isPreMarketWindow } from '../../../utils/marketHours';
import type { Character } from '../../../characters';
import type { ShortPosition, TradeAction } from '../../../types';
import { usePreMarket, tradeLabel } from '../../../shared/hooks/usePreMarket';

interface CardTradeMenuProps {
  character: Character;
  price: number;
  holdings: number;
  shortPosition?: ShortPosition;
  userCash: number;
  onTrade: (ticker: string, action: TradeAction, amount: number) => unknown;
  haltInfo?: { resumeAt?: number } | null;
  /** Halted or market closed: the button shows why and does nothing. */
  blocked: boolean;
  label: string;
}

/**
 * The stock card's Buy / Sell / Short / Cover buttons, always showing. Each
 * opens the trade window (or the opening auction window during pre-market).
 * Halted or closed, one greyed-out button says why instead.
 */
const CardTradeMenu = ({
  character,
  price,
  holdings,
  shortPosition,
  userCash,
  onTrade,
  haltInfo,
  blocked,
  label,
}: CardTradeMenuProps) => {
  const { userData } = useSession();
  const [tradeAction, setTradeAction] = useState<TradeAction | null>(null);
  const [preMarket, setPreMarket] = useState<'buy' | 'sell' | null>(null);

  const cb = userData?.colorBlindMode;
  const buyCls = cb ? 'bg-teal-600 hover:bg-teal-700' : 'bg-green-600 hover:bg-green-700';
  const sellCls = cb ? 'bg-purple-600 hover:bg-purple-700' : 'bg-red-600 hover:bg-red-700';
  const shorted = !!shortPosition && shortPosition.shares > 0;
  // Pre-market: Buy and Sell queue for the opening auction; Short and Cover wait for the reopen.
  const pre = usePreMarket();

  const go = (action: TradeAction) => {
    if ((action === 'buy' || action === 'sell') && isPreMarketWindow()) setPreMarket(action);
    else setTradeAction(action);
  };

  const stop = (e: TouchEvent) => e.stopPropagation();

  return (
    <>
      {blocked ? (
        <button
          disabled
          onClick={(e) => e.stopPropagation()}
          className="w-full py-1.5 text-[11px] font-semibold uppercase rounded-sm border border-red-500/30 text-red-400 opacity-60 cursor-not-allowed"
        >
          {label}
        </button>
      ) : (
        <div
          className={`w-full grid grid-cols-2 gap-1.5 ${pre ? '' : 'md:grid-cols-4'}`}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            onClick={() => go('buy')}
            className={`py-1.5 text-[11px] font-semibold uppercase rounded-sm text-white ${buyCls}`}
          >
            {tradeLabel('buy', pre)}
          </button>
          <button
            onClick={() => go('sell')}
            disabled={holdings === 0}
            className={`py-1.5 text-[11px] font-semibold uppercase rounded-sm text-white disabled:opacity-50 ${sellCls}`}
          >
            {tradeLabel('sell', pre)}
          </button>
          {!pre && (
            <button
              onClick={() => go('short')}
              className="py-1.5 text-[11px] font-semibold uppercase rounded-sm border border-orange-500 light:text-orange-500 light:hover:bg-orange-50 dark:text-orange-400 dark:hover:bg-orange-900/30"
            >
              Short
            </button>
          )}
          {!pre && (
            <button
              onClick={() => go('cover')}
              disabled={!shorted}
              className="py-1.5 text-[11px] font-semibold uppercase rounded-sm border border-blue-500 light:text-blue-600 light:hover:bg-blue-50 dark:text-blue-400 dark:hover:bg-blue-900/30 disabled:opacity-50"
            >
              Cover
            </button>
          )}
        </div>
      )}

      {/* The windows render on the page body, not inside the card. The card
          lifts on hover with a transform, and a transformed parent shrinks a
          full-screen window into the card, so taps fell through to other
          stocks. Touches also stop here so a swipe in the window can't turn
          the market page behind it. */}
      {(tradeAction || preMarket) &&
        createPortal(
          <div onTouchStart={stop} onTouchEnd={stop}>
            {tradeAction && (
              <TradeActionModal
                character={character}
                action={tradeAction}
                price={price}
                holdings={holdings}
                shortPosition={shortPosition}
                userCash={userCash}
                onTrade={onTrade}
                onClose={() => setTradeAction(null)}
                haltInfo={haltInfo}
              />
            )}
            {preMarket && (
              <PreMarketModal
                character={character}
                price={price}
                holdings={holdings}
                userCash={userCash}
                initialAction={preMarket}
                onClose={() => setPreMarket(null)}
              />
            )}
          </div>,
          document.body,
        )}
    </>
  );
};

export default CardTradeMenu;
