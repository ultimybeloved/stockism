import React, { useState, useEffect, useMemo } from 'react';
import { collection, getDocs } from 'firebase/firestore';
import { db } from './firebase';
import { CREWS } from './crews';

const CrewLeaderboardModal = ({ prices, onCrewClick, onClose, darkMode }) => {
  const [allUserData, setAllUserData] = useState(null);
  const [loading, setLoading] = useState(true);
  
  const cardClass = darkMode ? 'bg-zinc-900 border-zinc-800' : 'bg-white border-amber-200';
  const textClass = darkMode ? 'text-zinc-100' : 'text-slate-900';
  const mutedClass = darkMode ? 'text-zinc-400' : 'text-zinc-500';

  useEffect(() => {
    const fetchUsers = async () => {
      try {
        const usersSnapshot = await getDocs(collection(db, 'users'));
        const users = {};
        usersSnapshot.forEach((doc) => {
          users[doc.id] = doc.data();
        });
        setAllUserData(users);
      } catch (error) {
        console.error('Error fetching users:', error);
        setAllUserData({});
      } finally {
        setLoading(false);
      }
    };

    fetchUsers();
  }, []);

  const formatCurrency = (amount) => {
    if (amount >= 1000000) return `$${(amount / 1000000).toFixed(2)}M`;
    if (amount >= 1000) return `$${(amount / 1000).toFixed(2)}K`;
    return `$${amount.toFixed(2)}`;
  };

  const formatChange = (change) => {
    const percent = (change * 100).toFixed(2);
    return `${change >= 0 ? '+' : ''}${percent}%`;
  };

  // Calculate crew portfolio values
  const crewLeaderboard = useMemo(() => {
    if (!prices || !allUserData) return [];

    const crewPortfolios = Object.values(CREWS).map(crew => {
      let totalValue = 0;
      let totalPriceChange = 0;
      let validPriceChanges = 0;
      let totalHoldings = 0;
      
      // Sum up the value of all crew member stocks held by all players
      crew.members.forEach(ticker => {
        const price = prices[ticker] || 0;
        const basePrice = prices[`${ticker}_base`] || price;
        const priceChange = basePrice > 0 ? (price - basePrice) / basePrice : 0;
        
        // Count total holdings across all users
        let tickerHoldings = 0;
        Object.values(allUserData).forEach(userData => {
          if (userData.holdings && userData.holdings[ticker]) {
            const holdings = userData.holdings[ticker];
            tickerHoldings += holdings;
            totalValue += price * holdings;
          }
        });

        totalHoldings += tickerHoldings;
        
        if (!isNaN(priceChange) && isFinite(priceChange)) {
          totalPriceChange += priceChange;
          validPriceChanges++;
        }
      });

      const avgPriceChange = validPriceChanges > 0 ? totalPriceChange / validPriceChanges : 0;

      return {
        crew,
        totalValue,
        avgPriceChange,
        totalHoldings
      };
    });

    // Sort by total value descending
    return crewPortfolios.sort((a, b) => b.totalValue - a.totalValue);
  }, [prices, allUserData]);

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center p-4 z-50" onClick={onClose}>
      <div 
        className={`${cardClass} border rounded-lg max-w-4xl w-full max-h-[90vh] overflow-y-auto`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="sticky top-0 z-10 px-6 py-4 border-b" style={{ 
          backgroundColor: darkMode ? '#18181b' : '#ffffff',
          borderColor: darkMode ? '#27272a' : '#fef3c7'
        }}>
          <div className="flex items-center justify-between">
            <div>
              <h2 className={`text-2xl font-bold ${textClass} flex items-center gap-2`}>
                <span>👥</span> Crew Leaderboard
              </h2>
              <p className={`text-sm ${mutedClass} mt-1`}>
                Ranked by total portfolio value of all crew members held by players
              </p>
            </div>
            <button
              onClick={onClose}
              className={`px-4 py-2 text-sm font-semibold rounded-sm ${
                darkMode ? 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700' : 'bg-slate-100 text-zinc-600 hover:bg-slate-200'
              }`}
            >
              Close
            </button>
          </div>
        </div>

        {/* Leaderboard */}
        <div className="p-6">
          {loading ? (
            <div className={`text-center py-12 ${mutedClass}`}>
              <p className="text-lg">Loading crew data...</p>
            </div>
          ) : (
            <div className="space-y-3">
              {crewLeaderboard.map((entry, index) => {
              const { crew, totalValue, avgPriceChange, totalHoldings } = entry;
              const rank = index + 1;
              const isUp = avgPriceChange >= 0;
              
              return (
                <div
                  key={crew.id}
                  onClick={() => onCrewClick(crew)}
                  className={`flex items-center gap-4 p-4 rounded-lg cursor-pointer transition-all ${
                    darkMode 
                      ? 'hover:bg-zinc-800 bg-zinc-850 border border-zinc-800' 
                      : 'hover:bg-amber-50 bg-slate-50 border border-amber-200'
                  }`}
                  style={{
                    borderLeft: `4px solid ${crew.color}`
                  }}
                >
                  {/* Rank */}
                  <div className="flex-shrink-0 w-12 text-center">
                    {rank === 1 && <span className="text-3xl">🥇</span>}
                    {rank === 2 && <span className="text-3xl">🥈</span>}
                    {rank === 3 && <span className="text-3xl">🥉</span>}
                    {rank > 3 && (
                      <span className={`text-xl font-bold ${mutedClass}`}>#{rank}</span>
                    )}
                  </div>

                  {/* Crew Info */}
                  <div className="flex items-center gap-3 flex-1 min-w-0">
                    {crew.icon && (
                      <img 
                        src={crew.icon} 
                        alt={crew.name} 
                        className="w-12 h-12 rounded-lg object-cover flex-shrink-0"
                        style={{ border: `2px solid ${crew.color}` }}
                      />
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-lg">{crew.emblem}</span>
                        <p className={`text-lg font-bold ${textClass}`}>
                          {crew.name}
                        </p>
                      </div>
                      <div className="flex items-center gap-3 text-xs">
                        <span className={mutedClass}>
                          {crew.members.length} members
                        </span>
                        <span className={mutedClass}>•</span>
                        <span className={mutedClass}>
                          {totalHoldings} total shares held
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Stats */}
                  <div className="text-right flex-shrink-0">
                    <p className={`text-xl font-bold ${textClass} mb-1`}>
                      {formatCurrency(totalValue)}
                    </p>
                    <p className={`text-sm font-mono ${isUp ? 'text-green-500' : 'text-red-500'}`}>
                      {isUp ? '▲' : '▼'} {formatChange(avgPriceChange)}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
          )}

          {crewLeaderboard.length === 0 && (
            <div className={`text-center py-12 ${mutedClass}`}>
              <p className="text-lg">No crew data available</p>
              <p className="text-sm mt-2">Start trading to see crew rankings!</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default CrewLeaderboardModal;
