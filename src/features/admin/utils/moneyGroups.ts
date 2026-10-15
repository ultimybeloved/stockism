// Groups a money-flow day (rules/ledgerFlow) for display: per group and per
// type, cash in, cash out and net. Only the `cash` account counts; ladder chips,
// share grants and cosmetics are tracked in the ledger but are not cash.
import { LEDGER_GROUPS, ledgerTypeInfo } from '../../../rules/ledgerFlow';
import type { LedgerDay } from '../../../rules/ledgerFlow';

export interface FlowLine {
  type: string;
  label: string;
  in: number;
  out: number;
  net: number;
  count: number;
}

export interface FlowGroup {
  id: string;
  label: string;
  in: number;
  out: number;
  net: number;
  lines: FlowLine[];
}

const GROUP_LABEL: Record<string, string> = Object.fromEntries(LEDGER_GROUPS.map((g) => [g.id, g.label]));
const ORDER = [...LEDGER_GROUPS.map((g) => g.id), 'other'];

export function groupFlow(days: (LedgerDay | null | undefined)[], account = 'cash'): FlowGroup[] {
  const lines: Record<string, FlowLine> = {};
  for (const day of days) {
    if (!day) continue;
    for (const [key, row] of Object.entries(day.rows)) {
      const [acct, type] = [key.slice(0, key.indexOf(':')), key.slice(key.indexOf(':') + 1)];
      if (acct !== account) continue;
      const line = (lines[type] ||= { type, label: ledgerTypeInfo(type).label, in: 0, out: 0, net: 0, count: 0 });
      line.in += row.in;
      line.out += row.out;
      line.net = line.in - line.out;
      line.count += row.count;
    }
  }
  const groups: Record<string, FlowGroup> = {};
  for (const line of Object.values(lines)) {
    const id = ledgerTypeInfo(line.type).group;
    const g = (groups[id] ||= { id, label: GROUP_LABEL[id] || 'Other', in: 0, out: 0, net: 0, lines: [] });
    g.in += line.in;
    g.out += line.out;
    g.net = g.in - g.out;
    g.lines.push(line);
  }
  for (const g of Object.values(groups)) g.lines.sort((a, b) => Math.abs(b.net) - Math.abs(a.net));
  return ORDER.map((id) => groups[id]).filter((g): g is FlowGroup => !!g);
}

/** Money created and removed outside stock trading: the faucets and sinks. */
export function faucetsAndSinks(groups: FlowGroup[]) {
  const outside = groups.filter((g) => g.id !== 'trading');
  return {
    created: outside.reduce((s, g) => s + g.in, 0),
    removed: outside.reduce((s, g) => s + g.out, 0),
  };
}
