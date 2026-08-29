import { useState, useCallback, useMemo } from 'react';
import { adminListCashLogFunction } from '../../firebase';

/**
 * Admin panel: read the log of manual cash adjustments.
 *
 * Read-only. The page is fetched once and filtered in memory, so typing in the
 * search box costs nothing and the totals stay consistent with what is on
 * screen.
 */
export function useAdminCashLog({ showMessage }) {
  const [entries, setEntries] = useState([]);
  const [totals, setTotals] = useState(null);
  const [search, setSearch] = useState('');
  const [onlyGrants, setOnlyGrants] = useState(true);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const loadCashLog = useCallback(async () => {
    setLoading(true);
    try {
      const res = await adminListCashLogFunction({});
      setEntries(res.data.entries || []);
      setTotals(res.data.totals || null);
      setLoaded(true);
    } catch (e) {
      showMessage('error', e?.message || 'Could not load the cash log.');
    } finally {
      setLoading(false);
    }
  }, [showMessage]);

  const visibleEntries = useMemo(() => {
    const q = search.trim().toLowerCase();
    return entries.filter((e) => {
      if (onlyGrants && !(e.delta > 0)) return false;
      if (!q) return true;
      return (e.displayName || '').toLowerCase().includes(q)
        || (e.memo || '').toLowerCase().includes(q)
        || (e.userId || '').toLowerCase().includes(q);
    });
  }, [entries, search, onlyGrants]);

  // Totals for what is actually on screen, so filtering down to one player
  // answers "how much have I given them" without any extra maths.
  const visibleTotals = useMemo(() => ({
    granted: Math.round(visibleEntries.reduce((s, e) => s + (e.delta > 0 ? e.delta : 0), 0) * 100) / 100,
    takenBack: Math.round(visibleEntries.reduce((s, e) => s + (e.delta < 0 ? -e.delta : 0), 0) * 100) / 100,
    count: visibleEntries.length,
  }), [visibleEntries]);

  return {
    cashLogEntries: visibleEntries,
    cashLogTotals: totals,
    cashLogVisibleTotals: visibleTotals,
    cashLogSearch: search,
    setCashLogSearch: setSearch,
    cashLogOnlyGrants: onlyGrants,
    setCashLogOnlyGrants: setOnlyGrants,
    cashLogLoading: loading,
    cashLogLoaded: loaded,
    loadCashLog,
  };
}
