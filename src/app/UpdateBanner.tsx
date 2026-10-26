import { memo, useEffect, useState } from 'react';

// How often an open tab checks for a newer deploy, on top of each time the tab
// comes back into view.
const CHECK_MS = 10 * 60 * 1000;

/** The deployed version (dist/version.json, written by vite.config.js), or null if it can't be read. */
const fetchDeployedVersion = async (): Promise<string | null> => {
  try {
    const res = await fetch(`/version.json?t=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) return null;
    const data = (await res.json()) as { version?: unknown };
    return typeof data.version === 'string' ? data.version : null;
  } catch {
    return null;
  }
};

// A tab left open across a deploy keeps running the old site, which can
// disagree with the server (old mission lists, old rules). Ask for a refresh.
const UpdateBanner = () => {
  const [newVersion, setNewVersion] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState<string | null>(null);

  useEffect(() => {
    if (!import.meta.env.PROD) return;
    const check = async () => {
      const v = await fetchDeployedVersion();
      if (v && v !== __APP_VERSION__) setNewVersion(v);
    };
    const onVisible = () => {
      if (document.visibilityState === 'visible') void check();
    };
    const timer = setInterval(() => void check(), CHECK_MS);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  if (!newVersion || dismissed === newVersion) return null;

  return (
    <div
      role="status"
      className="mx-4 mt-3 p-3 rounded-sm border text-sm flex items-center justify-between gap-3 light:bg-orange-50 light:border-orange-300 light:text-orange-900 dark:bg-orange-900/30 dark:border-orange-700 dark:text-orange-100"
    >
      <span>Stockism has been updated. Refresh to get the latest version.</span>
      <span className="flex items-center gap-2 shrink-0">
        <button
          onClick={() => window.location.reload()}
          className="px-3 py-1 rounded-sm text-sm font-semibold text-white bg-orange-600 hover:bg-orange-700"
        >
          Refresh
        </button>
        <button
          onClick={() => setDismissed(newVersion)}
          aria-label="Dismiss"
          className="font-bold text-lg leading-none opacity-60 hover:opacity-100"
        >
          &times;
        </button>
      </span>
    </div>
  );
};

export default memo(UpdateBanner);
