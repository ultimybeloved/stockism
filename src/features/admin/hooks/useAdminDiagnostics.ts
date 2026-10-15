import { useState } from 'react';
import { auditUserDropsFunction } from '../../../api/callables';
import type { AdminHookDeps } from '../utils/adminShared';
import { errorMessage } from '../../../utils/errors';
import type { DropAuditResponse } from '../../../api/types';

// Diagnostics tab: the daily drop audit. The March 2026 ticker rollback
// diagnostic and recovery tool were removed on 2026-10-14.
// Uses setMessage directly (no auto-dismiss), matching the original behavior.
export function useAdminDiagnostics({ setMessage }: Pick<AdminHookDeps, 'setMessage'>) {
  const [dropAuditQuery, setDropAuditQuery] = useState('');
  const [dropAuditRunning, setDropAuditRunning] = useState(false);
  const [dropAuditResult, setDropAuditResult] = useState<DropAuditResponse | null>(null);

  const handleDropAudit = async () => {
    if (!dropAuditQuery.trim()) return;
    setDropAuditRunning(true);
    setDropAuditResult(null);
    try {
      const query = dropAuditQuery.trim();
      const isUid = query.length > 20 && !query.includes(' ');
      const result = await auditUserDropsFunction(isUid ? { uid: query } : { username: query });
      setDropAuditResult(result.data);
      setMessage({ type: 'success', text: `Drop audit complete: ${result.data.totalClaims} claims found` });
    } catch (err) {
      setMessage({ type: 'error', text: `Drop audit failed: ${errorMessage(err)}` });
    }
    setDropAuditRunning(false);
  };

  return { dropAuditQuery, setDropAuditQuery, dropAuditRunning, handleDropAudit, dropAuditResult };
}
