import React, { useState } from 'react';
import {
  MARGIN_INTEREST_RATE,
  MARGIN_CALL_GRACE_PERIOD
} from '../../constants';
import { formatCurrency } from '../../utils/formatters';

// Helper functions from App.jsx
const checkMarginEligibility = (userData, isAdmin = false) => {
  if (!userData) return { eligible: false, requirements: [] };

  // Admin bypass - always eligible
  if (isAdmin) {
    return {
      eligible: true,
      requirements: [
        { met: true, label: '10+ daily check-ins', current: '∞', required: 10 },
        { met: true, label: '35+ total trades', current: '∞', required: 35 },
        { met: true, label: '$7,500+ peak portfolio', current: '∞', required: 7500 }
      ]
    };
  }

  const totalCheckins = userData.totalCheckins || 0;
  const totalTrades = userData.totalTrades || 0;
  const peakPortfolio = userData.peakPortfolioValue || 0;

  const requirements = [
    { met: totalCheckins >= 10, label: '10+ daily check-ins', current: totalCheckins, required: 10 },
    { met: totalTrades >= 35, label: '35+ total trades', current: totalTrades, required: 35 },
    { met: peakPortfolio >= 7500, label: '$7,500+ peak portfolio', current: peakPortfolio, required: 7500 }
  ];

  const allMet = requirements.every(r => r.met);

  return {
    eligible: allMet,
    requirements
  };
};

const getMarginTierMultiplier = (peakPortfolioValue) => {
  const peak = peakPortfolioValue || 0;
  if (peak >= 30000) return 0.75;
  if (peak >= 15000) return 0.50;
  if (peak >= 7500) return 0.35;
  return 0.25;
};

const getMarginTierName = (peakPortfolioValue) => {
  const peak = peakPortfolioValue || 0;
  if (peak >= 30000) return 'Platinum (0.75x)';
  if (peak >= 15000) return 'Gold (0.50x)';
  if (peak >= 7500) return 'Silver (0.35x)';
  return 'Bronze (0.25x)';
};

const getCurrentPrice = (ticker, priceHistory, prices) => {
  const history = priceHistory?.[ticker];
  if (history && history.length > 0) {
    return history[history.length - 1].price;
  }
  return prices?.[ticker] || 0;
};

const calculateMarginStatus = (userData, prices, priceHistory = {}) => {
  if (!userData || !userData.marginEnabled) {
    return {
      enabled: false,
      marginUsed: 0,
      availableMargin: 0,
      maxBorrowable: 0,
      tierMultiplier: 0,
      tierName: 'N/A',
      portfolioValue: 0,
      totalMaintenanceRequired: 0,
      equityRatio: 1,
      status: 'disabled'
    };
  }

  const cash = userData.cash || 0;
  const holdings = userData.holdings || {};
  const marginUsed = userData.marginUsed || 0;
  const peakPortfolio = userData.peakPortfolioValue || 0;

  // Get tier multiplier based on peak portfolio achievement
  const tierMultiplier = getMarginTierMultiplier(peakPortfolio);
  const tierName = getMarginTierName(peakPortfolio);

  // Calculate total holdings value and maintenance requirement
  let holdingsValue = 0;
  let totalMaintenanceRequired = 0;

  Object.entries(holdings).forEach(([ticker, shares]) => {
    if (shares > 0) {
      const price = getCurrentPrice(ticker, priceHistory, prices);
      const positionValue = price * shares;
      holdingsValue += positionValue;

      // Use a fixed maintenance ratio
      totalMaintenanceRequired += positionValue * 0.30; // 30% maintenance ratio
    }
  });

  // Portfolio value = cash + holdings - margin debt
  const grossValue = cash + holdingsValue;
  const portfolioValue = grossValue - marginUsed;

  // Equity ratio = portfolio value / gross value (how much you actually own)
  const equityRatio = grossValue > 0 ? portfolioValue / grossValue : 1;

  // Cash-based borrowing with tiered multipliers
  const maxBorrowable = Math.max(0, cash * tierMultiplier);
  const availableMargin = Math.max(0, maxBorrowable - marginUsed);

  // Determine status
  let status = 'safe';
  if (marginUsed > 0) {
    if (equityRatio <= 0.25) {
      status = 'liquidation';
    } else if (equityRatio <= 0.30) {
      status = 'margin_call';
    } else if (equityRatio <= 0.35) {
      status = 'warning';
    }
  }

  return {
    enabled: true,
    marginUsed,
    availableMargin: Math.round(availableMargin * 100) / 100,
    maxBorrowable: Math.round(maxBorrowable * 100) / 100,
    tierMultiplier,
    tierName,
    portfolioValue: Math.round(portfolioValue * 100) / 100,
    grossValue: Math.round(grossValue * 100) / 100,
    holdingsValue: Math.round(holdingsValue * 100) / 100,
    totalMaintenanceRequired: Math.round(totalMaintenanceRequired * 100) / 100,
    equityRatio: Math.round(equityRatio * 1000) / 1000,
    status,
    marginCallAt: userData.marginCallAt || null
  };
};

