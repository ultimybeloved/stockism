import { useState } from 'react';
import { triggerAltScanFunction, reviewWatchlistAlertFunction } from '../../firebase';

// Drives the manual alt-account scan and the mark-as-reviewed action. Kept
// separate from useAdminWatchlist so neither hook grows past the 200-line limit
// and so the scan (which reads a month of trades) stays clearly one concern.
export function useAltScan(showNotification, onAfterScan) {
  const [scanning, setScanning] = useState(false);
  const [result, setResult] = useState(null);

  // dryRun looks without writing alerts or pinging Discord, so a first run can
  // be inspected before it starts announcing names.
  const runScan = async (dryRun = false) => {
    setScanning(true);
    setResult(null);
    try {
      const res = await triggerAltScanFunction({ dryRun });
      setResult(res.data);
      const { scanned, candidates, reported } = res.data;
      showNotification(
        dryRun
          ? `Dry run: ${candidates} suspicious pair(s) across ${scanned} trades. Nothing written.`
          : `Scanned ${scanned} trades, ${candidates} suspicious pair(s), ${reported} new alert(s).`,
        candidates > 0 ? 'warning' : 'success'
      );
      if (!dryRun && onAfterScan) await onAfterScan();
    } catch (err) {
      showNotification(`Alt scan failed: ${err.message}`, 'error');
    } finally {
      setScanning(false);
    }
  };

  const markReviewed = async (alertId) => {
    try {
      await reviewWatchlistAlertFunction({ alertId });
      showNotification('Alert marked reviewed.', 'success');
      if (onAfterScan) await onAfterScan();
    } catch (err) {
      showNotification(`Could not mark reviewed: ${err.message}`, 'error');
    }
  };

  return { scanning, result, runScan, markReviewed };
}
