import { useState } from 'react';
import { doc, getDoc, setDoc, collection, getDocs } from 'firebase/firestore';
import { db, runDividendPayoutNowFunction } from '../../firebase';

// Dividends tab: tier overrides, manual payout runs, recent run log.
export function useAdminDividends({ showMessage }) {
  // Dividends tab state
  const [dividendOverrides, setDividendOverrides] = useState({});
  const [dividendConfigLoaded, setDividendConfigLoaded] = useState(false);
  const [dividendSearch, setDividendSearch] = useState('');
  const [dividendRunResult, setDividendRunResult] = useState(null);
  const [dividendActionLoading, setDividendActionLoading] = useState(false);
  const [dividendLastRuns, setDividendLastRuns] = useState([]);

  // ============================================
  // DIVIDEND HANDLERS
  // ============================================

  const loadDividendConfig = async () => {
    try {
      const ref = doc(db, 'dividendConfig', 'tierOverrides');
      const snap = await getDoc(ref);
      setDividendOverrides(snap.exists() ? (snap.data().tiers || {}) : {});

      const runsSnap = await getDocs(collection(db, 'dividendConfig', 'runs', 'log'));
      const runs = runsSnap.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .sort((a, b) => {
          const ta = a.ranAt?.toMillis ? a.ranAt.toMillis() : 0;
          const tb = b.ranAt?.toMillis ? b.ranAt.toMillis() : 0;
          return tb - ta;
        })
        .slice(0, 5);
      setDividendLastRuns(runs);

      setDividendConfigLoaded(true);
    } catch (err) {
      showMessage('error', 'Failed to load dividend config: ' + (err.message || 'Unknown error'));
    }
  };

  const saveDividendTier = async (ticker, tier) => {
    try {
      const ref = doc(db, 'dividendConfig', 'tierOverrides');
      const next = { ...dividendOverrides };
      if (!tier || tier === 'default') {
        delete next[ticker];
      } else {
        next[ticker] = tier;
      }
      await setDoc(ref, { tiers: next }, { merge: true });
      setDividendOverrides(next);
      showMessage('success', `Saved ${ticker} tier override.`);
    } catch (err) {
      showMessage('error', 'Failed to save tier: ' + (err.message || 'Unknown error'));
    }
  };

  const handleRunDividends = async () => {
    if (!confirm('Run dividend payout NOW? This pays every eligible user immediately.')) return;
    setDividendActionLoading(true);
    setDividendRunResult(null);
    try {
      const result = await runDividendPayoutNowFunction();
      setDividendRunResult(result.data);
      showMessage('success', `Paid ${result.data.usersPaid}/${result.data.usersConsidered} users $${(result.data.totalPaid || 0).toFixed(2)} total.`);
      await loadDividendConfig();
    } catch (err) {
      showMessage('error', 'Payout failed: ' + (err.message || 'Unknown error'));
    } finally {
      setDividendActionLoading(false);
    }
  };

  return {
    dividendOverrides, dividendConfigLoaded, dividendSearch, setDividendSearch,
    dividendRunResult, dividendActionLoading, dividendLastRuns,
    loadDividendConfig, saveDividendTier, handleRunDividends,
  };
}
