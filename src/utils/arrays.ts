// Array helpers for the oldest browsers the site supports. The build target
// (vite.config.js) includes Safari 14 and Chrome 87, which have no Array .at()
// or .findLast(), and the build doesn't add them: calling one there crashes
// the page. ESLint blocks both in src/.

/** The last item, or undefined for an empty or missing list. */
export const lastOf = <T>(arr: readonly T[] | null | undefined): T | undefined =>
  arr && arr.length ? arr[arr.length - 1] : undefined;

/** The last item that passes `test`, or undefined. */
export const findLastOf = <T>(arr: readonly T[], test: (item: T) => boolean): T | undefined => {
  for (let i = arr.length - 1; i >= 0; i--) if (test(arr[i]!)) return arr[i];
  return undefined;
};
