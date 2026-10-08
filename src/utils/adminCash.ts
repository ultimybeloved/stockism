// Parsing for the admin cash box. One input covers three operations:
//
//   +500   add $500 to the balance
//   -500   take $500 off the balance
//    500   set the balance to exactly $500
//
// Pure, so the confirm dialog can show the resulting arithmetic before anything
// is sent. The server recomputes all of this from `mode` and `amount` and is the
// authority — this exists so the admin sees the outcome first, not to be trusted.
// Mirror of the math in adminSetCash (functions/src/admin/adminOps.js).

export type CashMode = 'add' | 'subtract' | 'set';

export type CashParseResult =
  { ok: true; mode: CashMode; amount: number; before: number; after: number } | { ok: false; error: string };

const round2 = (n: number) => Math.round(n * 100) / 100;

/** `input` is the raw text from the prompt; `currentCash` the balance now. */
export function parseCashInput(input: unknown, currentCash: unknown): CashParseResult {
  const raw = String(input ?? '').trim();
  if (!raw) return { ok: false, error: 'Enter an amount' };

  const mode: CashMode = raw[0] === '+' ? 'add' : raw[0] === '-' ? 'subtract' : 'set';
  const body = mode === 'set' ? raw : raw.slice(1).trim();

  // Reject anything that is not plainly a number, so "5o0" or "+ +5" cannot
  // slip through parseFloat's prefix parsing as a silent 5.
  if (!/^\d*\.?\d+$/.test(body)) {
    return { ok: false, error: 'Enter a number, optionally starting with + or -' };
  }

  const amount = round2(parseFloat(body));
  if (!isFinite(amount) || amount < 0) {
    return { ok: false, error: 'Enter a number, optionally starting with + or -' };
  }

  const before = round2(Number(currentCash) || 0);
  const after = round2(mode === 'set' ? amount : mode === 'add' ? before + amount : before - amount);

  if (after < 0) {
    return {
      ok: false,
      error: `That would leave $${after.toFixed(2)}. They only have $${before.toFixed(2)}.`,
    };
  }

  return { ok: true, mode, amount, before, after };
}

/** One line describing what is about to happen, for the confirm dialog. */
export function describeCashChange({ mode, amount }: { mode: CashMode; amount: number }, displayName: string) {
  if (mode === 'set') return `Set ${displayName}'s cash to $${amount.toFixed(2)}`;
  const verb = mode === 'add' ? 'Add' : 'Subtract';
  const prep = mode === 'add' ? 'to' : 'from';
  return `${verb} $${amount.toFixed(2)} ${prep} ${displayName}'s cash`;
}
