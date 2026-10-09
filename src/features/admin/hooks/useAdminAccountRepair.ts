import { doc, collection, getDocs, updateDoc } from 'firebase/firestore';
import { db } from '../../../firebase';
import type { AdminHookDeps } from '../utils/adminShared';
import { errorMessage } from '../../../utils/errors';

// This tool exists to repair documents whose numbers went bad, so it reads them
// as untrusted: any field may hold NaN, Infinity, a string, or nothing.
type RawShort = { shares?: number; entryPrice?: number; margin?: number; costBasis?: number };
interface RawUserDoc {
  displayName?: string;
  cash?: unknown;
  portfolioValue?: unknown;
  marginUsed?: unknown;
  holdings?: Record<string, unknown>;
  shorts?: Record<string, unknown>;
  costBasis?: Record<string, unknown>;
}

/** Same test as `isNaN(v) || !isFinite(v)`, which both coerce with Number(). */
const isBadNumber = (v: unknown) => isNaN(Number(v)) || !isFinite(Number(v));

interface CorruptedAccount {
  uid: string;
  displayName: string;
  issues: string[];
  fixes: Record<string, unknown>;
}

// Recovery tab: scan every account for NaN/corrupted numeric fields and fix them.
export function useAdminAccountRepair({ setMessage, setLoading }: Pick<AdminHookDeps, 'setMessage' | 'setLoading'>) {
  const handleRepairCorruptedAccounts = async () => {
    setLoading(true);
    setMessage(null);
    try {
      const usersSnap = await getDocs(collection(db, 'users'));
      const corrupted: CorruptedAccount[] = [];

      for (const userDoc of usersSnap.docs) {
        const data = userDoc.data() as RawUserDoc;
        const fixes: Record<string, unknown> = {};
        const issues: string[] = [];

        if (data.cash !== undefined && isBadNumber(data.cash)) {
          fixes.cash = 0;
          issues.push(`cash was ${data.cash}`);
        }
        if (data.portfolioValue !== undefined && isBadNumber(data.portfolioValue)) {
          fixes.portfolioValue = fixes.cash !== undefined ? fixes.cash : data.cash || 0;
          issues.push(`portfolioValue was ${data.portfolioValue}`);
        }
        if (data.marginUsed !== undefined && isBadNumber(data.marginUsed)) {
          fixes.marginUsed = 0;
          issues.push(`marginUsed was ${data.marginUsed}`);
        }
        if (data.holdings) {
          const fixedHoldings: Record<string, unknown> = {};
          let holdingsCorrupted = false;
          for (const [ticker, shares] of Object.entries(data.holdings)) {
            if (isBadNumber(shares)) {
              fixedHoldings[ticker] = 0;
              holdingsCorrupted = true;
              issues.push(`holdings.${ticker} was ${shares}`);
            }
          }
          if (holdingsCorrupted) {
            for (const [ticker, shares] of Object.entries(data.holdings)) {
              if (!Object.prototype.hasOwnProperty.call(fixedHoldings, ticker)) fixedHoldings[ticker] = shares;
            }
            fixes.holdings = fixedHoldings;
          }
        }
        if (data.shorts) {
          let shortsCorrupted = false;
          const fixedShorts: Record<string, unknown> = {};
          for (const [ticker, rawPos] of Object.entries(data.shorts)) {
            if (!rawPos || typeof rawPos !== 'object') continue;
            const pos = rawPos as RawShort;
            const hasNaN = isBadNumber(pos.shares) || isBadNumber(pos.entryPrice) || isBadNumber(pos.margin);
            if (hasNaN) {
              fixedShorts[ticker] = { shares: 0, entryPrice: 0, margin: 0, costBasis: 0 };
              shortsCorrupted = true;
              issues.push(
                `shorts.${ticker} had NaN (shares=${pos.shares}, entry=${pos.entryPrice}, margin=${pos.margin})`,
              );
            } else if ((pos.shares as number) > 0 && pos.entryPrice && !pos.costBasis) {
              fixedShorts[ticker] = { ...pos, costBasis: pos.entryPrice };
              shortsCorrupted = true;
              issues.push(`shorts.${ticker} missing costBasis (had entryPrice=${pos.entryPrice})`);
            } else if ((pos.shares as number) > 0 && pos.costBasis && !pos.entryPrice) {
              fixedShorts[ticker] = { ...pos, entryPrice: pos.costBasis };
              shortsCorrupted = true;
              issues.push(`shorts.${ticker} missing entryPrice (had costBasis=${pos.costBasis})`);
            }
          }
          if (shortsCorrupted) {
            for (const [ticker, pos] of Object.entries(data.shorts)) {
              if (!Object.prototype.hasOwnProperty.call(fixedShorts, ticker)) fixedShorts[ticker] = pos;
            }
            fixes.shorts = fixedShorts;
          }
        }
        if (data.costBasis) {
          const fixedCostBasis: Record<string, unknown> = {};
          let cbCorrupted = false;
          for (const [ticker, cost] of Object.entries(data.costBasis)) {
            if (isBadNumber(cost)) {
              fixedCostBasis[ticker] = 0;
              cbCorrupted = true;
              issues.push(`costBasis.${ticker} was ${cost}`);
            }
          }
          if (cbCorrupted) {
            for (const [ticker, cost] of Object.entries(data.costBasis)) {
              if (!Object.prototype.hasOwnProperty.call(fixedCostBasis, ticker)) fixedCostBasis[ticker] = cost;
            }
            fixes.costBasis = fixedCostBasis;
          }
        }
        if (issues.length > 0) {
          corrupted.push({ uid: userDoc.id, displayName: data.displayName || 'Unknown', issues, fixes });
        }
      }

      if (corrupted.length === 0) {
        setMessage({ type: 'success', text: 'No corrupted accounts found!' });
      } else {
        let fixed = 0;
        for (const account of corrupted) {
          const userRef = doc(db, 'users', account.uid);
          await updateDoc(userRef, account.fixes);
          fixed++;
        }
        setMessage({
          type: 'success',
          text: `Fixed ${fixed} account(s): ${corrupted.map((a) => `${a.displayName} (${a.issues.join(', ')})`).join(' | ')}`,
        });
      }
    } catch (error) {
      setMessage({ type: 'error', text: `Scan failed: ${errorMessage(error)}` });
    } finally {
      setLoading(false);
    }
  };

  return { handleRepairCorruptedAccounts };
}
