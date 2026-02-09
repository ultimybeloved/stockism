import React, { useState, useEffect } from 'react';
import { DAILY_MISSIONS, WEEKLY_MISSIONS, CREW_MAP, CREWS } from '../../crews';
import { getWeekId, getCrewWeeklyMissions } from '../../crews';
import { db } from '../../firebase';
import { formatCurrency } from '../../utils/formatters';
import { getTodayDateString } from '../../utils/date';

const DailyMissionsModal = ({ onClose, darkMode, userData, prices, onClaimReward, onClaimWeeklyReward, portfolioValue, isGuest, claimLoading, claimWeeklyLoading }) => {
  const [activeTab, setActiveTab] = useState('daily');

  const cardClass = darkMode ? 'bg-zinc-900 border-zinc-800' : 'bg-white border-amber-200';
  const textClass = darkMode ? 'text-zinc-100' : 'text-slate-900';
  const mutedClass = darkMode ? 'text-zinc-400' : 'text-zinc-500';

  const today = getTodayDateString();
  const weekId = getWeekId();
  const dailyProgress = userData?.dailyMissions?.[today] || {};
  const weeklyProgress = userData?.weeklyMissions?.[weekId] || {};
  const userCrew = userData?.crew;
  const crewMembers = userCrew ? CREW_MAP[userCrew]?.members || [] : [];

  // Seeded random to pick 3 missions consistently for the day, varying by crew
  const getDailyMissions = () => {
    const allMissions = Object.values(DAILY_MISSIONS);

    // Create seed from date + crew ID for crew-specific missions
    // Users without a crew get a default seed
    const dateSeed = today.split('-').reduce((acc, num) => acc + parseInt(num), 0);
    const crewSeed = userCrew ? userCrew.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0) : 0;
    const seed = dateSeed + crewSeed;

    // Fisher-Yates shuffle with seeded random
    const shuffled = [...allMissions];
    let currentSeed = seed;
    const seededRandom = () => {
      currentSeed = (currentSeed * 9301 + 49297) % 233280;
      return currentSeed / 233280;
    };

    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(seededRandom() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }

    return shuffled.slice(0, 3);
  };

  const todaysMissions = getDailyMissions();

  // Helper to get all crew tickers a character belongs to
  const getCharacterCrews = (ticker) => {
    const crews = [];
    Object.values(CREWS).forEach(crew => {
      if (crew.members.includes(ticker)) {
        crews.push(crew.id);
      }
    });
    return crews;
  };

  // Calculate mission progress
  const getMissionProgress = (mission) => {
    const holdings = userData?.holdings || {};

    switch (mission.checkType) {
      // ============================================
      // ORIGINAL 3
      // ============================================
      case 'BUY_CREW': {
        const bought = dailyProgress.boughtCrewMember || false;
        return { complete: bought, progress: bought ? 1 : 0, target: 1 };
      }
      case 'HOLD_CREW': {
        const totalShares = crewMembers.reduce((sum, ticker) => {
          return sum + (holdings[ticker] || 0);
        }, 0);
        return {
          complete: totalShares >= mission.requirement,
          progress: totalShares,
          target: mission.requirement
        };
      }
      case 'TRADE_COUNT': {
        const trades = dailyProgress.tradesCount || 0;
        return {
          complete: trades >= mission.requirement,
          progress: trades,
          target: mission.requirement
        };
      }

      // ============================================
      // GENERAL TRADING
      // ============================================
      case 'BUY_ANY': {
        const bought = dailyProgress.boughtAny || false;
        return { complete: bought, progress: bought ? 1 : 0, target: 1 };
      }
      case 'SELL_ANY': {
        const sold = dailyProgress.soldAny || false;
        return { complete: sold, progress: sold ? 1 : 0, target: 1 };
      }
      case 'HOLD_LARGE': {
        const maxHolding = Math.max(0, ...Object.values(holdings));
        return {
          complete: maxHolding >= mission.requirement,
          progress: maxHolding,
          target: mission.requirement
        };
      }
      case 'TRADE_VOLUME': {
        const volume = dailyProgress.tradeVolume || 0;
        return {
          complete: volume >= mission.requirement,
          progress: volume,
          target: mission.requirement
        };
      }

      // ============================================
      // CREW LOYALTY
      // ============================================
      case 'CREW_MAJORITY': {
        // 50%+ of holdings in crew members
        const totalShares = Object.values(holdings).reduce((sum, s) => sum + s, 0);
        const crewShares = crewMembers.reduce((sum, ticker) => sum + (holdings[ticker] || 0), 0);
        const percent = totalShares > 0 ? (crewShares / totalShares) * 100 : 0;
        return {
          complete: percent >= mission.requirement,
          progress: Math.floor(percent),
          target: mission.requirement
        };
      }
      case 'CREW_COLLECTOR': {
        // Own shares of 3+ different crew members
        const ownedCrewMembers = crewMembers.filter(ticker => (holdings[ticker] || 0) > 0).length;
        return {
          complete: ownedCrewMembers >= mission.requirement,
          progress: ownedCrewMembers,
          target: mission.requirement
        };
      }
      case 'FULL_ROSTER': {
        // Own at least 1 share of every crew member
        const ownedCrewMembers = crewMembers.filter(ticker => (holdings[ticker] || 0) > 0).length;
        const totalCrewMembers = crewMembers.length;
        return {
          complete: ownedCrewMembers >= totalCrewMembers && totalCrewMembers > 0,
          progress: ownedCrewMembers,
          target: totalCrewMembers
        };
      }
      case 'CREW_LEADER': {
        // This would require checking against all users - simplified to high holding
        // For now, check if user owns 20+ of any crew member
        const maxCrewHolding = Math.max(0, ...crewMembers.map(ticker => holdings[ticker] || 0));
        return {
          complete: maxCrewHolding >= 20,
          progress: maxCrewHolding,
          target: 20
        };
      }

      // ============================================
      // CREW VS CREW
      // ============================================
      case 'RIVAL_TRADER': {
        // Bought shares of a non-crew member today
        const bought = dailyProgress.boughtRival || false;
        return { complete: bought, progress: bought ? 1 : 0, target: 1 };
      }
      case 'SPY_GAME': {
        // Own shares in 3+ different crews
        const crewsOwned = new Set();
        Object.entries(holdings).forEach(([ticker, shares]) => {
          if (shares > 0) {
            getCharacterCrews(ticker).forEach(crewId => crewsOwned.add(crewId));
          }
        });
        return {
          complete: crewsOwned.size >= mission.requirement,
          progress: crewsOwned.size,
          target: mission.requirement
        };
      }

      // ============================================
      // CHARACTER-SPECIFIC
      // ============================================
      case 'TOP_DOG': {
        // Own shares of the highest-priced character
        let highestTicker = null;
        let highestPrice = 0;
        Object.entries(prices).forEach(([ticker, price]) => {
          if (price > highestPrice) {
            highestPrice = price;
            highestTicker = ticker;
          }
        });
        const ownsTopDog = highestTicker && (holdings[highestTicker] || 0) > 0;
        return { complete: ownsTopDog, progress: ownsTopDog ? 1 : 0, target: 1 };
      }
      case 'UNDERDOG_INVESTOR': {
        // Bought a character priced under $20 today
        const bought = dailyProgress.boughtUnderdog || false;
        return { complete: bought, progress: bought ? 1 : 0, target: 1 };
      }
      case 'WHALE_WATCH': {
        // Own 50+ shares of any single character
        const maxHolding = Math.max(0, ...Object.values(holdings));
        return {
          complete: maxHolding >= mission.requirement,
          progress: maxHolding,
          target: mission.requirement
        };
      }

      // ============================================
      // CREW VALUE
      // ============================================
      case 'BALANCED_CREW': {
        // Own at least 5 shares of 2+ different crew members
        const qualifyingMembers = crewMembers.filter(ticker => (holdings[ticker] || 0) >= 5).length;
        return {
          complete: qualifyingMembers >= mission.requirement,
          progress: qualifyingMembers,
          target: mission.requirement
        };
      }
      case 'CREW_ACCUMULATOR': {
        // Bought 10+ total shares of crew members today
        const crewSharesBought = dailyProgress.crewSharesBought || 0;
        return {
          complete: crewSharesBought >= mission.requirement,
          progress: crewSharesBought,
          target: mission.requirement
        };
      }

      default:
        return { complete: false, progress: 0, target: 1 };
    }
  };

  const missions = todaysMissions.map(mission => ({
    ...mission,
    ...getMissionProgress(mission),
    claimed: dailyProgress.claimed?.[mission.id] || false
  }));

  const totalRewards = missions.reduce((sum, m) => sum + m.reward, 0);
  const earnedRewards = missions.filter(m => m.complete && m.claimed).reduce((sum, m) => sum + m.reward, 0);
  const claimableRewards = missions.filter(m => m.complete && !m.claimed).reduce((sum, m) => sum + m.reward, 0);

  // ============================================
  // WEEKLY MISSIONS
  // ============================================

  // Get this crew's 2 weekly missions
  const thisWeeksMissions = userCrew ? getCrewWeeklyMissions(userCrew, weekId) : [];

  // Helper to get all crew tickers a character belongs to (for weekly too)
  const getCharacterCrewsForWeekly = (ticker) => {
    const crews = [];
    Object.values(CREWS).forEach(crew => {
      if (crew.members.includes(ticker)) {
        crews.push(crew.id);
      }
    });
    return crews;
  };

  // Calculate weekly mission progress
  const getWeeklyMissionProgress = (mission) => {
    const holdings = userData?.holdings || {};
    const wp = weeklyProgress; // shorthand

    switch (mission.checkType) {
      // ============================================
      // TRADING VOLUME
      // ============================================
      case 'WEEKLY_TRADE_VALUE': {
        const value = wp.tradeValue || 0;
        return {
          complete: value >= mission.requirement,
          progress: Math.floor(value),
          target: mission.requirement
        };
      }
      case 'WEEKLY_TRADE_VOLUME': {
        const volume = wp.tradeVolume || 0;
        return {
          complete: volume >= mission.requirement,
          progress: volume,
          target: mission.requirement
        };
      }
      case 'WEEKLY_TRADE_COUNT': {
        const count = wp.tradeCount || 0;
        return {
          complete: count >= mission.requirement,
          progress: count,
          target: mission.requirement
        };
      }

      // ============================================
      // CONSISTENCY
      // ============================================
      case 'WEEKLY_TRADING_DAYS': {
        const days = Object.keys(wp.tradingDays || {}).length;
        return {
          complete: days >= mission.requirement,
          progress: days,
          target: mission.requirement
        };
      }
      case 'WEEKLY_CHECKIN_STREAK': {
        const days = Object.keys(wp.checkinDays || {}).length;
        return {
          complete: days >= mission.requirement,
          progress: days,
          target: mission.requirement
        };
      }

      // ============================================
      // CREW LOYALTY
      // ============================================
      case 'WEEKLY_CREW_PERCENT': {
        // Calculate % of portfolio in crew members by value
        let totalValue = 0;
        let crewValue = 0;
        Object.entries(holdings).forEach(([ticker, shares]) => {
          if (shares > 0) {
            const price = prices[ticker] || 0;
            const value = shares * price;
            totalValue += value;
            if (crewMembers.includes(ticker)) {
              crewValue += value;
            }
          }
        });
        const percent = totalValue > 0 ? (crewValue / totalValue) * 100 : 0;
        return {
          complete: percent >= mission.requirement,
          progress: Math.floor(percent),
          target: mission.requirement
        };
      }
      case 'WEEKLY_CREW_SHARES': {
        const totalCrewShares = crewMembers.reduce((sum, ticker) => sum + (holdings[ticker] || 0), 0);
        return {
          complete: totalCrewShares >= mission.requirement,
          progress: totalCrewShares,
          target: mission.requirement
        };
      }
      case 'WEEKLY_FULL_CREW': {
        // Own 5+ shares of EVERY crew member
        const qualifyingMembers = crewMembers.filter(ticker => (holdings[ticker] || 0) >= mission.requirement).length;
        const totalMembers = crewMembers.length;
        return {
          complete: qualifyingMembers >= totalMembers && totalMembers > 0,
          progress: qualifyingMembers,
          target: totalMembers
        };
      }

      // ============================================
      // PORTFOLIO
      // ============================================
      case 'WEEKLY_CREW_DIVERSITY': {
        // Own shares in 5+ different crews
        const crewsOwned = new Set();
        Object.entries(holdings).forEach(([ticker, shares]) => {
          if (shares > 0) {
            getCharacterCrewsForWeekly(ticker).forEach(crewId => crewsOwned.add(crewId));
          }
        });
        return {
          complete: crewsOwned.size >= mission.requirement,
          progress: crewsOwned.size,
          target: mission.requirement
        };
      }
      case 'WEEKLY_PORTFOLIO_GROWTH': {
        const startValue = wp.startPortfolioValue || portfolioValue;
        const growth = portfolioValue - startValue;
        return {
          complete: growth >= mission.requirement,
          progress: Math.max(0, Math.floor(growth)),
          target: mission.requirement
        };
      }

      case 'WEEKLY_TOTAL_SHARES': {
        const totalShares = Object.values(holdings).reduce((sum, s) => sum + (s > 0 ? s : 0), 0);
        return {
          complete: totalShares >= mission.requirement,
          progress: totalShares,
          target: mission.requirement
        };
      }
      case 'WEEKLY_PENNY_SHARES': {
        let pennyShares = 0;
        Object.entries(holdings).forEach(([ticker, shares]) => {
          if (shares > 0 && (prices[ticker] || 0) < 25) {
            pennyShares += shares;
          }
        });
        return {
          complete: pennyShares >= mission.requirement,
          progress: pennyShares,
          target: mission.requirement
        };
      }
      case 'WEEKLY_BLUE_CHIPS': {
        let blueChipCount = 0;
        Object.entries(holdings).forEach(([ticker, shares]) => {
          if (shares > 0 && (prices[ticker] || 0) > 100) {
            blueChipCount++;
          }
        });
        return {
          complete: blueChipCount >= mission.requirement,
          progress: blueChipCount,
          target: mission.requirement
        };
      }
      case 'WEEKLY_SHORT_COUNT': {
        const shorts = userData?.shorts || {};
        const activeShorts = Object.values(shorts).filter(p => p && p.shares > 0).length;
        return {
          complete: activeShorts >= mission.requirement,
          progress: activeShorts,
          target: mission.requirement
        };
      }

      default:
        return { complete: false, progress: 0, target: 1 };
    }
  };

  const weeklyMissions = thisWeeksMissions.map(mission => ({
    ...mission,
    ...getWeeklyMissionProgress(mission),
    claimed: weeklyProgress.claimed?.[mission.id] || false
  }));

  const weeklyTotalRewards = weeklyMissions.reduce((sum, m) => sum + m.reward, 0);
  const weeklyEarnedRewards = weeklyMissions.filter(m => m.complete && m.claimed).reduce((sum, m) => sum + m.reward, 0);
  const weeklyClaimableRewards = weeklyMissions.filter(m => m.complete && !m.claimed).reduce((sum, m) => sum + m.reward, 0);

  // Days until week resets (next Monday)
  const getDaysUntilReset = () => {
    const now = new Date();
    const day = now.getDay();
    const daysUntilMonday = day === 0 ? 1 : (8 - day);
    return daysUntilMonday;
  };

  // Check if user has no crew
  const noCrew = !userCrew;

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-50" onClick={onClose}>
      <div className={`w-full max-w-md ${cardClass} border rounded-sm shadow-xl overflow-hidden`}
        onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div className={`p-4 border-b ${darkMode ? 'border-zinc-800' : 'border-amber-200'}`}>
          <div className="flex justify-between items-center">
            <h2 className={`text-lg font-semibold ${textClass}`}>📋 Missions</h2>
            <button onClick={onClose} className={`p-2 ${mutedClass} hover:text-orange-600 text-xl`}>×</button>
          </div>
        </div>

        {/* Tabs */}
        <div className={`grid grid-cols-2 border-b ${darkMode ? 'border-zinc-800' : 'border-amber-200'}`}>
          <button
            onClick={() => setActiveTab('daily')}
            className={`py-2.5 text-sm font-semibold transition-colors ${
              activeTab === 'daily'
                ? 'text-orange-500 border-b-2 border-orange-500 bg-orange-500/10'
                : `${mutedClass} hover:bg-slate-500/10`
            }`}
          >
            Daily {claimableRewards > 0 && <span className={`ml-1 ${userData?.colorBlindMode ? 'text-teal-500' : 'text-green-500'}`}>●</span>}
          </button>
          <button
            onClick={() => setActiveTab('weekly')}
            className={`py-2.5 text-sm font-semibold transition-colors ${
              activeTab === 'weekly'
                ? 'text-purple-500 border-b-2 border-purple-500 bg-purple-500/10'
                : `${mutedClass} hover:bg-slate-500/10`
            }`}
          >
            Weekly {weeklyClaimableRewards > 0 && <span className={`ml-1 ${userData?.colorBlindMode ? 'text-teal-500' : 'text-green-500'}`}>●</span>}
          </button>
        </div>

        {/* Subheader */}
        {!isGuest && !noCrew && (
          <div className={`px-4 py-2 ${darkMode ? 'bg-zinc-800/50' : 'bg-amber-50'}`}>
            {activeTab === 'daily' ? (
              <p className={`text-xs ${mutedClass}`}>
                Resets daily • Earned: <span className="text-orange-500">{formatCurrency(earnedRewards)}</span> / {formatCurrency(totalRewards)}
              </p>
            ) : (
              <p className={`text-xs ${mutedClass}`}>
                Resets Monday • {getDaysUntilReset()} days left • Earned: <span className="text-purple-500">{formatCurrency(weeklyEarnedRewards)}</span> / {formatCurrency(weeklyTotalRewards)}
              </p>
            )}
          </div>
        )}

        <div className="p-4 space-y-3 max-h-96 overflow-y-auto">
          {isGuest ? (
            <div className={`p-4 rounded-sm ${darkMode ? 'bg-zinc-800/50' : 'bg-amber-50'} text-center`}>
              <p className={`text-amber-500 mb-2`}>Sign in to access missions!</p>
              <p className={`text-xs ${mutedClass}`}>Complete missions to earn bonus cash rewards.</p>
            </div>
          ) : noCrew ? (
            <div className={`p-4 rounded-sm ${darkMode ? 'bg-zinc-800/50' : 'bg-amber-50'} text-center`}>
              <p className={`${mutedClass} mb-2`}>Join a crew to unlock missions!</p>
              <p className={`text-xs ${mutedClass}`}>Crew missions give you bonus cash rewards.</p>
            </div>
          ) : activeTab === 'daily' ? (
            <>
              {missions.map(mission => (
                <div
                  key={mission.id}
                  className={`p-3 rounded-sm border ${
                    mission.claimed
                      ? 'border-orange-500/30 bg-orange-500/5'
                      : mission.complete
                        ? 'border-orange-500 bg-orange-500/10'
                        : darkMode ? 'border-zinc-700' : 'border-amber-200'
                  }`}
                >
                  <div className="flex justify-between items-start mb-2">
                    <div>
                      <h3 className={`font-semibold ${textClass}`}>{mission.name}</h3>
                      <p className={`text-xs ${mutedClass}`}>{mission.description}</p>
                    </div>
                    <span className={`text-sm font-bold ${mission.complete ? 'text-orange-500' : mutedClass}`}>
                      +{formatCurrency(mission.reward)}
                    </span>
                  </div>

                  {/* Progress bar */}
                  <div className="flex items-center gap-2">
                    <div className={`flex-1 h-2 rounded-full ${darkMode ? 'bg-zinc-800' : 'bg-slate-200'}`}>
                      <div
                        className={`h-full rounded-full transition-all ${mission.complete ? 'bg-orange-500' : 'bg-amber-500'}`}
                        style={{ width: `${Math.min(100, (mission.progress / mission.target) * 100)}%` }}
                      />
                    </div>
                    <span className={`text-xs ${mutedClass} w-12 text-right`}>
                      {mission.progress}/{mission.target}
                    </span>
                  </div>

                  {/* Claim button */}
                  {mission.complete && !mission.claimed && (
                    <button
                      onClick={() => onClaimReward(mission.id, mission.reward)}
                      disabled={claimLoading}
                      className="w-full mt-2 py-1.5 text-sm font-semibold rounded-sm bg-orange-600 hover:bg-orange-700 text-white disabled:opacity-50"
                    >
                      {claimLoading ? 'Claiming...' : 'Claim Reward'}
                    </button>
                  )}
                  {mission.claimed && (
                    <p className="text-xs text-orange-500 mt-2 text-center">✓ Claimed</p>
                  )}
                </div>
              ))}

              {/* Crew member hint */}
              <div className={`p-2 rounded-sm ${darkMode ? 'bg-zinc-800/30' : 'bg-amber-50'}`}>
                <p className={`text-xs ${mutedClass} flex items-center flex-wrap gap-1`}>
                  {CREW_MAP[userCrew]?.icon ? (
                    <img src={CREW_MAP[userCrew]?.icon} alt="" className="w-4 h-4 object-contain inline" />
                  ) : (
                    <span style={{ color: CREW_MAP[userCrew]?.color }}>{CREW_MAP[userCrew]?.emblem}</span>
                  )}
                  <span style={{ color: CREW_MAP[userCrew]?.color }}>{CREW_MAP[userCrew]?.name}</span> members: {crewMembers.join(', ')}
                </p>
              </div>
            </>
          ) : (
            /* WEEKLY MISSIONS TAB */
            <>
              {weeklyMissions.length === 0 ? (
                <div className={`p-4 rounded-sm ${darkMode ? 'bg-zinc-800/50' : 'bg-purple-50'} text-center`}>
                  <p className={`${mutedClass}`}>No weekly missions available</p>
                </div>
              ) : (
                weeklyMissions.map(mission => (
                  <div
                    key={mission.id}
                    className={`p-3 rounded-sm border ${
                      mission.claimed
                        ? 'border-purple-500/30 bg-purple-500/5'
                        : mission.complete
                          ? 'border-purple-500 bg-purple-500/10'
                          : darkMode ? 'border-zinc-700' : 'border-amber-200'
                    }`}
                  >
                    <div className="flex justify-between items-start mb-2">
                      <div>
                        <h3 className={`font-semibold ${textClass}`}>{mission.name}</h3>
                        <p className={`text-xs ${mutedClass}`}>{mission.description}</p>
                      </div>
                      <span className={`text-sm font-bold ${mission.complete ? 'text-purple-500' : mutedClass}`}>
                        +{formatCurrency(mission.reward)}
                      </span>
                    </div>

                    {/* Progress bar */}
                    <div className="flex items-center gap-2">
                      <div className={`flex-1 h-2 rounded-full ${darkMode ? 'bg-zinc-800' : 'bg-slate-200'}`}>
                        <div
                          className={`h-full rounded-full transition-all ${mission.complete ? 'bg-purple-500' : 'bg-purple-400'}`}
                          style={{ width: `${Math.min(100, (mission.progress / mission.target) * 100)}%` }}
                        />
                      </div>
                      <span className={`text-xs ${mutedClass} w-16 text-right`}>
                        {mission.progress >= 1000 ? `${(mission.progress/1000).toFixed(1)}k` : mission.progress}/{mission.target >= 1000 ? `${(mission.target/1000).toFixed(0)}k` : mission.target}
                      </span>
                    </div>

                    {/* Claim button */}
                    {mission.complete && !mission.claimed && (
                      <button
                        onClick={() => onClaimWeeklyReward(mission.id, mission.reward)}
                        disabled={claimWeeklyLoading}
                        className="w-full mt-2 py-1.5 text-sm font-semibold rounded-sm bg-purple-600 hover:bg-purple-700 text-white disabled:opacity-50"
                      >
                        {claimWeeklyLoading ? 'Claiming...' : 'Claim Reward'}
                      </button>
                    )}
                    {mission.claimed && (
                      <p className="text-xs text-purple-500 mt-2 text-center">✓ Claimed</p>
                    )}
                  </div>
                ))
              )}

              {/* Crew member hint */}
              <div className={`p-2 rounded-sm ${darkMode ? 'bg-zinc-800/30' : 'bg-purple-50'}`}>
                <p className={`text-xs ${mutedClass} flex items-center flex-wrap gap-1`}>
                  {CREW_MAP[userCrew]?.icon ? (
                    <img src={CREW_MAP[userCrew]?.icon} alt="" className="w-4 h-4 object-contain inline" />
                  ) : (
                    <span style={{ color: CREW_MAP[userCrew]?.color }}>{CREW_MAP[userCrew]?.emblem}</span>
                  )}
                  <span style={{ color: CREW_MAP[userCrew]?.color }}>{CREW_MAP[userCrew]?.name}</span> members: {crewMembers.join(', ')}
                </p>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default DailyMissionsModal;
