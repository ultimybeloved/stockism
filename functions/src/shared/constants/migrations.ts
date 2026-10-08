// Ticker rename and stock split engines.

export const RENAME_TIME_BUDGET_MS = 480 * 1000;
export const RENAME_BATCH_SIZE = 400;
export const RENAME_PAGE_SIZE = 300;
export const RENAME_JOURNAL_DOC = 'tickerRename';
// Anchored and character-restricted: a ticker containing a dot would be a field
// path, not a key, and would write to the wrong place in prices.<ticker>.
export const TICKER_PATTERN = /^[A-Z0-9]{2,6}$/;

// Stock splits (stockSplit.js). Same time budget and page sizes as the rename.
// The journal holds the run in progress; the history holds each stock's total
// split factor, which the deployed characters.js splitFactor must match.
export const SPLIT_JOURNAL_DOC = 'splitJournal';
export const SPLIT_HISTORY_DOC = 'splitHistory';
export const SPLIT_MIN_RATIO = 2;
export const SPLIT_MAX_RATIO = 100;
