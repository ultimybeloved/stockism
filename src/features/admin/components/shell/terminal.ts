// Class tokens for the admin command panel's terminal look. The colours are
// CSS variables set on the panel root in src/styles/adminTerminal.css.
export const t = {
  panel: 'bg-[var(--t-panel)] border border-[var(--t-line)]',
  panel2: 'bg-[var(--t-panel2)] border border-[var(--t-line)]',
  head: 't-mono text-[11px] uppercase tracking-[0.14em] text-[var(--t-muted)]',
  label: 't-mono text-[10px] uppercase tracking-[0.12em] text-[var(--t-muted)]',
  text: 'text-[var(--t-text)]',
  muted: 'text-[var(--t-muted)]',
  dim: 'text-[var(--t-dim)]',
  num: 't-mono tabular-nums',
  green: 'text-[var(--t-green)]',
  red: 'text-[var(--t-red)]',
  amber: 'text-[var(--t-amber)]',
  cyan: 'text-[var(--t-cyan)]',
  violet: 'text-[var(--t-violet)]',
  input:
    'px-2.5 py-1.5 text-sm border rounded-none bg-[var(--t-bg)] border-[var(--t-line2)] text-[var(--t-text)] placeholder:text-[var(--t-dim)]',
  btn: 't-mono text-[11px] uppercase tracking-wider px-3 py-1.5 border border-[var(--t-line2)] text-[var(--t-text)] hover:border-[var(--t-green)] hover:text-[var(--t-green)] disabled:opacity-40 disabled:pointer-events-none',
  btnGo:
    't-mono text-[11px] uppercase tracking-wider px-3 py-1.5 bg-[var(--t-green)] text-black font-bold hover:brightness-110 disabled:opacity-40 disabled:pointer-events-none',
  btnDanger:
    't-mono text-[11px] uppercase tracking-wider px-3 py-1.5 border border-[var(--t-red)] text-[var(--t-red)] hover:bg-[var(--t-red)] hover:text-black disabled:opacity-40 disabled:pointer-events-none',
  row: 'border-b border-[var(--t-line)] hover:bg-[var(--t-raise)]',
  th: 't-mono text-[10px] uppercase tracking-wider text-[var(--t-muted)] font-normal text-left px-2 py-1.5 border-b border-[var(--t-line2)] whitespace-nowrap',
  td: 'px-2 py-1 whitespace-nowrap',
};

/** Green for up, red for down, muted for flat. */
export const signClass = (n: number | null | undefined) => (!n ? t.muted : n > 0 ? t.green : t.red);
