import { useState } from 'react';
import { getOutcomeColor, themeClasses } from '../../../utils/theme';
import { formatCurrency, formatTimeRemaining, formatMultiplier } from '../../../utils/formatters';
import { niceStep } from '../../../utils/calculations';
import { isWeeklyHalt } from '../../../utils/marketHours';
import { marketTimes } from '../../../utils/localTime';
import { useSession, useMarket } from '../../../context/AppContext';

import type { PredictionDoc, UserBet } from '../../../types';

interface PredictionCardProps {
  prediction: PredictionDoc;
  userBet?: UserBet;
  onBet?: (predictionId: string, option: string, amount: number) => unknown;
  isGuest?: boolean;
  /** Asks for confirmation first. Used instead of onBet when given. */
  onRequestBet?: (predictionId: string, option: string, amount: number, question?: string) => void;
  betLimit?: number;
  isAdmin?: boolean;
  onHide?: (predictionId: string) => void;
}

const PredictionCard = ({
  prediction,
  userBet,
  onBet,
  isGuest,
  onRequestBet,
  betLimit = 0,
  isAdmin = false,
  onHide,
}: PredictionCardProps) => {
  const { userData } = useSession();
  const { marketData } = useMarket();
  // Betting closes with the market, same as trading. Mirrors placeBet's guards.
  const bettingHalted = isWeeklyHalt() || !!marketData?.marketHalted;
  const [betAmount, setBetAmount] = useState(50);
  const [selectedOption, setSelectedOption] = useState<string | null>(null);
  const [showBetUI, setShowBetUI] = useState(false);

  const { cardClass, textClass, mutedClass, subtleClass, chipClass } = themeClasses;
  const betStep = niceStep(betLimit, 1);

  const timeRemaining = (prediction.endsAt ?? 0) - Date.now();
  const isActive = timeRemaining > 0 && !prediction.resolved;

  // Support both old (yesPool/noPool) and new (pools object) format
  const options = prediction.options || ['Yes', 'No'];
  const pools: Record<string, number> = prediction.pools || {
    Yes: prediction.yesPool || 0,
    No: prediction.noPool || 0,
  };
  const totalPool = options.reduce((sum, opt) => sum + (pools[opt] || 0), 0);

  const getOptionPercent = (option: string) => {
    if (totalPool === 0) return Math.floor(100 / options.length);
    return Math.floor(((pools[option] || 0) / totalPool) * 100);
  };

  const calculatePayout = (option: string, amount: number) => {
    const myPool = pools[option] || 0;
    const otherPools = totalPool - myPool;
    const newMyPool = myPool + amount;
    const myShare = newMyPool > 0 ? amount / newMyPool : 0;
    return myShare * (otherPools + newMyPool);
  };

  // Odds are quoted against the amount the player is about to stake, so the number can
  // never promise a return the pool wouldn't actually pay. Floor of 1 avoids /0.
  const previewBet = Math.max(1, betAmount || 0);
  const getOptionMultiplier = (option: string) => calculatePayout(option, previewBet) / previewBet;
  // Hidden on resolved/ended cards (the pools are history) and on an empty pool (every
  // option would read a meaningless 1.00x).
  const showOdds = isActive && totalPool > 0;

  const handlePlaceBet = () => {
    if (selectedOption && betAmount > 0) {
      // Use request bet to show confirmation
      if (onRequestBet) {
        onRequestBet(prediction.id, selectedOption, betAmount, prediction.question);
      } else {
        onBet?.(prediction.id, selectedOption, betAmount);
      }
      setShowBetUI(false);
      setSelectedOption(null);
      setBetAmount(50);
    }
  };

  // Check if user already has a bet on this prediction
  const hasExistingBet = !!userBet;

  // Color blind mode support - teal instead of green, purple instead of red
  const colorBlindMode = userData?.colorBlindMode || false;
  // An answer that isn't one of the options gets no colour (callers fall back to orange).
  const colorOf = (option: string | null | undefined) => {
    const i = option == null ? -1 : options.indexOf(option);
    return i >= 0 ? getOutcomeColor(i, colorBlindMode) : undefined;
  };

  return (
    <div className={`${cardClass} border rounded-sm p-4`}>
      <div className="flex justify-between items-start mb-3">
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-lg">🔮</span>
            <span
              className={`text-xs font-semibold uppercase ${isActive ? 'text-orange-500' : prediction.resolved ? 'text-amber-500' : 'text-red-500'}`}
            >
              {isActive ? 'Active' : prediction.resolved ? 'Resolved' : 'Ended'}
            </span>
            {prediction.reopened && isActive && (
              <span className="text-xs font-semibold uppercase text-blue-500">⏰ Extended</span>
            )}
          </div>
          <h3 className={`font-semibold ${textClass}`}>{prediction.question}</h3>
          {prediction.mayExtend && !prediction.resolved && (
            <p className="text-xs text-amber-500 mt-1">⏳ Result may take an extra week to confirm</p>
          )}
        </div>
        <div className="text-right">
          <div className={`text-xs ${mutedClass}`}>{isActive ? 'Ends in' : 'Ended'}</div>
          <div className={`text-sm font-semibold ${isActive ? 'text-orange-500' : mutedClass}`}>
            {isActive ? formatTimeRemaining(timeRemaining) : '—'}
          </div>
        </div>
      </div>

      <div className="mb-3">
        <div className={`flex justify-between items-baseline gap-2 text-xs ${mutedClass} mb-2`}>
          <span>
            Pool: {formatCurrency(totalPool)}
            {(prediction.seedTotal ?? 0) > 0 && (
              <span className="opacity-70"> (incl. {formatCurrency(prediction.seedTotal)} house seed)</span>
            )}
          </span>
          {showOdds && <span className="opacity-70">payout on a ${previewBet.toLocaleString('en-US')} bet</span>}
        </div>
        <div className="space-y-2">
          {options.map((option, idx) => {
            const percent = getOptionPercent(option);
            const colors = getOutcomeColor(idx, colorBlindMode);
            const winningOutcomes = prediction.outcomes || (prediction.outcome ? [prediction.outcome] : []);
            const isWinner = prediction.resolved && winningOutcomes.includes(option);
            return (
              <div key={option} className="flex items-center gap-2">
                <div
                  className={`w-28 sm:w-40 shrink-0 truncate text-xs font-semibold ${colors.text} ${isWinner ? 'underline' : ''}`}
                  title={option}
                >
                  {option} {isWinner && '✓'}
                </div>
                <div className="flex-1 h-4 rounded-sm overflow-hidden light:bg-slate-200 dark:bg-zinc-800">
                  <div className={`h-full ${colors.fill} transition-all`} style={{ width: `${percent}%` }} />
                </div>
                <div className="w-16 text-right leading-tight">
                  <div className={`text-xs ${mutedClass}`}>{percent}%</div>
                  {showOdds && (
                    <div className="text-xs font-semibold text-orange-500">
                      {formatMultiplier(getOptionMultiplier(option))}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
        {isActive && totalPool === 0 && (
          <div className={`text-xs ${mutedClass} mt-2`}>No bets yet. Odds appear once money is in.</div>
        )}
      </div>

      {userBet && (
        <div className={`mb-3 p-2 rounded-sm ${subtleClass}`}>
          <div className={`text-xs ${mutedClass}`}>Your bet</div>
          <div className={`font-semibold ${colorOf(userBet.option)?.text || 'text-orange-500'}`}>
            {formatCurrency(userBet.amount)} on "{userBet.option}"
          </div>
          {isActive &&
            !prediction.resolved &&
            (() => {
              // Calculate current potential payout
              const myPool = pools[userBet.option ?? ''] || 0;
              const potentialPayout = myPool > 0 ? (userBet.amount / myPool) * totalPool : userBet.amount;
              const potentialMultiplier = userBet.amount > 0 ? potentialPayout / userBet.amount : 1;
              return (
                <div className={`text-xs mt-1 ${mutedClass}`}>
                  Current potential:{' '}
                  <span className="text-orange-500 font-semibold">{formatCurrency(potentialPayout)}</span>
                  <span className="opacity-70"> ({formatMultiplier(potentialMultiplier)})</span>
                </div>
              );
            })()}
          {prediction.resolved && (
            <div
              className={`text-xs mt-1 ${(prediction.outcomes || [prediction.outcome]).includes(userBet.option) ? (userData?.colorBlindMode ? 'text-teal-500' : 'text-green-500') : userData?.colorBlindMode ? 'text-purple-500' : 'text-red-500'}`}
            >
              {(prediction.outcomes || [prediction.outcome]).includes(userBet.option)
                ? `🎉 Won ${formatCurrency(userBet.payout || 0)}!`
                : '❌ Lost'}
            </div>
          )}
        </div>
      )}

      {isActive && !isGuest && (
        <>
          {bettingHalted ? (
            <div
              className={`text-center py-2 text-sm ${mutedClass} light:bg-slate-200/60 dark:bg-zinc-800/50 rounded-sm`}
            >
              {marketData?.marketHalted
                ? `⏸️ Betting paused: ${marketData.haltReason || 'market halted'}`
                : `⏸️ Betting is closed for chapter review. Reopens ${marketTimes().reopen}.`}
            </div>
          ) : hasExistingBet && !prediction.allowAdditionalBets ? (
            <div
              className={`text-center py-2 text-sm ${mutedClass} light:bg-slate-200/60 dark:bg-zinc-800/50 rounded-sm`}
            >
              🔒 You've already placed a bet on this prediction
            </div>
          ) : !showBetUI ? (
            <button
              onClick={() => {
                setShowBetUI(true);
                // Pre-select their existing option if they're adding to bet
                if (hasExistingBet && prediction.allowAdditionalBets) {
                  setSelectedOption(userBet.option ?? null);
                }
              }}
              className="w-full py-2 text-sm font-semibold uppercase bg-orange-600 hover:bg-orange-700 text-white rounded-sm"
            >
              {hasExistingBet && prediction.allowAdditionalBets ? 'Add to Bet' : 'Place Bet'}
            </button>
          ) : (
            <div className="space-y-3">
              {hasExistingBet && prediction.allowAdditionalBets && (
                <div className={`text-xs ${mutedClass} bg-blue-500/10 border border-blue-500 rounded-sm p-2`}>
                  💡 You can add more to your existing bet on "
                  <span className="text-blue-500 font-semibold">{userBet.option}</span>" (cannot change or remove)
                </div>
              )}
              <div className={`grid gap-2 ${options.length <= 2 ? 'grid-cols-2' : 'grid-cols-2'}`}>
                {options.map((option, idx) => {
                  const colors = getOutcomeColor(idx, colorBlindMode);
                  const isLocked = hasExistingBet && prediction.allowAdditionalBets && option !== userBet.option;
                  return (
                    <button
                      key={option}
                      onClick={() => !isLocked && setSelectedOption(option)}
                      disabled={isLocked}
                      className={`py-2 px-2 text-sm font-semibold rounded-sm border-2 transition-all truncate ${
                        isLocked
                          ? 'opacity-30 cursor-not-allowed border-zinc-700 text-zinc-500'
                          : selectedOption === option
                            ? `${colors.bg} border-transparent text-white`
                            : `${colors.border} ${colors.text} hover:opacity-80`
                      }`}
                    >
                      {option}
                    </button>
                  );
                })}
              </div>
              <div>
                <div className={`text-xs ${mutedClass} mb-1`}>Bet Amount</div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setBetAmount((a) => Math.max(0, a - betStep))}
                    className="flex-1 py-1.5 text-xs font-semibold rounded-sm light:bg-slate-200 light:text-zinc-600 light:hover:bg-slate-300 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
                  >
                    -{betStep}
                  </button>
                  <button
                    type="button"
                    onClick={() => setBetAmount((a) => Math.min(betLimit || Infinity, a + betStep))}
                    className="flex-1 py-1.5 text-xs font-semibold rounded-sm light:bg-slate-200 light:text-zinc-600 light:hover:bg-slate-300 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
                  >
                    +{betStep}
                  </button>
                  <button
                    type="button"
                    onClick={() => setBetAmount(Math.floor(betLimit))}
                    disabled={!(betLimit > 0)}
                    className="flex-1 py-1.5 text-xs font-semibold rounded-sm bg-orange-600 hover:bg-orange-700 text-white disabled:opacity-40"
                  >
                    Max
                  </button>
                </div>
                <input
                  type="number"
                  value={betAmount || ''}
                  onChange={(e) => {
                    const val = e.target.value;
                    if (val === '') {
                      setBetAmount(0);
                    } else {
                      const num = parseInt(val);
                      if (!isNaN(num) && num >= 0) {
                        setBetAmount(Math.min(num, betLimit || Infinity));
                      }
                    }
                  }}
                  onFocus={(e) => {
                    if (betAmount === 0) e.target.select();
                  }}
                  className="w-full mt-2 px-3 py-2 text-sm rounded-sm border light:bg-white light:border-amber-200 dark:bg-zinc-950 dark:border-zinc-700 dark:text-zinc-100"
                  placeholder="Custom amount..."
                />
                {betLimit > 0 && (
                  <div className={`text-xs ${mutedClass} mt-1`}>
                    Your bet limit: <span className="text-orange-500 font-semibold">{formatCurrency(betLimit)}</span>
                    <span className="opacity-70"> (based on market investment)</span>
                  </div>
                )}
              </div>
              {selectedOption && betAmount > 0 && (
                <div className={`text-sm ${mutedClass}`}>
                  Potential payout:{' '}
                  <span className="text-orange-500 font-semibold">
                    {formatCurrency(calculatePayout(selectedOption, betAmount))}
                  </span>
                  <span className="opacity-70">
                    {' '}
                    ({formatMultiplier(calculatePayout(selectedOption, betAmount) / betAmount)})
                  </span>
                </div>
              )}
              <div className="flex gap-2">
                <button
                  onClick={() => {
                    setShowBetUI(false);
                    setSelectedOption(null);
                  }}
                  className={`flex-1 py-2 text-sm font-semibold rounded-sm ${chipClass}`}
                >
                  Cancel
                </button>
                <button
                  onClick={handlePlaceBet}
                  disabled={!selectedOption || betAmount <= 0}
                  className="flex-1 py-2 text-sm font-semibold uppercase bg-orange-600 hover:bg-orange-700 text-white rounded-sm disabled:opacity-50"
                >
                  {hasExistingBet && prediction.allowAdditionalBets ? 'Add to Bet' : 'Confirm'}
                </button>
              </div>
            </div>
          )}
        </>
      )}

      {isGuest && isActive && <div className={`text-center text-sm ${mutedClass}`}>Sign in to place bets</div>}

      {prediction.resolved && (
        <div
          className={`text-center py-2 rounded-sm mt-2 ${colorOf((prediction.outcomes || [prediction.outcome])[0])?.bg || 'bg-orange-600'} bg-opacity-20`}
        >
          <span
            className={`font-semibold ${colorOf((prediction.outcomes || [prediction.outcome])[0])?.text || 'text-orange-500'}`}
          >
            {(prediction.outcomes?.length ?? 1) > 1 ? 'Winners' : 'Winner'}:{' '}
            {(prediction.outcomes || [prediction.outcome]).join(' & ')}
          </span>
        </div>
      )}

      {isAdmin && prediction.resolved && onHide && (
        <button
          onClick={() => onHide(prediction.id)}
          className="w-full mt-2 py-1 text-xs rounded-sm light:bg-slate-200 light:text-zinc-600 light:hover:bg-slate-300 dark:bg-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-700"
        >
          Hide from feed
        </button>
      )}
    </div>
  );
};

export default PredictionCard;
