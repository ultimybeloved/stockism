import { useState } from 'react';
import {
  auditUserDropsFunction, diagnoseTickerRollbackFunction, recoverTickerFunction,
} from '../../firebase';

// Diagnostics tab: drop audits, ticker rollback diagnosis, ticker recovery.
// Uses setMessage directly (no auto-dismiss), matching the original behavior.
export function useAdminDiagnostics({ setMessage }) {
  // Drop audit state
  const [dropAuditQuery, setDropAuditQuery] = useState('');
  const [dropAuditRunning, setDropAuditRunning] = useState(false);
  const [dropAuditResult, setDropAuditResult] = useState(null);

  // Ticker rollback diagnostic state
  const [diagTicker, setDiagTicker] = useState('SHRO');
  const [diagStartDate, setDiagStartDate] = useState('2026-03-18');
  const [diagRunning, setDiagRunning] = useState(false);
  const [diagResult, setDiagResult] = useState(null);
  const [diagUserSort, setDiagUserSort] = useState('net'); // 'net', 'bought', 'sold'
  const [recoveryPreview, setRecoveryPreview] = useState(null);
  const [recoveryRunning, setRecoveryRunning] = useState(false);
  const [recoveryExecuting, setRecoveryExecuting] = useState(false);
  const [recoveryDone, setRecoveryDone] = useState(false);
  const [recoveryRollbackDate, setRecoveryRollbackDate] = useState('2026-03-18');

  // Drop audit handler
  const handleDropAudit = async () => {
    if (!dropAuditQuery.trim()) return;
    setDropAuditRunning(true);
    setDropAuditResult(null);
    try {
      const query = dropAuditQuery.trim();
      const isUid = query.length > 20 && !query.includes(' ');
      const result = await auditUserDropsFunction(isUid ? { uid: query } : { username: query });
      setDropAuditResult(result.data);
      setMessage({ type: 'success', text: `Drop audit complete — ${result.data.totalClaims} claims found` });
    } catch (err) {
      setMessage({ type: 'error', text: `Drop audit failed: ${err.message}` });
    }
    setDropAuditRunning(false);
  };

  // Spike victim repair handlers
  const handleRunDiagnostic = async () => {
    setDiagRunning(true);
    setDiagResult(null);
    try {
      const startTimestamp = new Date(diagStartDate + 'T00:00:00Z').getTime();
      const result = await diagnoseTickerRollbackFunction({ ticker: diagTicker, startTimestamp });
      setDiagResult(result.data);
      setMessage({ type: 'success', text: `Diagnostic complete — ${result.data.summary.totalTrades} trades found` });
    } catch (err) {
      setMessage({ type: 'error', text: `Diagnostic failed: ${err.message}` });
    }
    setDiagRunning(false);
    setRecoveryPreview(null);
    setRecoveryDone(false);
    setRecoveryRollbackDate(diagStartDate);
  };

  const handleRecoveryPreview = async () => {
    if (!recoveryRollbackDate) {
      setMessage({ type: 'error', text: 'Pick a rollback date' });
      return;
    }
    setRecoveryRunning(true);
    setRecoveryPreview(null);
    setRecoveryDone(false);
    try {
      const startTimestamp = new Date(diagStartDate + 'T00:00:00Z').getTime();
      const rollbackToTimestamp = new Date(recoveryRollbackDate + 'T00:00:00Z').getTime();
      const result = await recoverTickerFunction({ ticker: diagTicker, startTimestamp, rollbackToTimestamp, dryRun: true });
      setRecoveryPreview(result.data);
    } catch (err) {
      setMessage({ type: 'error', text: `Recovery preview failed: ${err.message}` });
    }
    setRecoveryRunning(false);
  };

  const handleRecoveryExecute = async () => {
    if (!window.confirm(`EXECUTE RECOVERY on ${diagTicker}? This will claw back cash, reset the price, and rewrite price history. This cannot be undone.`)) return;
    setRecoveryExecuting(true);
    try {
      const startTimestamp = new Date(diagStartDate + 'T00:00:00Z').getTime();
      const rollbackToTimestamp = new Date(recoveryRollbackDate + 'T00:00:00Z').getTime();
      const result = await recoverTickerFunction({ ticker: diagTicker, startTimestamp, rollbackToTimestamp, dryRun: false });
      setRecoveryPreview(result.data);
      setRecoveryDone(true);
      setMessage({ type: 'success', text: `Recovery complete — $${result.data.totalClawedBack.toFixed(2)} clawed back, price reset to $${result.data.priceReset.to.toFixed(2)}` });
    } catch (err) {
      setMessage({ type: 'error', text: `Recovery failed: ${err.message}` });
    }
    setRecoveryExecuting(false);
  };

  return {
    dropAuditQuery, setDropAuditQuery, dropAuditRunning, handleDropAudit, dropAuditResult,
    diagTicker, setDiagTicker, diagStartDate, setDiagStartDate,
    diagRunning, handleRunDiagnostic, diagResult, diagUserSort, setDiagUserSort,
    recoveryRollbackDate, setRecoveryRollbackDate, recoveryRunning, recoveryExecuting,
    handleRecoveryPreview, recoveryDone, recoveryPreview, handleRecoveryExecute,
  };
}
