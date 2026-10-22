import { useState } from 'react';
import TradeActionModal from '../../trading/components/TradeActionModal';
import PreMarketModal from '../../trading/components/PreMarketModal';
import { useSession } from '../../../context/AppContext';
import { themeClasses } from '../../../utils/theme';
import { isPreMarketWindow } from '../../../utils/marketHours';
import type { Character } from '../../../characters';
import type { ShortPosition, TradeAction } from '../../../types';

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
 * The stock card's small Trade button. Opens Buy / Sell / Short / Cover in
 * place of the card's footer, then the trade window (or the opening auction
 * window during pre-market).
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
  const [open, setOpen] = useState(false);
  const [tradeAction, setTradeAction] = useState<TradeAction | null>(null);
  const [preMarket, setPreMarket] = useState<'buy' | 'sell' | null>(null);
  const { ghostBtnClass, mutedClass } = themeClasses;
  const cb = userData?.colorBlindMode;
  const buyCls = cb ? 'bg-teal-600 hover:bg-teal-700' : 'bg-green-600 hover:bg-green-700';
  const sellCls = cb ? 'bg-purple-600 hover:bg-purple-700' : 'bg-red-600 hover:bg-red-700';
  const shorted = !!shortPosition && shortPosition.shares > 0;

  const go = (action: TradeAction) => {
    setOpen(false);
    if ((action === 'buy' || action === 'sell') && isPreMarketWindow()) setPreMarket(action);
    else setTradeAction(action);
  };

  return (
    <>
      {!open ? (
        <button
          onClick={(e) => {
            e.stopPropagation();
            if (!blocked) setOpen(true);
          }}
          disabled={blocked}
          className={`shrink-0 px-2.5 py-1 text-[11px] font-semibold uppercase rounded-sm border ${
            blocked ? 'border-red-500/30 text-red-400 opacity-60 cursor-not-allowed' : ghostBtnClass
          }`}
        >
          {label}
        </button>
      ) : (
        <div className="w-full space-y-1.5 pt-1" onClick={(e) => e.stopPropagation()}>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-1.5">
            <button
              onClick={() => go('buy')}
              className={`py-1.5 text-[11px] font-semibold uppercase rounded-sm text-white ${buyCls}`}
            >
              Buy
            </button>
            <button
              onClick={() => go('sell')}
              disabled={holdings === 0}
              className={`py-1.5 text-[11px] font-semibold uppercase rounded-sm text-white disabled:opacity-50 ${sellCls}`}
            >
              Sell
            </button>
            <button
              onClick={() => go('short')}
              className="py-1.5 text-[11px] font-semibold uppercase rounded-sm border border-orange-500 light:text-orange-500 light:hover:bg-orange-50 dark:text-orange-400 dark:hover:bg-orange-900/30"
            >
              Short
            </button>
            <button
              onClick={() => go('cover')}
              disabled={!shorted}
              className="py-1.5 text-[11px] font-semibold uppercase rounded-sm border border-blue-500 light:text-blue-600 light:hover:bg-blue-50 dark:text-blue-400 dark:hover:bg-blue-900/30 disabled:opacity-50"
            >
              Cover
            </button>
          </div>
          <button onClick={() => setOpen(false)} className={`w-full text-[11px] ${mutedClass} hover:text-orange-500`}>
            Cancel
          </button>
        </div>
      )}

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
    </>
  );
};

export default CardTradeMenu;
