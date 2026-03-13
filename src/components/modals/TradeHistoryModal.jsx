import React, { useState, useEffect, useMemo } from 'react';
import { collection, query, where, orderBy, limit, getDocs, startAfter, Timestamp } from 'firebase/firestore';
import { db } from '../../firebase';
import { formatCurrency } from '../../utils/formatters';
import { CHARACTER_MAP } from '../../characters';

const PAGE_SIZE = 30;

const TradeHistoryModal = ({ user, onClose, darkMode, colorBlindMode = false }) => {
  const [trades, setTrades] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [lastDoc, setLastDoc] = useState(null);
  const [hasMore, setHasMore] = useState(true);
  const [filterAction, setFilterAction] = useState('all');
  const [searchTicker, setSearchTicker] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const cardClass = darkMode ? 'bg-zinc-900 border-zinc-800' : 'bg-white border-amber-200';
  const textClass = darkMode ? 'text-zinc-100' : 'text-slate-900';
  const mutedClass = darkMode ? 'text-zinc-400' : 'text-zinc-600';
  const inputClass = darkMode ? 'bg-zinc-950 border-zinc-700 text-zinc-100' : 'bg-white border-amber-300 text-slate-900';

  const fetchTrades = async (afterDoc = null) => {
    if (!user) return;
    try {
      const constraints = [
        collection(db, 'trades'),
        where('uid', '==', user.uid),
        orderBy('timestamp', 'desc'),
        limit(PAGE_SIZE)
      ];

      if (afterDoc) {
        let q = query(
          collection(db, 'trades'),
          where('uid', '==', user.uid),
          orderBy('timestamp', 'desc'),
          startAfter(afterDoc),
          limit(PAGE_SIZE)
        );
        const snap = await getDocs(q);
        const newTrades = snap.docs.map(doc => ({
          id: doc.id,
          ...doc.data(),
          _doc: doc
        }));
        setHasMore(newTrades.length === PAGE_SIZE);
        setLastDoc(snap.docs[snap.docs.length - 1] || null);
        return newTrades;
      }

      let q = query(...constraints);
      const snap = await getDocs(q);
      const newTrades = snap.docs.map(doc => ({
        id: doc.id,
        ...doc.data(),
        _doc: doc
      }));
      setHasMore(newTrades.length === PAGE_SIZE);
      setLastDoc(snap.docs[snap.docs.length - 1] || null);
      return newTrades;
    } catch (err) {
      console.error('Failed to fetch trades:', err);
      return [];
    }
  };

  useEffect(() => {
    (async () => {
      setLoading(true);
      const initial = await fetchTrades();
      setTrades(initial || []);
      setLoading(false);
    })();
  }, [user]);

  const loadMore = async () => {
    if (!hasMore || loadingMore) return;
    setLoadingMore(true);
    const more = await fetchTrades(lastDoc);
    setTrades(prev => [...prev, ...(more || [])]);
    setLoadingMore(false);
  };

  const getActionColor = (action) => {
    if (action === 'buy' || action === 'cover') {
      return colorBlindMode ? 'text-teal-500' : 'text-green-500';
    }
    return colorBlindMode ? 'text-purple-500' : 'text-red-500';
  };

  const getActionBg = (action) => {
    if (action === 'buy') return colorBlindMode ? 'bg-teal-900/20' : 'bg-green-900/20';
    if (action === 'sell') return colorBlindMode ? 'bg-purple-900/20' : 'bg-red-900/20';
    if (action === 'short') return 'bg-orange-900/20';
    if (action === 'cover' || action === 'margin_call_cover') return 'bg-blue-900/20';
    return '';
  };

  // Calculate P&L for sell/cover trades
  const getTradeP_L = (trade) => {
    if (trade.action === 'sell' || trade.action === 'cover' || trade.action === 'margin_call_cover') {
      if (trade.profitPercent !== undefined && trade.profitPercent !== null) {
        return { percent: trade.profitPercent, amount: (trade.totalValue || trade.price * trade.amount) * (trade.profitPercent / 100) };
      }
      if (trade.costBasisAtTrade && trade.price) {
        const pl = (trade.price - trade.costBasisAtTrade) * trade.amount;
        const percent = trade.costBasisAtTrade > 0 ? ((trade.price - trade.costBasisAtTrade) / trade.costBasisAtTrade) * 100 : 0;
        return { amount: trade.action === 'cover' || trade.action === 'margin_call_cover' ? -pl : pl, percent };
      }
    }
    return null;
  };

  const formatTimestamp = (ts) => {
    if (!ts) return '';
    const date = ts.toDate ? ts.toDate() : new Date(ts);
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  };

  const getTimestampDate = (ts) => {
    if (!ts) return null;
    return ts.toDate ? ts.toDate() : new Date(ts);
  };

  // Apply client-side filters
  const filtered = useMemo(() => {
    let result = trades;

    if (filterAction !== 'all') {
      result = result.filter(t => t.action === filterAction);
    }

    if (searchTicker.trim()) {
      const search = searchTicker.trim().toUpperCase();
      result = result.filter(t => t.ticker && t.ticker.toUpperCase().includes(search));
    }

    if (dateFrom) {
      const fromDate = new Date(dateFrom);
      fromDate.setHours(0, 0, 0, 0);
      result = result.filter(t => {
        const d = getTimestampDate(t.timestamp);
        return d && d >= fromDate;
      });
    }

    if (dateTo) {
      const toDate = new Date(dateTo);
      toDate.setHours(23, 59, 59, 999);
      result = result.filter(t => {
        const d = getTimestampDate(t.timestamp);
        return d && d <= toDate;
      });
    }

    return result;
  }, [trades, filterAction, searchTicker, dateFrom, dateTo]);

  // Running P&L total for filtered sell/cover trades
  const totalPL = useMemo(() => {
    let total = 0;
    for (const trade of filtered) {
      const pl = getTradeP_L(trade);
      if (pl && pl.amount) total += pl.amount;
    }
    return total;
  }, [filtered]);

  // CSV export
  const handleExportCSV = () => {
    const headers = ['Date', 'Ticker', 'Action', 'Amount', 'Price', 'Total Value', 'P&L'];
    const rows = filtered.map(trade => {
      const date = getTimestampDate(trade.timestamp);
      const pl = getTradeP_L(trade);
      return [
        date ? date.toISOString() : '',
        trade.ticker,
        trade.action,
        trade.amount,
        trade.price?.toFixed(2) || '',
        (trade.totalValue || trade.price * trade.amount)?.toFixed(2) || '',
        pl?.amount?.toFixed(2) || ''
      ].join(',');
    });

    const csv = [headers.join(','), ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `stockism_trades_${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-50" onClick={onClose}>
      <div className={`w-full max-w-lg ${cardClass} border rounded-sm shadow-xl overflow-hidden max-h-[85vh] flex flex-col`}
        onClick={e => e.stopPropagation()}>

        <div className={`p-4 border-b ${darkMode ? 'border-zinc-800' : 'border-amber-200'}`}>
          <div className="flex justify-between items-center">
            <h2 className={`text-lg font-semibold ${textClass}`}>Trade History</h2>
            <div className="flex items-center gap-2">
              <button onClick={handleExportCSV} title="Export CSV"
                className={`px-2 py-1 text-xs font-semibold rounded-sm ${darkMode ? 'text-zinc-400 hover:bg-zinc-800' : 'text-zinc-600 hover:bg-slate-200'}`}>
                CSV
              </button>
              <button onClick={onClose} className={`p-2 ${mutedClass} hover:text-orange-600 text-xl`}>&times;</button>
            </div>
          </div>

          {/* Search + Date filters */}
          <div className="flex gap-2 mt-2">
            <input
              type="text"
              placeholder="Search ticker..."
              value={searchTicker}
              onChange={e => setSearchTicker(e.target.value)}
              className={`flex-1 px-2 py-1 text-xs rounded-sm border ${inputClass}`}
            />
            <input
              type="date"
              value={dateFrom}
              onChange={e => setDateFrom(e.target.value)}
              className={`w-28 px-1 py-1 text-xs rounded-sm border ${inputClass}`}
            />
            <input
              type="date"
              value={dateTo}
              onChange={e => setDateTo(e.target.value)}
              className={`w-28 px-1 py-1 text-xs rounded-sm border ${inputClass}`}
            />
          </div>

          {/* Action filter buttons */}
          <div className="flex gap-1 mt-2">
            {['all', 'buy', 'sell', 'short', 'cover'].map(action => (
              <button key={action} onClick={() => setFilterAction(action)}
                className={`px-2 py-1 text-xs font-semibold rounded-sm ${
                  filterAction === action ? 'bg-orange-600 text-white' : darkMode ? 'text-zinc-400 hover:bg-zinc-800' : 'text-zinc-600 hover:bg-slate-200'
                }`}>
                {action.charAt(0).toUpperCase() + action.slice(1)}
              </button>
            ))}
          </div>

          {/* Running P&L */}
          {filtered.length > 0 && totalPL !== 0 && (
            <div className={`mt-2 text-sm font-semibold ${
              totalPL >= 0
                ? (colorBlindMode ? 'text-teal-500' : 'text-green-500')
                : (colorBlindMode ? 'text-purple-500' : 'text-red-500')
            }`}>
              Total P&L: {totalPL >= 0 ? '+' : ''}{formatCurrency(totalPL)}
            </div>
          )}
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {loading ? (
            <p className={`text-center py-8 ${mutedClass}`}>Loading trades...</p>
          ) : filtered.length === 0 ? (
            <p className={`text-center py-8 ${mutedClass}`}>No trades found</p>
          ) : (
            <div className="space-y-2">
              {filtered.map(trade => {
                const char = CHARACTER_MAP[trade.ticker];
                const pl = getTradeP_L(trade);
                return (
                  <div key={trade.id} className={`p-3 rounded-sm border ${darkMode ? 'border-zinc-700' : 'border-amber-200'} ${darkMode ? getActionBg(trade.action) : ''}`}>
                    <div className="flex justify-between items-start">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-orange-600 font-mono text-sm font-semibold">${trade.ticker}</span>
                          <span className={`text-xs font-bold uppercase ${getActionColor(trade.action)}`}>{trade.action}</span>
                        </div>
                        {char && <p className={`text-xs ${mutedClass}`}>{char.name}</p>}
                      </div>
                      <div className="text-right">
                        <p className={`font-semibold text-sm ${textClass}`}>{formatCurrency(Math.abs(trade.totalValue || trade.price * trade.amount))}</p>
                        <p className={`text-xs ${mutedClass}`}>{trade.amount} @ {formatCurrency(trade.price)}</p>
                        {pl && (
                          <p className={`text-xs font-semibold ${
                            pl.amount >= 0
                              ? (colorBlindMode ? 'text-teal-500' : 'text-green-500')
                              : (colorBlindMode ? 'text-purple-500' : 'text-red-500')
                          }`}>
                            {pl.amount >= 0 ? '+' : ''}{formatCurrency(pl.amount)}
                          </p>
                        )}
                      </div>
                    </div>
                    <p className={`text-xs ${mutedClass} mt-1`}>{formatTimestamp(trade.timestamp)}</p>
                  </div>
                );
              })}
              {hasMore && (
                <button onClick={loadMore} disabled={loadingMore}
                  className={`w-full py-2 text-sm font-semibold rounded-sm border ${darkMode ? 'border-zinc-700 text-zinc-300 hover:bg-zinc-800' : 'border-amber-200 text-zinc-600 hover:bg-amber-50'} disabled:opacity-50`}>
                  {loadingMore ? 'Loading...' : 'Load More'}
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default TradeHistoryModal;
