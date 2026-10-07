import { useState } from 'react';
import { doc, getDoc, setDoc, collection, getDocs } from 'firebase/firestore';
import { db, runDividendPayoutNowFunction } from '../../firebase';
import type { AdminHookDeps } from './adminShared';
import { errorMessage } from '../../utils/errors';
import type { DividendRunResponse } from '../../api/types';
import type { TimestampLike } from '../../types';

/** dividendConfig/runs/log/{id}. */
export interface DividendRunLog {
  id: string;
  ranAt?: TimestampLike;
  [key: string]: unknown;
}

const ranAtMs = (run: DividendRunLog): number =>
  run.ranAt && typeof run.ranAt === 'object' && 'toMillis' in run.ranAt ? run.ranAt.toMillis() : 0;

// Dividends tab: tier overrides, manual payout runs, recent run log.
export function useAdminDividends({ showMessage }: Pick<AdminHookDeps, 'showMessage'>) {
  // Dividends tab state
  const [dividendOverrides, setDividendOverrides] = useState<Record<string, string>>({});
  const [dividendConfigLoaded, setDividendConfigLoaded] = useState(false);
  const [dividendSearch, setDividendSearch] = useState('');
  const [dividendRunResult, setDividendRunResult] = useState<DividendRunResponse | null>(null);
  const [dividendActionLoading, setDividendActionLoading] = useState(false);
  const [dividendLastRuns, setDividendLastRuns] = useState<DividendRunLog[]>([]);

  // ============================================
  // DIVIDEND HANDLERS
  // ============================================

  const loadDividendConfig = async () => {
    try {
      const ref = doc(db, 'dividendConfig', 'tierOverrides');
      const snap = await getDoc(ref);
      setDividendOverrides(snap.exists() ? snap.data().tiers || {} : {});

      const runsSnap = await getDocs(collection(db, 'dividendConfig', 'runs', 'log'));
      const runs = runsSnap.docs
        .map((d): DividendRunLog => ({ id: d.id, ...d.data() }))
        .sort((a, b) => ranAtMs(b) - ranAtMs(a))
        .slice(0, 5);
      setDividendLastRuns(runs);

      setDividendConfigLoaded(true);
    } catch (err) {
      showMessage('error', 'Failed to load dividend config: ' + (errorMessage(err) || 'Unknown error'));
    }
  };

  const saveDividendTier = async (ticker: string, tier: string) => {
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
      showMessage('error', 'Failed to save tier: ' + (errorMessage(err) || 'Unknown error'));
    }
  };

  const handleRunDividends = async () => {
    if (!confirm('Run dividend payout NOW? This pays every eligible user immediately.')) return;
    setDividendActionLoading(true);
    setDividendRunResult(null);
    try {
      const result = await runDividendPayoutNowFunction();
      setDividendRunResult(result.data);
      showMessage(
        'success',
        `Paid ${result.data.usersPaid}/${result.data.usersConsidered} users $${(result.data.totalPaid || 0).toFixed(2)} total.`,
      );
      await loadDividendConfig();
    } catch (err) {
      showMessage('error', 'Payout failed: ' + (errorMessage(err) || 'Unknown error'));
    } finally {
      setDividendActionLoading(false);
    }
  };

  return {
    dividendOverrides,
    dividendConfigLoaded,
    dividendSearch,
    setDividendSearch,
    dividendRunResult,
    dividendActionLoading,
    dividendLastRuns,
    loadDividendConfig,
    saveDividendTier,
    handleRunDividends,
  };
}
