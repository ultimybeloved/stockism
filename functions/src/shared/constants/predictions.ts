// Weekly predictions and the long-term event markets.

// ============================================
// EVENT PREDICTION MARKETS (long-term, AMM-priced)
// ============================================
// LMSR liquidity parameter (b). Bigger = steadier prices and a larger bounded
// house subsidy. Max the house can ever lose on a market is b * ln(numOutcomes)
// (~$3,466 for a yes/no market at b=5000). Seeded generously on purpose: stable
// prices and generous payouts build trust, and a deep book stops one big early
// bet from yanking the line.
export { EVENT_AMM_LIQUIDITY, EVENT_MIN_BUYIN } from '../rules/economy';
