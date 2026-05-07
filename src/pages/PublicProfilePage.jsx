import React, { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { useAppContext } from '../context/AppContext';
import { getPublicProfileFunction } from '../firebase';
import { CREW_MAP } from '../crews';
import { COSMETIC_MAP } from '../constants/cosmetics';
import { formatCurrency } from '../utils/formatters';
import PinDisplay from '../components/common/PinDisplay';

const PublicProfilePage = () => {
  const { username } = useParams();
  const { darkMode } = useAppContext();
  const [profile, setProfile] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetch = async () => {
      try {
        const result = await getPublicProfileFunction({ username });
        setProfile(result.data);
      } catch (err) {
        setError(err.code === 'functions/permission-denied' ? 'private' : 'notfound');
      } finally {
        setLoading(false);
      }
    };
    fetch();
  }, [username]);

  const cardClass = darkMode ? 'bg-zinc-900 border-zinc-800' : 'bg-white border-amber-200';
  const textClass = darkMode ? 'text-zinc-100' : 'text-slate-900';
  const mutedClass = darkMode ? 'text-zinc-400' : 'text-zinc-600';

  if (loading) {
    return (
      <div className="max-w-2xl mx-auto p-4">
        <div className={`${cardClass} border rounded-sm p-8 text-center ${mutedClass}`}>Loading...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="max-w-2xl mx-auto p-4">
        <div className={`${cardClass} border rounded-sm p-8 text-center`}>
          <p className={`text-2xl mb-2`}>{error === 'private' ? '🔒' : '👤'}</p>
          <p className={`font-semibold ${textClass}`}>
            {error === 'private' ? 'This profile is private' : 'Profile not found'}
          </p>
          <p className={`text-sm ${mutedClass} mt-1`}>
            {error === 'private'
              ? `${username} hasn't made their profile public yet.`
              : `No trader found with username "${username}".`}
          </p>
        </div>
      </div>
    );
  }

  const crew = profile.crew ? CREW_MAP[profile.crew] : null;
  const ac = profile.activeCosmetics || {};
  const nameColorC = ac.nameColor ? COSMETIC_MAP[ac.nameColor] : null;
  const rowGlowC = ac.rowGlow ? COSMETIC_MAP[ac.rowGlow] : null;
  const rowBackdropC = ac.rowBackdrop ? COSMETIC_MAP[ac.rowBackdrop] : null;
  const crewColor = crew?.color || '#6b7280';

  return (
    <div className="max-w-2xl mx-auto p-4 space-y-4">
      {/* Header */}
      <div
        className={`${cardClass} border rounded-sm p-4`}
        style={{
          ...(rowGlowC ? { boxShadow: `0 0 24px ${rowGlowC.color}40` } : {}),
          ...(rowBackdropC ? { backgroundColor: darkMode ? `${rowBackdropC.color}18` : `${rowBackdropC.color}12` } : {}),
        }}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <h1 className={`text-xl font-bold ${textClass} flex items-center gap-2`}>
              <span style={{ color: nameColorC?.color }}>
                {profile.displayName || 'Anonymous Trader'}
              </span>
              <PinDisplay userData={profile} size="sm" />
            </h1>
            {crew && (
              <div className="flex items-center gap-1.5 mt-1">
                {crew.icon
                  ? <img src={crew.icon} alt="" className="w-4 h-4 object-contain" />
                  : <span>{crew.emblem}</span>}
                <span className="text-sm font-semibold" style={{ color: crewColor }}>{crew.name}</span>
                {profile.isCrewHead && (
                  <span className="text-xs px-1.5 py-0.5 rounded-full font-bold text-white" style={{ backgroundColor: crewColor }}>Head</span>
                )}
              </div>
            )}
          </div>
          <div className="text-right shrink-0">
            {profile.rank && (
              <div className={`text-sm font-bold ${textClass}`}>#{profile.rank}</div>
            )}
            <div className={`text-lg font-bold ${textClass}`}>{formatCurrency(profile.portfolioValue)}</div>
            <div className={`text-xs ${mutedClass}`}>{profile.holdingsCount || 0} characters</div>
          </div>
        </div>
      </div>

      {/* Holdings */}
      {(profile.holdingTickers || []).length > 0 && (
        <div className={`${cardClass} border rounded-sm p-4`}>
          <h2 className={`font-semibold ${textClass} mb-3`}>📦 Holdings</h2>
          <div className="flex flex-wrap gap-2">
            {profile.holdingTickers.map(ticker => (
              <span
                key={ticker}
                className={`px-2.5 py-1 text-sm font-semibold rounded-full ${
                  darkMode ? 'bg-zinc-800 text-zinc-200' : 'bg-amber-100 text-slate-800'
                }`}
              >
                ${ticker}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Recent Trades */}
      {(profile.trades || []).length > 0 && (
        <div className={`${cardClass} border rounded-sm p-4`}>
          <h2 className={`font-semibold ${textClass} mb-3`}>📈 Recent Trades</h2>
          <div className="space-y-1">
            {profile.trades.map((trade, i) => {
              const isBuy = trade.action === 'buy';
              const ts = trade.timestamp?._seconds
                ? new Date(trade.timestamp._seconds * 1000)
                : trade.timestamp?.toDate?.() || new Date(trade.timestamp);
              const tradeKey = `${trade.ticker}-${trade.action}-${trade.timestamp?._seconds || i}`;
              return (
                <div key={tradeKey} className={`flex items-center justify-between py-1.5 ${i > 0 ? `border-t ${darkMode ? 'border-zinc-800' : 'border-amber-100'}` : ''}`}>
                  <div className="flex items-center gap-2">
                    <span className={`text-xs font-bold px-1.5 py-0.5 rounded ${isBuy ? 'bg-emerald-600 text-white' : 'bg-red-600 text-white'}`}>
                      {isBuy ? 'BUY' : 'SELL'}
                    </span>
                    <span className={`font-semibold text-sm ${textClass}`}>${trade.ticker}</span>
                  </div>
                  <div className="text-right">
                    <span className={`text-sm font-semibold ${textClass}`}>{formatCurrency(trade.totalValue)}</span>
                    <span className={`text-xs ${mutedClass} ml-2`}>@ {formatCurrency(trade.price)}</span>
                  </div>
                  <span className={`text-xs ${mutedClass} ml-3 shrink-0`}>
                    {ts.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};

export default PublicProfilePage;
