// Pure per-IP account counting for the signup cap (functions/src/users/users.js
// createUser). No Firebase imports so it can be unit-tested in isolation, and so
// the emulator concurrency test can run the exact same count the function uses.

// Count accounts attributed to one IP, excluding the signer's own slot. Live
// accounts come from `accounts`; recently-deleted ones still hold their slot for
// `slotReleaseMs` (via `deletedAccounts` tombstones) so delete-and-remake can't
// dodge the cap. Returns { liveAccounts, recentlyDeleted, effectiveAccounts }.
export function countIpAccounts(
  ipTrackData: { accounts?: Record<string, unknown>; deletedAccounts?: Record<string, number> } | null | undefined,
  excludeUid: string,
  now: number,
  slotReleaseMs: number,
) {
  const data = ipTrackData || {};
  const liveAccounts = Object.keys(data.accounts || {}).filter((a) => a !== excludeUid).length;
  const recentlyDeleted = Object.entries(data.deletedAccounts || {}).filter(
    ([a, deletedAt]) => a !== excludeUid && now - deletedAt < slotReleaseMs,
  ).length;
  return { liveAccounts, recentlyDeleted, effectiveAccounts: liveAccounts + recentlyDeleted };
}
