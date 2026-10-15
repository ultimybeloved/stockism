import DropAuditPanel from './diagnostic/DropAuditPanel';

import type { AdminCommonProps } from './types';
import type { useAdminDiagnostics } from '../hooks/useAdminDiagnostics';

const DiagnosticTab = ({
  textClass,
  mutedClass,
  inputClass,
  ...audit
}: Omit<AdminCommonProps, 'loading'> & ReturnType<typeof useAdminDiagnostics>) => (
  <div className="space-y-4 overflow-x-hidden">
    <DropAuditPanel textClass={textClass} mutedClass={mutedClass} inputClass={inputClass} {...audit} />
  </div>
);

export default DiagnosticTab;
