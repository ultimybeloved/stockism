import { useCallback, useState } from 'react';
import type { SetLoadingKey } from './types';

/** Which actions are in flight, by name ('trade', 'checkin', ...), so buttons can show it. */
export const useActionLoading = () => {
  const [actionLoading, setActionLoading] = useState<Record<string, boolean>>({});
  const setLoadingKey: SetLoadingKey = useCallback((key, value) => {
    setActionLoading((prev) => ({ ...prev, [key]: value }));
  }, []);
  return { actionLoading, setLoadingKey };
};
