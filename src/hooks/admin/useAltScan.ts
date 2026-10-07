import { useState } from 'react';
import { triggerAltScanFunction, reviewWatchlistAlertFunction } from '../../firebase';
import { errorMessage } from '../../utils/errors';
import type { AltScanResponse } from '../../api/types';
import type { ShowMessage } from './adminShared';

// Drives the manual alt-account scan and the mark-as-reviewed action. Kept
// separate from useAdminWatchlist so neither hook grows past the 200-line limit
// and so the scan (which reads a month of trades) stays clearly one concern.
export function useAltScan(showMessage: ShowMessage, onAfterScan?: () => Promise<void> | void) {
  const [scanning, setScanning] = useState(false);
  const [result, setResult] = useState<AltScanResponse | null>(null);

  // dryRun looks without writing alerts or pinging Discord, so a first run can
  // be inspected before it starts announcing names.
  const runScan = async (dryRun = false) => {
    setScanning(true);
    setResult(null);
    try {
      const res = await triggerAltScanFunction({ dryRun });
      setResult(res.data);
      const { scanned, candidates, reported } = res.data;
      showMessage(
        candidates > 0 ? 'warning' : 'success',
        dryRun
          ? `Dry run: ${candidates} suspicious pair(s) across ${scanned} trades. Nothing written.`
          : `Scanned ${scanned} trades, ${candidates} suspicious pair(s), ${reported} new alert(s).`,
      );
      if (!dryRun && onAfterScan) await onAfterScan();
    } catch (err) {
      showMessage('error', `Alt scan failed: ${errorMessage(err)}`);
    } finally {
      setScanning(false);
    }
  };

  const markReviewed = async (alertId: string) => {
    try {
      await reviewWatchlistAlertFunction({ alertId });
      showMessage('success', 'Alert marked reviewed.');
      if (onAfterScan) await onAfterScan();
    } catch (err) {
      showMessage('error', `Could not mark reviewed: ${errorMessage(err)}`);
    }
  };

  return { scanning, result, runScan, markReviewed };
}
