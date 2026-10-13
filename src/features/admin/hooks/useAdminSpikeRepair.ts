import { useState } from 'react';
import { repairSpikeVictimsFunction } from '../../../api/callables';
import type { AdminHookDeps } from '../utils/adminShared';
import { errorMessage } from '../../../utils/errors';
import type { SpikeRepairResponse, SpikeVictim } from '../../../api/types';

// Recovery tab: spike-victim scan/repair and account diagnosis.
export function useAdminSpikeRepair({ showMessage }: Pick<AdminHookDeps, 'showMessage'>) {
  // Spike victim repair state
  const [spikeVictims, setSpikeVictims] = useState<SpikeVictim[]>([]);
  const [spikeScanned, setSpikeScanned] = useState(false);
  const [scanningSpike, setScanningSpike] = useState(false);
  const [repairingSpike, setRepairingSpike] = useState(false);
  const [diagnosisResults, setDiagnosisResults] = useState<NonNullable<SpikeRepairResponse['results']>>([]);
  const [diagnosisIds, setDiagnosisIds] = useState('');
  const [diagnosing, setDiagnosing] = useState(false);

  const handleScanSpikeVictims = async () => {
    setScanningSpike(true);
    try {
      const result = await repairSpikeVictimsFunction({ mode: 'scan' });
      setSpikeVictims(result.data.victims || []);
      setSpikeScanned(true);
      showMessage('success', `Found ${(result.data.victims || []).length} spike victims`);
    } catch (err) {
      console.error(err);
      showMessage('error', `Scan failed: ${errorMessage(err)}`);
    }
    setScanningSpike(false);
  };

  const handleRepairSpikeVictim = async (victim: SpikeVictim) => {
    if (
      !confirm(
        `Repair ${victim.displayName}?\nCash: $${(victim.currentCash || 0).toFixed(2)} → $${(victim.correctedCash || 0).toFixed(2)}${victim.tookBailout ? '\nWill restore ' + victim.holdingsCount + ' stock holdings' : ''}`,
      )
    )
      return;
    setRepairingSpike(true);
    try {
      await repairSpikeVictimsFunction({ mode: 'repair', userId: victim.userId, victims: victim });
      setSpikeVictims((prev) => prev.filter((v) => v.userId !== victim.userId));
      showMessage('success', `Repaired ${victim.displayName}`);
    } catch (err) {
      console.error(err);
      showMessage('error', `Failed to repair ${victim.displayName}: ${errorMessage(err)}`);
    }
    setRepairingSpike(false);
  };

  // Only rows the scan worked out a fix for. The rest have no corrected cash, and
  // sending them would set their cash to $0 (the per-row Fix button is hidden for them too).
  const fixableSpikeVictims = spikeVictims.filter((v) => v.correctedCash != null);

  const handleRepairAllSpikeVictims = async () => {
    if (fixableSpikeVictims.length === 0) return;
    if (
      !confirm(
        `Repair ${fixableSpikeVictims.length} spike victims with a suggested fix? This sets their cash to the suggested amount and clears bankruptcy. Accounts without a suggested fix are left alone.`,
      )
    )
      return;
    setRepairingSpike(true);
    try {
      const result = await repairSpikeVictimsFunction({ mode: 'repairAll', victims: fixableSpikeVictims });
      const successes = (result.data.results || []).filter((r) => r.success).length;
      const failures = (result.data.results || []).filter((r) => !r.success).length;
      const repaired = new Set(fixableSpikeVictims.map((v) => v.userId));
      setSpikeVictims((prev) => prev.filter((v) => !repaired.has(v.userId)));
      showMessage('success', `Repaired ${successes} users${failures > 0 ? `, ${failures} failed` : ''}`);
    } catch (err) {
      console.error(err);
      showMessage('error', `Repair all failed: ${errorMessage(err)}`);
    }
    setRepairingSpike(false);
  };

  const handleDiagnoseUsers = async () => {
    const ids = diagnosisIds
      .split(/[\s,]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (ids.length === 0) {
      showMessage('error', 'Enter at least one user ID');
      return;
    }
    setDiagnosing(true);
    try {
      const result = await repairSpikeVictimsFunction({ mode: 'diagnose', userIds: ids });
      setDiagnosisResults(result.data.results || []);
      showMessage('success', `Diagnosed ${(result.data.results || []).length} users`);
    } catch (err) {
      console.error(err);
      showMessage('error', `Diagnose failed: ${errorMessage(err)}`);
    }
    setDiagnosing(false);
  };

  return {
    scanningSpike,
    repairingSpike,
    spikeScanned,
    spikeVictims,
    handleScanSpikeVictims,
    handleRepairAllSpikeVictims,
    handleRepairSpikeVictim,
    diagnosisIds,
    setDiagnosisIds,
    diagnosing,
    diagnosisResults,
    handleDiagnoseUsers,
  };
}
