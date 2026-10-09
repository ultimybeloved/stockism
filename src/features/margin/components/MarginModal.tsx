import { useState } from 'react';
import { MARGIN_INTEREST_RATE } from '../../../constants';
import MarginStatusBars from './MarginStatusBars';
import { formatCurrency } from '../../../utils/formatters';
import { checkMarginEligibility, calculateMarginStatus, type MarginStatusLevel } from '../../../utils/calculations';
import { themeClasses } from '../../../utils/theme';
import { useSession, useMarket } from '../../../context/AppContext';

import { useEscapeKey } from '../../../shared/hooks/useEscapeKey';

interface MarginModalProps {
  onClose: () => void;
  onEnableMargin: () => unknown;
  onDisableMargin: () => unknown;
  onRepayMargin: (amount: number) => unknown;
  isAdmin?: boolean;
  enableLoading?: boolean;
  disableLoading?: boolean;
  repayLoading?: boolean;
  onReviewTutorial: () => void;
}

const MarginModal = ({
  onClose,
  onEnableMargin,
  onDisableMargin,
  onRepayMargin,
  isAdmin,
  enableLoading,
  disableLoading,
  repayLoading,
  onReviewTutorial,
}: MarginModalProps) => {
  useEscapeKey(onClose);
  const { userData } = useSession();
  const { prices, priceHistory } = useMarket();
  const [repayAmount, setRepayAmount] = useState(0);
  const [showConfirmEnable, setShowConfirmEnable] = useState(false);

  const { textClass, mutedClass, overlayClass, modalShellClass, cardEdgeClass } = themeClasses;

  const eligibility = checkMarginEligibility(userData, isAdmin);
  const marginStatus = calculateMarginStatus(userData, prices, priceHistory);

  const colorBlindMode = userData?.colorBlindMode || false;

  const getStatusColor = (status: MarginStatusLevel) => {
    switch (status) {
      case 'safe':
        return colorBlindMode ? 'text-teal-500' : 'text-green-500';
      case 'warning':
        return 'text-amber-500';
      case 'danger':
        return 'text-orange-500';
      case 'margin_call':
        return colorBlindMode ? 'text-purple-500' : 'text-red-500';
      case 'liquidation':
        return colorBlindMode ? 'text-purple-500' : 'text-red-500';
      default:
        return mutedClass;
    }
  };

  const getStatusLabel = (status: MarginStatusLevel) => {
    switch (status) {
      case 'safe':
        return '✓ Safe';
      case 'warning':
        return '⚠️ Warning';
      case 'danger':
        return '🔴 Danger Zone';
      case 'margin_call':
        return '🚨 Margin Call';
      case 'liquidation':
        return '💀 Liquidation Imminent';
      default:
        return 'Disabled';
    }
  };

  const getStatusBg = (status: MarginStatusLevel) => {
    switch (status) {
      case 'safe':
        return colorBlindMode
          ? 'light:bg-teal-50 light:border-teal-200 dark:bg-teal-900/20 dark:border-teal-800'
          : 'light:bg-green-50 light:border-green-200 dark:bg-green-900/20 dark:border-green-800';
      case 'warning':
        return 'light:bg-amber-50 light:border-amber-200 dark:bg-amber-900/20 dark:border-amber-700';
      case 'danger':
        return 'light:bg-orange-50 light:border-orange-200 dark:bg-orange-900/30 dark:border-orange-700';
      case 'margin_call':
        return colorBlindMode
          ? 'light:bg-purple-50 light:border-purple-200 dark:bg-purple-900/30 dark:border-purple-700'
          : 'light:bg-red-50 light:border-red-200 dark:bg-red-900/30 dark:border-red-700';
      case 'liquidation':
        return colorBlindMode
          ? 'light:bg-purple-50 light:border-purple-200 dark:bg-purple-900/30 dark:border-purple-700'
          : 'light:bg-red-50 light:border-red-200 dark:bg-red-900/30 dark:border-red-700';
      default:
        return 'light:bg-slate-100 dark:bg-zinc-800/50';
    }
  };

  return (
    <div className={`${overlayClass} z-50`} onClick={onClose}>
      <div
        className={`${modalShellClass} max-w-md overflow-hidden max-h-[85vh] flex flex-col`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className={`p-4 border-b ${cardEdgeClass} flex justify-between items-center`}>
          <div>
            <h2 className={`text-xl font-bold ${textClass}`}>📊 Margin Trading</h2>
            <p className={`text-sm ${mutedClass}`}>Leverage your portfolio</p>
          </div>
          <button onClick={onClose} className={`p-2 ${mutedClass} hover:text-orange-500 text-xl`}>
            ×
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {!eligibility.eligible && (marginStatus.marginUsed || 0) === 0 ? (
            // Locked state - show requirements (only if no debt)
            <div className="p-4 rounded-sm light:bg-amber-50 dark:bg-zinc-800/50">
              <h3 className={`font-semibold mb-2 ${textClass}`}>🔒 Margin Trading Locked</h3>
              <p className={`text-sm ${mutedClass} mb-3`}>Meet these requirements to unlock:</p>
              <div className="space-y-1">
                {eligibility.requirements.map((req, i) => (
                  <div
                    key={i}
                    className={`text-sm flex items-center gap-2 ${req.met ? (colorBlindMode ? 'text-teal-500' : 'text-green-500') : mutedClass}`}
                  >
                    <span>{req.met ? '✓' : '○'}</span>
                    <span>{req.label}</span>
                    {!req.met && (
                      <span className="text-xs">
                        ({req.current}/{req.required})
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ) : !marginStatus.enabled ? (
            // Eligible but not enabled
            <div className="space-y-4">
              <div
                className={`p-4 rounded-sm ${colorBlindMode ? 'light:bg-teal-50 light:border light:border-teal-200 dark:bg-teal-900/20 dark:border dark:border-teal-800' : 'light:bg-green-50 light:border light:border-green-200 dark:bg-green-900/20 dark:border dark:border-green-800'}`}
              >
                <h3 className={`font-semibold mb-2 ${colorBlindMode ? 'text-teal-500' : 'text-green-500'}`}>
                  ✓ Eligible for Margin
                </h3>
                <p className={`text-sm ${mutedClass}`}>
                  You qualify for margin trading! Enable it to access additional buying power.
                </p>
              </div>

              <div className="p-3 rounded-sm light:bg-amber-50 dark:bg-zinc-800/50">
                <h4 className={`font-semibold mb-2 ${textClass}`}>How Margin Works</h4>
                <p className={`text-xs ${mutedClass} mb-2`}>
                  Margin is <span className="text-orange-500 font-semibold">borrowing power</span> - like a credit card
                  for stocks.
                </p>
                <ul className={`text-xs ${mutedClass} space-y-1`}>
                  <li>
                    • Borrow up to <span className="text-orange-500">25-75%</span> of your cash based on tier
                  </li>
                  <li>
                    • <span className="text-amber-500">Tiers:</span> Bronze (0.25x), Silver (0.35x), Gold (0.50x),
                    Platinum (0.75x)
                  </li>
                  <li>
                    • Tier based on <span className="text-orange-500">peak portfolio achievement</span> (&lt;$7.5k,
                    $7.5k-$15k, $15k-$30k, $30k+)
                  </li>
                  <li>
                    • Only used when your <span className="text-orange-500">cash runs out</span> during a purchase
                  </li>
                  <li>
                    • <span className="text-amber-500">0.5% daily interest</span> is added to your debt, not taken from
                    your cash
                  </li>
                  <li>
                    • Sale proceeds <span className="text-orange-500">become cash</span> directly
                  </li>
                  <li>
                    • Keep equity <span className="text-orange-500">above 30%</span> or face margin call
                  </li>
                  <li>
                    • <span className={colorBlindMode ? 'text-purple-500' : 'text-red-500'}>Auto-liquidation</span> if
                    equity drops to or below 25%
                  </li>
                </ul>
              </div>

              <div
                className={`p-3 rounded-sm border ${colorBlindMode ? 'light:bg-purple-50 light:border-purple-200 dark:bg-purple-900/10 dark:border-purple-800' : 'light:bg-red-50 light:border-red-200 dark:bg-red-900/10 dark:border-red-800'}`}
              >
                <h4 className={`font-semibold mb-1 ${colorBlindMode ? 'text-purple-500' : 'text-red-500'}`}>
                  ⚠️ Risk Warning
                </h4>
                <p className={`text-xs ${mutedClass}`}>
                  Margin trading amplifies both gains AND losses. You can lose more than your initial investment. If
                  your portfolio drops significantly, your positions may be automatically liquidated.
                </p>
              </div>

              {!showConfirmEnable ? (
                <button
                  onClick={() => setShowConfirmEnable(true)}
                  className="w-full py-3 font-semibold rounded-sm bg-orange-600 hover:bg-orange-700 text-white"
                >
                  Enable Margin Trading
                </button>
              ) : (
                <div className="space-y-2">
                  <p className={`text-sm text-center ${textClass}`}>Are you sure? This enables borrowing.</p>
                  <div className="flex gap-2">
                    <button
                      onClick={() => setShowConfirmEnable(false)}
                      className="flex-1 py-2 font-semibold rounded-sm light:bg-slate-200 light:text-slate-600 dark:bg-zinc-700 dark:text-zinc-300"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={() => {
                        onEnableMargin();
                        setShowConfirmEnable(false);
                      }}
                      disabled={enableLoading}
                      className="flex-1 py-2 font-semibold rounded-sm bg-orange-600 hover:bg-orange-700 text-white disabled:opacity-50"
                    >
                      {enableLoading ? 'Enabling...' : 'Yes, Enable'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          ) : (
            // Margin enabled - show status
            <div className="space-y-4">
              {/* Status Card */}
              <div className={`p-4 rounded-sm border ${getStatusBg(marginStatus.status)}`}>
                <div className="flex justify-between items-center mb-3">
                  <span className={`font-semibold ${textClass}`}>Margin Status</span>
                  <span className={`font-bold ${getStatusColor(marginStatus.status)}`}>
                    {getStatusLabel(marginStatus.status)}
                  </span>
                </div>

                <MarginStatusBars marginStatus={marginStatus} statusColorClass={getStatusColor(marginStatus.status)} />

                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div>
                    <span className={mutedClass}>Portfolio Value:</span>
                    <p className={`font-bold ${textClass}`}>{formatCurrency(marginStatus.portfolioValue)}</p>
                  </div>
                  <div>
                    <span className={mutedClass}>Margin Used:</span>
                    <p className={`font-bold ${marginStatus.marginUsed > 0 ? 'text-amber-500' : textClass}`}>
                      {formatCurrency(marginStatus.marginUsed)}
                    </p>
                  </div>
                  <div>
                    <span className={mutedClass}>Available Margin:</span>
                    <p className={`font-bold ${colorBlindMode ? 'text-teal-500' : 'text-green-500'}`}>
                      {formatCurrency(marginStatus.availableMargin)}
                    </p>
                  </div>
                  <div>
                    <span className={mutedClass}>Maintenance Req:</span>
                    <p className={`font-bold ${textClass}`}>{formatCurrency(marginStatus.totalMaintenanceRequired)}</p>
                  </div>
                </div>
              </div>

              {/* How It Works Info */}
              <div className="p-3 rounded-sm light:bg-blue-50 light:border light:border-blue-200 dark:bg-blue-900/20 dark:border dark:border-blue-800">
                <h4 className="font-semibold mb-1 text-blue-500 text-sm">💡 How Margin Works</h4>
                <p className={`text-xs ${mutedClass}`}>
                  Margin is borrowing power. It's only used when your{' '}
                  <span className="text-orange-500 font-semibold">cash runs out</span> during a purchase. Your limit is{' '}
                  <span className="text-orange-500 font-semibold">{marginStatus.tierName}</span> of your invested value:
                  cash, plus what you've put into your stocks (counted at what you paid, capped at current value), minus
                  debt. Right now that base is{' '}
                  <span className="text-orange-500 font-semibold">{formatCurrency(marginStatus.borrowBase)}</span>.
                  Unrealized gains don't count, so pumping a stock you hold won't raise your limit. Selling stocks turns
                  proceeds <span className="text-orange-500 font-semibold">into cash</span> directly.
                </p>
              </div>

              {/* Margin Call Warning */}
              {marginStatus.status === 'margin_call' && (
                <div className="p-3 rounded-sm light:bg-orange-50 dark:bg-orange-900/30 border border-orange-500">
                  <h4 className="font-bold text-orange-500 mb-1">🚨 Margin Call!</h4>
                  <p className={`text-xs ${mutedClass}`}>
                    Deposit funds or sell positions to bring your equity above 30%. Auto-liquidation occurs at 25%
                    equity.
                  </p>
                  <p className="text-xs text-orange-400 mt-1">
                    There is no deadline. Nothing is sold while you stay above 25%.
                  </p>
                </div>
              )}

              {marginStatus.status === 'liquidation' && (
                <div
                  className={`p-3 rounded-sm ${colorBlindMode ? 'light:bg-purple-50 dark:bg-purple-900/30' : 'light:bg-red-50 dark:bg-red-900/30'} border ${colorBlindMode ? 'border-purple-500' : 'border-red-500'}`}
                >
                  <h4 className={`font-bold mb-1 ${colorBlindMode ? 'text-purple-500' : 'text-red-500'}`}>
                    💀 Liquidation Imminent!
                  </h4>
                  <p className={`text-xs ${mutedClass}`}>
                    Your positions will be automatically sold to cover margin debt. Act immediately!
                  </p>
                </div>
              )}

              {/* Repay Margin */}
              {marginStatus.marginUsed > 0 && (
                <div className="p-3 rounded-sm light:bg-slate-100 dark:bg-zinc-800/50">
                  <h4 className={`font-semibold mb-2 ${textClass}`}>Repay Margin</h4>
                  <div className="flex gap-2 mb-2">
                    <input
                      type="number"
                      min={0}
                      max={Math.min(userData?.cash || 0, marginStatus.marginUsed)}
                      value={repayAmount}
                      onChange={(e) => setRepayAmount(Math.max(0, parseFloat(e.target.value) || 0))}
                      placeholder="Amount"
                      className="flex-1 px-3 py-2 rounded-sm border text-sm light:bg-white light:border-amber-200 dark:bg-zinc-950 dark:border-zinc-700 dark:text-zinc-100"
                    />
                    <button
                      onClick={() => setRepayAmount(Math.min(userData?.cash || 0, marginStatus.marginUsed))}
                      className="px-3 py-2 text-xs font-semibold rounded-sm light:bg-slate-200 light:text-zinc-600 dark:bg-zinc-700 dark:text-zinc-300"
                    >
                      Max
                    </button>
                  </div>
                  <p className={`text-xs ${mutedClass} mb-2`}>Your cash: {formatCurrency(userData?.cash || 0)}</p>
                  <button
                    onClick={() => {
                      onRepayMargin(repayAmount);
                      setRepayAmount(0);
                    }}
                    disabled={repayLoading || repayAmount <= 0 || repayAmount > (userData?.cash || 0)}
                    className={`w-full py-2 font-semibold rounded-sm text-white disabled:opacity-50 disabled:cursor-not-allowed ${colorBlindMode ? 'bg-teal-600 hover:bg-teal-700' : 'bg-green-600 hover:bg-green-700'}`}
                  >
                    {repayLoading ? 'Repaying...' : `Repay ${formatCurrency(repayAmount)}`}
                  </button>
                </div>
              )}

              {/* Interest Info */}
              <div className="p-3 rounded-sm light:bg-amber-50 dark:bg-zinc-800/30">
                <div className="flex items-center gap-2 mb-1">
                  <span>💰</span>
                  <span className={`text-sm font-semibold ${textClass}`}>Daily Interest</span>
                </div>
                <p className={`text-xs ${mutedClass}`}>
                  {marginStatus.marginUsed > 0 ? (
                    <>
                      <span className="text-amber-500">
                        {formatCurrency(marginStatus.marginUsed * MARGIN_INTEREST_RATE)}/day
                      </span>{' '}
                      is added to your debt ({(MARGIN_INTEREST_RATE * 100).toFixed(1)}% of{' '}
                      {formatCurrency(marginStatus.marginUsed)}). It is not taken from your cash.
                    </>
                  ) : (
                    <>No interest charged when not using margin</>
                  )}
                </p>
              </div>

              {/* Disable Margin */}
              {(marginStatus.marginUsed || 0) < 0.01 && (
                <button
                  onClick={onDisableMargin}
                  disabled={disableLoading}
                  className="w-full py-2 text-sm font-semibold rounded-sm light:bg-slate-200 light:text-slate-600 light:hover:bg-slate-300 dark:bg-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-700 disabled:opacity-50"
                >
                  {disableLoading ? 'Disabling...' : 'Disable Margin Trading'}
                </button>
              )}

              {onReviewTutorial && (
                <button
                  onClick={onReviewTutorial}
                  className={`w-full py-2 text-xs ${mutedClass} hover:text-orange-500 transition-colors`}
                >
                  Review safety guide →
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default MarginModal;
