import React, { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { useAppContext } from '../context/AppContext';
import { getPublicProfileFunction } from '../firebase';
import { CREW_MAP } from '../crews';
import { CHARACTERS } from '../characters';
import { COSMETIC_MAP } from '../constants/cosmetics';
import { ACHIEVEMENTS } from '../constants/achievements';
import { formatCurrency } from '../utils/formatters';
import PinDisplay from '../components/common/PinDisplay';
import SimpleLineChart from '../components/charts/SimpleLineChart';
import { getThemeClasses } from '../utils/theme';
import { ADMIN_UIDS } from '../constants/economy';

const CHARACTER_MAP = Object.fromEntries(CHARACTERS.map(c => [c.ticker, c]));

const PublicProfilePage = () => {
  const { username } = useParams();
  const { darkMode, user } = useAppContext();
  const viewerIsAdmin = user && ADMIN_UIDS.includes(user.uid);
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

  const { cardClass, textClass, mutedClass } = getThemeClasses(darkMode);

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
          <p className="text-2xl mb-2">{error === 'private' ? '🔒' : '👤'}</p>
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

  // Portfolio sparkline data
  const sparklineData = (profile.portfolioHistory || []).map(p => ({
    timestamp: p.timestamp,
    price: p.value,
  }));

  // Account age
  let accountAge = null;
  if (profile.stats?.createdAt) {
    const created = profile.stats.createdAt._seconds
      ? new Date(profile.stats.createdAt._seconds * 1000)
      : new Date(profile.stats.createdAt);
    const days = Math.floor((Date.now() - created.getTime()) / 86400000);
    accountAge = days < 1 ? 'today' : days === 1 ? '1 day' : `${days} days`;
  }

  // Earned achievements (lookup from constants)
  const earnedAchievements = (profile.achievements || [])
    .map(id => ACHIEVEMENTS[id])
    .filter(Boolean);

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
                {profile.crewRank && (
                  <span className={`text-xs ${mutedClass}`}>#{profile.crewRank} in crew</span>
                )}
              </div>
            )}
            {accountAge && (
              <p className={`text-xs ${mutedClass} mt-0.5`}>Member for {accountAge}</p>
            )}
          </div>
          <div className="text-right shrink-0">
            {profile.rank && (
              <div className={`text-sm font-bold ${textClass}`}>#{profile.rank} global</div>
            )}
            <div className={`text-lg font-bold ${textClass}`}>{formatCurrency(profile.portfolioValue)}</div>
            <div className={`text-xs ${mutedClass}`}>{profile.holdingsCount || 0} characters</div>
          </div>
        </div>

        {/* Portfolio sparkline */}
        {sparklineData.length >= 2 && (
          <div className="mt-3">
            <SimpleLineChart data={sparklineData} darkMode={darkMode} width={600} height={48} />
          </div>
        )}
      </div>

      {/* Stats block */}
      {profile.stats && (
        <div className={`${cardClass} border rounded-sm p-4`}>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {profile.stats.peakPortfolioValue > 0 && (
              <div>
                <p className={`text-xs ${mutedClass}`}>All-time high</p>
                <p className={`font-bold ${textClass}`}>{formatCurrency(profile.stats.peakPortfolioValue)}</p>
              </div>
            )}
            {profile.stats.totalTrades > 0 && (
              <div>
                <p className={`text-xs ${mutedClass}`}>Total trades</p>
                <p className={`font-bold ${textClass}`}>{profile.stats.totalTrades.toLocaleString()}</p>
              </div>
            )}
            {profile.stats.predictionWins > 0 && (
              <div>
                <p className={`text-xs ${mutedClass}`}>Prediction wins</p>
                <p className={`font-bold ${textClass}`}>{profile.stats.predictionWins}</p>
              </div>
            )}
            {profile.stats.totalCheckins > 0 && (
              <div>
                <p className={`text-xs ${mutedClass}`}>Check-ins</p>
                <p className={`font-bold ${textClass}`}>{profile.stats.totalCheckins.toLocaleString()}</p>
              </div>
            )}
            {profile.stats.checkinStreak > 1 && (
              <div>
                <p className={`text-xs ${mutedClass}`}>Current streak</p>
                <p className={`font-bold ${textClass}`}>🔥 {profile.stats.checkinStreak} days</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Top Holdings spotlight */}
      {(profile.topHoldings || []).length > 0 && (
        <div className={`${cardClass} border rounded-sm p-4`}>
          <h2 className={`font-semibold ${textClass} mb-3`}>Top Holdings</h2>
          <div className="flex flex-wrap gap-2 mb-3">
            {profile.topHoldings.map(ticker => {
              const char = CHARACTER_MAP[ticker];
              return (
                <div
                  key={ticker}
                  className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-sm border ${darkMode ? 'bg-zinc-800 border-zinc-700' : 'bg-amber-50 border-amber-200'}`}
                >
                  <span className="text-orange-500 font-mono text-sm font-bold">${ticker}</span>
                  {char && !char.isETF && (
                    <span className={`text-xs ${mutedClass}`}>{char.name}</span>
                  )}
                </div>
              );
            })}
          </div>
          {(profile.holdingTickers || []).length > (profile.topHoldings || []).length && (
            <div className="flex flex-wrap gap-1.5">
              {profile.holdingTickers
                .filter(t => !(profile.topHoldings || []).includes(t))
                .map(ticker => (
                  <span
                    key={ticker}
                    className={`px-2 py-0.5 text-xs font-mono rounded ${darkMode ? 'bg-zinc-800 text-zinc-400' : 'bg-zinc-100 text-zinc-500'}`}
                  >
                    ${ticker}
                  </span>
                ))}
            </div>
          )}
        </div>
      )}

      {/* Short Positions */}
      {(profile.shortTickers || []).length > 0 && (
        <div className={`${cardClass} border rounded-sm p-4`}>
          <h2 className={`font-semibold ${textClass} mb-3`}>Short Positions</h2>
          <div className="flex flex-wrap gap-2">
            {profile.shortTickers.map(ticker => (
              <div
                key={ticker}
                className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-sm border ${darkMode ? 'bg-zinc-800 border-zinc-700' : 'bg-red-50 border-red-200'}`}
              >
                <span className="text-red-500 font-mono text-sm font-bold">${ticker}</span>
              </div>
            ))}
          </div>
          {profile.totalShortValue > 0 && (
            <p className={`text-xs ${mutedClass} mt-2`}>Total short exposure: {formatCurrency(profile.totalShortValue)}</p>
          )}
        </div>
      )}

      {/* Achievements */}
      {earnedAchievements.length > 0 && (
        <div className={`${cardClass} border rounded-sm p-4`}>
          <h2 className={`font-semibold ${textClass} mb-3`}>Achievements <span className={`text-sm font-normal ${mutedClass}`}>({earnedAchievements.length})</span></h2>
          <div className="flex flex-wrap gap-2">
            {earnedAchievements.map(a => (
              <div
                key={a.id}
                title={a.description}
                className={`flex items-center gap-1 px-2 py-1 rounded text-xs font-semibold ${darkMode ? 'bg-zinc-800 text-zinc-200' : 'bg-amber-100 text-slate-700'}`}
              >
                {a.icon
                  ? <img src={`/${a.icon}`} alt="" className="w-3.5 h-3.5 object-contain" />
                  : <span>{a.emoji}</span>}
                {a.name}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Admin panel */}
      {viewerIsAdmin && profile.adminData && (
        <AdminPanel data={profile.adminData} darkMode={darkMode} textClass={textClass} mutedClass={mutedClass} cardClass={cardClass} />
      )}
    </div>
  );
};

const AdminPanel = ({ data, darkMode, textClass, mutedClass, cardClass }) => {
  const [copied, setCopied] = useState(false);

  const copyUID = () => {
    navigator.clipboard.writeText(data.uid);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const weeklyColor = data.weeklyGain >= 0 ? 'text-green-500' : 'text-red-500';
  const activeShorts = Object.entries(data.shorts || {}).filter(([, p]) => p && p.shares > 0);
  const activeHoldings = Object.entries(data.holdings || {}).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);

  return (
    <div className={`border-2 border-orange-500 rounded-sm p-4 ${darkMode ? 'bg-zinc-900' : 'bg-orange-50'} space-y-4`}>
      <div className="flex items-center justify-between">
        <h2 className="text-orange-500 font-bold text-sm uppercase tracking-widest">Admin View</h2>
        {(data.isBanned || data.isBot) && (
          <div className="flex gap-1.5">
            {data.isBanned && <span className="text-xs px-2 py-0.5 rounded bg-red-500 text-white font-bold">Banned</span>}
            {data.isBot && <span className="text-xs px-2 py-0.5 rounded bg-zinc-500 text-white font-bold">Bot</span>}
          </div>
        )}
      </div>

      {/* UID */}
      <div>
        <p className={`text-xs ${mutedClass} mb-0.5`}>UID</p>
        <button onClick={copyUID} className={`font-mono text-xs ${textClass} hover:text-orange-500 transition-colors`}>
          {data.uid} {copied ? '(copied)' : ''}
        </button>
      </div>

      {/* Key financials */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div>
          <p className={`text-xs ${mutedClass}`}>Cash</p>
          <p className={`font-bold ${textClass}`}>{formatCurrency(data.cash)}</p>
        </div>
        <div>
          <p className={`text-xs ${mutedClass}`}>Net equity</p>
          <p className={`font-bold ${textClass}`}>{formatCurrency(data.netEquity)}</p>
        </div>
        <div>
          <p className={`text-xs ${mutedClass}`}>Margin debt</p>
          <p className={`font-bold ${data.marginUsed > 0 ? 'text-red-500' : textClass}`}>
            {formatCurrency(data.marginUsed)}
            {data.marginEnabled && <span className={`text-xs ${mutedClass} ml-1`}>(on)</span>}
          </p>
        </div>
        <div>
          <p className={`text-xs ${mutedClass}`}>7-day gain</p>
          <p className={`font-bold ${weeklyColor}`}>
            {data.weeklyGain >= 0 ? '+' : ''}{formatCurrency(data.weeklyGain)}
            <span className="text-xs ml-1">({data.weeklyGain >= 0 ? '+' : ''}{data.weeklyGainPercent}%)</span>
          </p>
        </div>
      </div>

      {/* Holdings with share counts */}
      {activeHoldings.length > 0 && (
        <div>
          <p className={`text-xs ${mutedClass} mb-1.5`}>Holdings ({activeHoldings.length})</p>
          <div className="flex flex-wrap gap-1.5">
            {activeHoldings.map(([ticker, shares]) => (
              <span key={ticker} className={`text-xs px-2 py-0.5 rounded font-mono ${darkMode ? 'bg-zinc-800 text-zinc-200' : 'bg-white text-zinc-700'} border ${darkMode ? 'border-zinc-700' : 'border-zinc-200'}`}>
                ${ticker} <span className="font-bold">{shares}</span>
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Short positions with full details */}
      {activeShorts.length > 0 && (
        <div>
          <p className={`text-xs ${mutedClass} mb-1.5`}>Short positions ({activeShorts.length})</p>
          <div className="space-y-1">
            {activeShorts.map(([ticker, pos]) => (
              <div key={ticker} className={`text-xs px-2 py-1.5 rounded font-mono flex flex-wrap gap-x-3 gap-y-0.5 ${darkMode ? 'bg-zinc-800' : 'bg-red-50 border border-red-100'}`}>
                <span className="text-red-500 font-bold">${ticker}</span>
                <span className={textClass}>{pos.shares} shares</span>
                <span className={mutedClass}>basis {formatCurrency(pos.costBasis)}</span>
                {pos.margin > 0 && <span className="text-orange-400">margin {formatCurrency(pos.margin)}</span>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default PublicProfilePage;
