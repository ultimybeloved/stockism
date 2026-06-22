import React, { useState } from 'react';
import { CHARACTER_MAP } from '../characters';
import { getThemeClasses } from '../utils/theme';
import { formatCurrency, formatTimeRemaining } from '../utils/formatters';
import { IPO_TOTAL_SHARES, IPO_MAX_PER_USER } from '../constants';
import { useAppContext } from '../context/AppContext';

const IPOActiveCard = ({ ipo, onBuyIPO }) => {
  const { darkMode, userData, user } = useAppContext();
  const colorBlindMode = userData?.colorBlindMode || false;
  const isGuest = !user;
  const [quantity, setQuantity] = useState(1);
  const { cardClass, textClass, mutedClass, subtleClass } = getThemeClasses(darkMode);

  const character = CHARACTER_MAP[ipo.ticker];
  const timeRemaining = ipo.ipoEndsAt - Date.now();
  const ipoTotalShares = ipo.totalShares || IPO_TOTAL_SHARES;
  const ipoMaxPerUser = ipo.maxPerUser || IPO_MAX_PER_USER;
  const sharesRemaining = ipo.sharesRemaining ?? ipoTotalShares;
  const userIPOPurchases = userData?.ipoPurchases?.[ipo.ticker] || 0;
  const affordableShares = ipo.basePrice > 0 ? Math.floor((userData?.cash || 0) / ipo.basePrice) : 0;
  const maxCanBuy = Math.max(0, Math.min(ipoMaxPerUser - userIPOPurchases, sharesRemaining, affordableShares));
  // quantity can be '' while the user is mid-edit — use a numeric fallback for math
  const qtyNum = quantity === '' ? 0 : quantity;
  const totalCost = qtyNum * ipo.basePrice;
  const canAfford = (userData?.cash || 0) >= totalCost;

  const soldOut = sharesRemaining <= 0;
  const userMaxedOut = userIPOPurchases >= ipoMaxPerUser;

  return (
    <div className={`${cardClass} border-2 ${colorBlindMode ? 'border-teal-500' : 'border-green-500'} rounded-sm p-4 relative overflow-hidden`}>
      {/* Live indicator */}
      <div className="absolute top-2 right-2 flex items-center gap-1">
        <span className={`w-2 h-2 ${colorBlindMode ? 'bg-teal-500' : 'bg-green-500'} rounded-full animate-pulse`} />
        <span className={`text-xs font-bold ${colorBlindMode ? 'text-teal-500' : 'text-green-500'}`}>LIVE</span>
      </div>

      <div className="flex items-center gap-2 mb-2">
        <span className="text-xl">📈</span>
        <span className={`text-xs font-bold uppercase ${colorBlindMode ? 'text-teal-500' : 'text-green-500'} tracking-wider`}>IPO Now Open</span>
      </div>

      <h3 className={`text-lg font-bold ${textClass}`}>
        ${ipo.ticker} - {character?.name}
      </h3>

      <div className={`mt-3 p-3 rounded-sm ${subtleClass}`}>
        <div className="grid grid-cols-3 gap-2 text-center">
          <div>
            <p className={`text-xs ${mutedClass}`}>Price</p>
            <p className={`text-lg font-bold ${colorBlindMode ? 'text-teal-500' : 'text-green-500'}`}>{formatCurrency(ipo.basePrice)}</p>
          </div>
          <div>
            <p className={`text-xs ${mutedClass}`}>Left</p>
            <p className={`text-lg font-bold ${sharesRemaining <= 20 ? (colorBlindMode ? 'text-purple-500' : 'text-red-500') : 'text-orange-500'}`}>
              {sharesRemaining}/{ipoTotalShares}
            </p>
          </div>
          <div>
            <p className={`text-xs ${mutedClass}`}>Ends In</p>
            <p className="text-lg font-bold text-amber-500">{formatTimeRemaining(timeRemaining)}</p>
          </div>
        </div>

        {/* Progress bar */}
        <div className="mt-2">
          <div className={`h-2 rounded-full ${darkMode ? 'bg-zinc-700' : 'bg-zinc-200'}`}>
            <div
              className={`h-full rounded-full bg-gradient-to-r ${colorBlindMode ? 'from-teal-500' : 'from-green-500'} to-orange-500 transition-all`}
              style={{ width: `${((ipoTotalShares - sharesRemaining) / ipoTotalShares) * 100}%` }}
            />
          </div>
        </div>
      </div>

      {isGuest ? (
        <p className={`text-center text-sm ${mutedClass} mt-3`}>Sign in to participate in IPO</p>
      ) : soldOut ? (
        <div className="mt-3 text-center">
          <p className={`${colorBlindMode ? 'text-purple-500' : 'text-red-500'} font-bold`}>🚫 SOLD OUT</p>
          <p className={`text-xs ${mutedClass}`}>Normal trading begins soon with 15% price increase</p>
        </div>
      ) : userMaxedOut ? (
        <div className="mt-3 text-center">
          <p className="text-amber-500 font-semibold">✓ You've reached max IPO allocation</p>
          <p className={`text-xs ${mutedClass}`}>You purchased {userIPOPurchases} shares</p>
        </div>
      ) : (
        <div className="mt-3 space-y-2">
          <label className={`block text-sm font-semibold mb-1 ${textClass}`}>Shares</label>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setQuantity(Math.max(1, qtyNum - 1))}
              className={`px-3 py-2 rounded-sm font-bold ${darkMode ? 'bg-zinc-800 text-zinc-100' : 'bg-slate-200 text-slate-900'}`}
            >
              -
            </button>
            <input
              type="number"
              min="1"
              max={maxCanBuy}
              value={quantity}
              onChange={(e) => {
                const val = e.target.value;
                if (val === '') { setQuantity(''); return; }
                const num = parseInt(val);
                if (!isNaN(num)) setQuantity(Math.min(maxCanBuy, Math.max(0, num)));
              }}
              onBlur={() => {
                if (quantity === '' || quantity < 1) setQuantity(maxCanBuy >= 1 ? 1 : 0);
              }}
              className={`flex-1 text-center py-2 rounded-sm border ${darkMode ? 'bg-zinc-950 border-zinc-700 text-zinc-100' : 'bg-white border-amber-200 text-slate-900'}`}
            />
            <button
              onClick={() => setQuantity(Math.min(maxCanBuy, qtyNum + 1))}
              className={`px-3 py-2 rounded-sm font-bold ${darkMode ? 'bg-zinc-800 text-zinc-100' : 'bg-slate-200 text-slate-900'}`}
            >
              +
            </button>
            <button
              onClick={() => setQuantity(maxCanBuy)}
              className="px-3 py-2 text-sm font-semibold rounded-sm bg-teal-600 hover:bg-teal-700 text-white"
            >
              Max
            </button>
          </div>
          <p className={`text-xs ${mutedClass}`}>
            Max: {maxCanBuy} shares &nbsp;•&nbsp; Total: <span className={`font-semibold ${textClass}`}>{formatCurrency(totalCost)}</span>
          </p>

          <button
            onClick={() => onBuyIPO(ipo.ticker, qtyNum)}
            disabled={!canAfford || qtyNum < 1 || qtyNum > maxCanBuy}
            className={`w-full py-2 text-sm font-bold uppercase ${colorBlindMode ? 'bg-teal-600 hover:bg-teal-700' : 'bg-green-600 hover:bg-green-700'} text-white rounded-sm disabled:opacity-50 disabled:cursor-not-allowed`}
          >
            {!canAfford ? 'Insufficient Funds' : `Buy ${qtyNum} Share${qtyNum > 1 ? 's' : ''}`}
          </button>
        </div>
      )}
    </div>
  );
};

export default IPOActiveCard;
