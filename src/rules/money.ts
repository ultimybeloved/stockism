// Money rounding. Shared rule module (see src/rules/ladder.ts for what that
// means).

// Round to cents. Money is stored as a plain number, so anything that lands in a
// cash/price field goes through this.
export const round2 = (n: number): number => Math.round(n * 100) / 100;
