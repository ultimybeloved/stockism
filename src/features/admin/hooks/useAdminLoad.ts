import { useCallback, useEffect, useRef, useState } from 'react';
import { errorMessage } from '../../../utils/errors';

/**
 * Load one admin callable's result: data, loading, error and a reload.
 * Loads on mount when `auto` is set. A slower earlier load never overwrites a
 * newer one.
 */
export function useAdminLoad<T>(fetcher: () => Promise<{ data: T }>, { auto = true } = {}) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);
  const fetchRef = useRef(fetcher);
  fetchRef.current = fetcher;

  const load = useCallback(async () => {
    const mine = ++seq.current;
    setLoading(true);
    setError(null);
    try {
      const res = await fetchRef.current();
      if (mine === seq.current) setData(res.data);
    } catch (err) {
      if (mine === seq.current) setError(errorMessage(err));
    } finally {
      if (mine === seq.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (auto) void load();
  }, [auto, load]);

  return { data, setData, loading, error, load };
}
