// What a player sees when part of the site crashes. Used by both error
// boundaries: the page-level one (the header and nav still work, so "Try
// again" is offered) and the top-level one in main.tsx (everything is gone, so
// only a reload helps). Plain classes only: no providers are guaranteed to be
// alive when this renders.

// After a deploy, an open tab still asks for the old build's page files, which
// no longer exist. Retrying can't fix that; a reload picks up the new build.
const STALE_BUILD = /dynamically imported module|Importing a module script failed|Loading chunk|ChunkLoadError/i;

export const isStaleBuildError = (error: unknown) =>
  STALE_BUILD.test(error instanceof Error ? `${error.name} ${error.message}` : String(error ?? ''));

interface CrashScreenProps {
  error?: unknown;
  /** Clears the crash and re-renders. Left out when nothing is left to retry. */
  onRetry?: () => void;
  fullPage?: boolean;
}

export default function CrashScreen({ error, onRetry, fullPage = false }: CrashScreenProps) {
  const stale = isStaleBuildError(error);
  return (
    <div
      role="alert"
      className={`flex items-center justify-center p-6 ${fullPage ? 'min-h-screen light:bg-amber-50 dark:bg-zinc-950' : 'min-h-64'}`}
    >
      <div className="max-w-sm w-full text-center rounded-sm border p-6 light:bg-white light:border-amber-200 dark:bg-zinc-900 dark:border-zinc-800">
        <p className="text-lg font-semibold light:text-zinc-900 dark:text-zinc-100">
          {stale ? 'Stockism was just updated' : 'Something went wrong'}
        </p>
        <p className="mt-2 text-sm light:text-zinc-600 dark:text-zinc-400">
          {stale
            ? 'Reload to get the new version. Your account and trades are safe.'
            : 'Your account and trades are safe. Reloading usually fixes it.'}
        </p>
        <div className="mt-5 flex justify-center gap-2">
          <button
            onClick={() => window.location.reload()}
            className="px-4 py-2 rounded-sm text-sm font-semibold text-white bg-orange-600 hover:bg-orange-700"
          >
            Reload page
          </button>
          {onRetry && !stale && (
            <button
              onClick={onRetry}
              className="px-4 py-2 rounded-sm text-sm font-semibold border light:border-zinc-300 light:text-zinc-700 light:hover:border-orange-500 dark:border-zinc-600 dark:text-zinc-300 dark:hover:border-orange-500"
            >
              Try again
            </button>
          )}
        </div>
        <p className="mt-5 text-xs light:text-zinc-400 dark:text-zinc-500">
          If it keeps happening, tell us in Discord and mention version v{__APP_VERSION__}.
        </p>
      </div>
    </div>
  );
}