const MarginModal = ({ onClose, darkMode, userData, prices, priceHistory, onEnableMargin, onDisableMargin, onRepayMargin, isAdmin, enableLoading, disableLoading, repayLoading }) => {
  const [repayAmount, setRepayAmount] = useState(0);
  const [showConfirmEnable, setShowConfirmEnable] = useState(false);

  const cardClass = darkMode ? 'bg-zinc-900 border-zinc-800' : 'bg-white border-amber-200';
  const textClass = darkMode ? 'text-zinc-100' : 'text-slate-900';
  const mutedClass = darkMode ? 'text-zinc-400' : 'text-zinc-600';

  const eligibility = checkMarginEligibility(userData, isAdmin);
  const marginStatus = calculateMarginStatus(userData, prices, priceHistory);

  const colorBlindMode = userData?.colorBlindMode || false;

  const getStatusColor = (status) => {
    switch (status) {
      case 'safe': return colorBlindMode ? 'text-teal-500' : 'text-green-500';
      case 'warning': return 'text-amber-500';
      case 'margin_call': return 'text-orange-500';
      case 'liquidation': return colorBlindMode ? 'text-purple-500' : 'text-red-500';
      default: return mutedClass;
    }
  };

  const getStatusLabel = (status) => {
    switch (status) {
      case 'safe': return '✓ Safe';
      case 'warning': return '⚠️ Warning';
      case 'margin_call': return '🚨 Margin Call';
      case 'liquidation': return '💀 Liquidation Risk';
      default: return 'Disabled';
    }
  };

  const getStatusBg = (status) => {
    switch (status) {
      case 'safe': return colorBlindMode
        ? (darkMode ? 'bg-teal-900/20 border-teal-800' : 'bg-teal-50 border-teal-200')
        : (darkMode ? 'bg-green-900/20 border-green-800' : 'bg-green-50 border-green-200');
      case 'warning': return darkMode ? 'bg-amber-900/20 border-amber-700' : 'bg-amber-50 border-amber-200';
      case 'margin_call': return darkMode ? 'bg-orange-900/30 border-orange-700' : 'bg-orange-50 border-orange-200';
      case 'liquidation': return colorBlindMode
        ? (darkMode ? 'bg-purple-900/30 border-purple-700' : 'bg-purple-50 border-purple-200')
        : (darkMode ? 'bg-red-900/30 border-red-700' : 'bg-red-50 border-red-200');
      default: return darkMode ? 'bg-zinc-800/50' : 'bg-slate-100';
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-50" onClick={onClose}>
      <div
        className={`w-full max-w-md ${cardClass} border rounded-sm shadow-xl overflow-hidden max-h-[85vh] flex flex-col`}
        onClick={e => e.stopPropagation()}
      >
        <div className={`p-4 border-b ${darkMode ? 'border-zinc-800' : 'border-amber-200'} flex justify-between items-center`}>
          <div>
            <h2 className={`text-xl font-bold ${textClass}`}>📊 Margin Trading</h2>
            <p className={`text-sm ${mutedClass}`}>Leverage your portfolio</p>
          </div>
          <button onClick={onClose} className={`p-2 ${mutedClass} hover:text-orange-600 text-xl`}>×</button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {!eligibility.eligible && (marginStatus.marginUsed || 0) === 0 ? (
            // Locked state - show requirements (only if no debt)
            <div className={`p-4 rounded-sm ${darkMode ? 'bg-zinc-800/50' : 'bg-amber-50'}`}>
              <h3 className={`font-semibold mb-2 ${textClass}`}>🔒 Margin Trading Locked</h3>
              <p className={`text-sm ${mutedClass} mb-3`}>Meet these requirements to unlock:</p>
              <div className="space-y-1">
                {eligibility.requirements.map((req, i) => (
                  <div key={i} className={`text-sm flex items-center gap-2 ${req.met ? (colorBlindMode ? 'text-teal-500' : 'text-green-500') : mutedClass}`}>
                    <span>{req.met ? '✓' : '○'}</span>
                    <span>{req.label}</span>
                    {!req.met && <span className="text-xs">({req.current}/{req.required})</span>}
                  </div>
                ))}
              </div>
            </div>
          ) : !marginStatus.enabled ? (
            // Eligible but not enabled
            <div className="space-y-4">
              <div className={`p-4 rounded-sm ${colorBlindMode ? (darkMode ? 'bg-teal-900/20 border border-teal-800' : 'bg-teal-50 border border-teal-200') : (darkMode ? 'bg-green-900/20 border border-green-800' : 'bg-green-50 border border-green-200')}`}>
                <h3 className={`font-semibold mb-2 ${colorBlindMode ? 'text-teal-500' : 'text-green-500'}`}>✓ Eligible for Margin</h3>
                <p className={`text-sm ${mutedClass}`}>
                  You qualify for margin trading! Enable it to access additional buying power.
                </p>
              </div>

              <div className={`p-3 rounded-sm ${darkMode ? 'bg-zinc-800/50' : 'bg-amber-50'}`}>
                <h4 className={`font-semibold mb-2 ${textClass}`}>How Margin Works</h4>
                <p className={`text-xs ${mutedClass} mb-2`}>
                  Margin is <span className="text-orange-500 font-semibold">borrowing power</span> - like a credit card for stocks.
                </p>
                <ul className={`text-xs ${mutedClass} space-y-1`}>
                  <li>• Borrow up to <span className="text-orange-500">25-75%</span> of your cash based on tier</li>
                  <li>• <span className="text-amber-500">Tiers:</span> Bronze (0.25x), Silver (0.35x), Gold (0.50x), Platinum (0.75x)</li>
                  <li>• Tier based on <span className="text-orange-500">peak portfolio achievement</span> (&lt;$7.5k, $7.5k-$15k, $15k-$30k, $30k+)</li>
                  <li>• Only used when your <span className="text-orange-500">cash runs out</span> during a purchase</li>
                  <li>• Pay <span className="text-amber-500">0.5% daily interest</span> on borrowed amount (margin debt)</li>
                  <li>• Sale proceeds <span className="text-orange-500">pay debt first</span>, then become cash</li>
                  <li>• Keep equity <span className="text-orange-500">above 30%</span> or face margin call</li>
                  <li>• <span className={colorBlindMode ? 'text-purple-500' : 'text-red-500'}>Auto-liquidation</span> if equity drops to or below 25%</li>
                </ul>
              </div>

              <div className={`p-3 rounded-sm border ${colorBlindMode ? (darkMode ? 'bg-purple-900/10 border-purple-800' : 'bg-purple-50 border-purple-200') : (darkMode ? 'bg-red-900/10 border-red-800' : 'bg-red-50 border-red-200')}`}>
                <h4 className={`font-semibold mb-1 ${colorBlindMode ? 'text-purple-500' : 'text-red-500'}`}>⚠️ Risk Warning</h4>
                <p className={`text-xs ${mutedClass}`}>
                  Margin trading amplifies both gains AND losses. You can lose more than your initial investment.
                  If your portfolio drops significantly, your positions may be automatically liquidated.
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
                      className={`flex-1 py-2 font-semibold rounded-sm ${darkMode ? 'bg-zinc-700 text-zinc-300' : 'bg-slate-200 text-slate-600'}`}
                    >
                      Cancel
                    </button>
                    <button
                      onClick={() => { onEnableMargin(); setShowConfirmEnable(false); }}
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

                {/* Equity Ratio Bar */}
                <div className="mb-3">
                  <div className="flex justify-between text-xs mb-1">
                    <span className={mutedClass}>Equity Ratio</span>
                    <span className={getStatusColor(marginStatus.status)}>
                      {(marginStatus.equityRatio * 100).toFixed(1)}%
                    </span>
                  </div>
                  <div className={`h-3 rounded-full ${darkMode ? 'bg-zinc-700' : 'bg-zinc-200'} overflow-hidden`}>
                    <div
                      className={`h-full rounded-full transition-all ${
                        marginStatus.equityRatio > 0.35 ? (colorBlindMode ? 'bg-teal-500' : 'bg-green-500') :
                        marginStatus.equityRatio > 0.30 ? 'bg-amber-500' :
                        marginStatus.equityRatio > 0.25 ? 'bg-orange-500' : (colorBlindMode ? 'bg-purple-500' : 'bg-red-500')
                      }`}
                      style={{ width: `${Math.min(100, marginStatus.equityRatio * 100)}%` }}
                    />
                  </div>
                  <div className="flex justify-between text-xs mt-1">
                    <span className={colorBlindMode ? 'text-purple-500' : 'text-red-500'}>25%</span>
                    <span className="text-orange-500">30%</span>
                    <span className="text-amber-500">35%</span>
                    <span className={colorBlindMode ? 'text-teal-500' : 'text-green-500'}>100%</span>
                  </div>
                </div>

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
                    <p className={`font-bold ${colorBlindMode ? 'text-teal-500' : 'text-green-500'}`}>{formatCurrency(marginStatus.availableMargin)}</p>
                  </div>
                  <div>
                    <span className={mutedClass}>Maintenance Req:</span>
                    <p className={`font-bold ${textClass}`}>{formatCurrency(marginStatus.totalMaintenanceRequired)}</p>
                  </div>
                </div>
              </div>

              {/* How It Works Info */}
              <div className={`p-3 rounded-sm ${darkMode ? 'bg-blue-900/20 border border-blue-800' : 'bg-blue-50 border border-blue-200'}`}>
                <h4 className={`font-semibold mb-1 text-blue-500 text-sm`}>💡 How Margin Works</h4>
                <p className={`text-xs ${mutedClass}`}>
                  Margin is borrowing power - it's only used when your <span className="text-orange-500 font-semibold">cash runs out</span> during a purchase.
                  Your tier determines max borrowable: <span className="text-orange-500 font-semibold">{marginStatus.tierName}</span> = {formatCurrency(marginStatus.maxBorrowable)}.
                  When you sell stocks, proceeds <span className="text-orange-500 font-semibold">pay down debt first</span>, then become cash.
                </p>
              </div>

              {/* Margin Call Warning */}
              {marginStatus.status === 'margin_call' && (
                <div className={`p-3 rounded-sm ${darkMode ? 'bg-orange-900/30' : 'bg-orange-50'} border border-orange-500`}>
                  <h4 className="font-bold text-orange-500 mb-1">🚨 Margin Call!</h4>
                  <p className={`text-xs ${mutedClass}`}>
                    Deposit funds or sell positions to bring your equity above 30%.
                    Auto-liquidation occurs at 25% equity.
                  </p>
                  {marginStatus.marginCallAt && (
                    <p className="text-xs text-orange-400 mt-1">
                      Grace period ends: {new Date(marginStatus.marginCallAt + MARGIN_CALL_GRACE_PERIOD).toLocaleString()}
                    </p>
                  )}
                </div>
              )}

              {marginStatus.status === 'liquidation' && (
                <div className={`p-3 rounded-sm ${colorBlindMode ? (darkMode ? 'bg-purple-900/30' : 'bg-purple-50') : (darkMode ? 'bg-red-900/30' : 'bg-red-50')} border ${colorBlindMode ? 'border-purple-500' : 'border-red-500'}`}>
                  <h4 className={`font-bold mb-1 ${colorBlindMode ? 'text-purple-500' : 'text-red-500'}`}>💀 Liquidation Imminent!</h4>
                  <p className={`text-xs ${mutedClass}`}>
                    Your positions will be automatically sold to cover margin debt. Act immediately!
                  </p>
                </div>
              )}

              {/* Repay Margin */}
              {marginStatus.marginUsed > 0 && (
                <div className={`p-3 rounded-sm ${darkMode ? 'bg-zinc-800/50' : 'bg-slate-100'}`}>
                  <h4 className={`font-semibold mb-2 ${textClass}`}>Repay Margin</h4>
                  <div className="flex gap-2 mb-2">
                    <input
                      type="number"
                      min={0}
                      max={Math.min(userData?.cash || 0, marginStatus.marginUsed)}
                      value={repayAmount}
                      onChange={(e) => setRepayAmount(Math.max(0, parseFloat(e.target.value) || 0))}
                      placeholder="Amount"
                      className={`flex-1 px-3 py-2 rounded-sm border text-sm ${
                        darkMode ? 'bg-zinc-950 border-zinc-700 text-zinc-100' : 'bg-white border-amber-200'
                      }`}
                    />
                    <button
                      onClick={() => setRepayAmount(Math.min(userData?.cash || 0, marginStatus.marginUsed))}
                      className={`px-3 py-2 text-xs font-semibold rounded-sm ${
                        darkMode ? 'bg-zinc-700 text-zinc-300' : 'bg-slate-200 text-zinc-600'
                      }`}
                    >
                      Max
                    </button>
                  </div>
                  <p className={`text-xs ${mutedClass} mb-2`}>
                    Your cash: {formatCurrency(userData?.cash || 0)}
                  </p>
                  <button
                    onClick={() => { onRepayMargin(repayAmount); setRepayAmount(0); }}
                    disabled={repayLoading || repayAmount <= 0 || repayAmount > (userData?.cash || 0)}
                    className={`w-full py-2 font-semibold rounded-sm text-white disabled:opacity-50 disabled:cursor-not-allowed ${colorBlindMode ? 'bg-teal-600 hover:bg-teal-700' : 'bg-green-600 hover:bg-green-700'}`}
                  >
                    {repayLoading ? 'Repaying...' : `Repay ${formatCurrency(repayAmount)}`}
                  </button>
                </div>
              )}

              {/* Interest Info */}
              <div className={`p-3 rounded-sm ${darkMode ? 'bg-zinc-800/30' : 'bg-amber-50'}`}>
                <div className="flex items-center gap-2 mb-1">
                  <span>💰</span>
                  <span className={`text-sm font-semibold ${textClass}`}>Daily Interest</span>
                </div>
                <p className={`text-xs ${mutedClass}`}>
                  {marginStatus.marginUsed > 0 ? (
                    <>
                      You're paying <span className="text-amber-500">{formatCurrency(marginStatus.marginUsed * MARGIN_INTEREST_RATE)}/day</span> in interest
                      ({(MARGIN_INTEREST_RATE * 100).toFixed(1)}% of {formatCurrency(marginStatus.marginUsed)})
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
                  className={`w-full py-2 text-sm font-semibold rounded-sm ${
                    darkMode ? 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700' : 'bg-slate-200 text-slate-600 hover:bg-slate-300'
                  } disabled:opacity-50`}
                >
                  {disableLoading ? 'Disabling...' : 'Disable Margin Trading'}
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
