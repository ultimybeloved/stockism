// How long records nobody needs any more are kept. The nightly clean-up
// (admin/retention.ts) removes anything older.

const DAY_MS = 24 * 60 * 60 * 1000;

// A notification the player has read. Unread ones are never removed.
export const READ_NOTIFICATION_KEEP_MS = 90 * DAY_MS;

// The connection a limit order was placed from (orderOrigins). An order lives
// at most 90 days, so at 180 days it has been finished for at least 90.
export const ORDER_ORIGIN_KEEP_MS = 180 * DAY_MS;

// The private copy of a deleted account (deletedUsers), which holds its IP
// address and Discord ID. The privacy page promises this limit.
export const DELETED_ACCOUNT_KEEP_MS = 365 * DAY_MS;

// Most documents one nightly run removes per kind, so a backlog drains over a
// few nights instead of one long run.
export const RETENTION_MAX_DELETES_PER_RUN = 2000;
