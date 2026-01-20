import React, { useState, useEffect, useMemo } from 'react';
import { collection, getDocs } from 'firebase/firestore';
import { db } from './firebase';
import { CREWS } from './crews';

const CrewProfilePanel = ({ crew, prices, onClose, darkMode }) => {
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


  const crewStats = useMemo(() => {
    if (!crew || !prices) return null;

    const members = crew.members;
    let totalMarketCap = 0;
    let totalPriceChange = 0;
    let validPriceChanges = 0;

    const memberDetails = members.map(ticker => {
      const price = prices[ticker] || 0;
      const basePrice = prices[`${ticker}_base`] || price;
      const priceChange = basePrice > 0 ? (price - basePrice) / basePrice : 0;

      let totalHoldings = 0;
      if (allUserData) {
        Object.values(allUserData).forEach(userData => {
          if (userData.holdings && userData.holdings[ticker]) {
            totalHoldings += userData.holdings[ticker];
          }
        });
      }

      totalMarketCap += price * totalHoldings;
      
      if (!isNaN(priceChange) && isFinite(priceChange)) {
        totalPriceChange += priceChange;
        validPriceChanges++;
      }

      return {
        ticker,
        price,
        priceChange,
        totalHoldings,
        marketCap: price * totalHoldings
      };
    });

    const avgPriceChange = validPriceChanges > 0 ? totalPriceChange / validPriceChanges : 0;

    return {
      totalMarketCap,
      avgPriceChange,
      memberDetails: memberDetails.sort((a, b) => b.marketCap - a.marketCap)
    };
  }, [crew, prices, allUserData]);

  if (!crew) {
    return null;
  }

  const isUp = crewStats ? crewStats.avgPriceChange >= 0 : false;

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center p-4 z-50" onClick={onClose}>
      <div 
        className={`${cardClass} border rounded-lg max-w-2xl w-full max-h-[90vh] overflow-y-auto`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="sticky top-0 z-10 px-6 py-4 border-b" style={{ 
          backgroundColor: darkMode ? '#18181b' : '#ffffff',
          borderColor: darkMode ? '#27272a' : '#fef3c7'
        }}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              {crew.icon && (
                <img 
                  src={crew.icon} 
                  alt={crew.name} 
                  className="w-16 h-16 rounded-lg object-cover"
                  style={{ border: `2px solid ${crew.color}` }}
                />
              )}
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-2xl">{crew.emblem}</span>
                  <h2 className={`text-2xl font-bold ${textClass}`}>{crew.name}</h2>
                </div>
                <p className={`text-sm ${mutedClass} mt-1`}>{crew.members.length} members</p>
              </div>
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

        {/* Stats */}
        <div className="px-6 py-4 border-b" style={{ 
          borderColor: darkMode ? '#27272a' : '#fef3c7'
        }}>
          {loading || !crewStats ? (
            <div className={`text-center py-4 ${mutedClass}`}>
              <p>Loading crew stats...</p>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className={`text-sm ${mutedClass} mb-1`}>Total Market Cap</p>
                <p className={`text-2xl font-bold ${textClass}`}>{formatCurrency(crewStats.totalMarketCap)}</p>
              </div>
              <div>
                <p className={`text-sm ${mutedClass} mb-1`}>Avg Price Change</p>
                <p className={`text-2xl font-bold ${isUp ? 'text-green-500' : 'text-red-500'}`}>
                  {isUp ? '▲' : '▼'} {formatChange(crewStats.avgPriceChange)}
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Members List */}
        <div className="px-6 py-4">
          <h3 className={`text-lg font-semibold ${textClass} mb-4`}>Crew Members</h3>
          {loading || !crewStats ? (
            <div className={`text-center py-4 ${mutedClass}`}>
              <p>Loading members...</p>
            </div>
          ) : (
            <div className="space-y-2">
              {crewStats.memberDetails.map(member => {
              const memberIsUp = member.priceChange >= 0;
              const hasHoldings = member.totalHoldings > 0;

              return (
                <div
                  key={member.ticker}
                  className={`p-3 rounded-sm ${
                    hasHoldings 
                      ? darkMode ? 'bg-zinc-800 ring-1 ring-blue-500' : 'bg-blue-50 ring-1 ring-blue-300'
                      : darkMode ? 'bg-zinc-800' : 'bg-slate-50'
                  }`}
                >
                  <div className="flex justify-between items-center">
                    <div className="flex-1">
                      <p className="text-orange-600 font-mono text-sm font-semibold">${member.ticker}</p>
                      <div className="flex items-center gap-2 mt-1">
                        <p className={`text-sm ${textClass}`}>{formatCurrency(member.price)}</p>
                        <p className={`text-xs font-mono ${memberIsUp ? 'text-green-500' : 'text-red-500'}`}>
                          {memberIsUp ? '▲' : '▼'} {formatChange(member.priceChange)}
                        </p>
                      </div>
                    </div>
                    <div className="text-right">
                      {hasHoldings ? (
                        <>
                          <p className={`text-xs ${mutedClass}`}>Holdings</p>
                          <p className="text-sm font-semibold text-blue-500">{member.totalHoldings} shares</p>
                          <p className={`text-xs ${mutedClass} mt-1`}>Cap: {formatCurrency(member.marketCap)}</p>
                        </>
                      ) : (
                        <p className={`text-xs ${mutedClass}`}>No holdings</p>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default CrewProfilePanel;
