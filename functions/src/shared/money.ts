// Money rounding.

// Round to cents. Money is stored as a plain number, so anything that lands in a
// cash/price field goes through this. Was copy-pasted into four files.
export const round2 = (n: number): number => Math.round(n * 100) / 100;
