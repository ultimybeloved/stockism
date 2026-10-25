// The weekly suspicious-account report's text, from the watchlist alerts.
//
// INTERNAL MODULE — required by suspicionReport.ts, never listed in services.ts.
//
// The scanners report one pair or one push at a time, and only the high ones
// reach the admin's DMs. Read one by one, a ring hides: five accounts on one
// connection arrive as four separate "medium" pairs. This folds the open alt
// pairs into groups of linked accounts, says when a group includes a banned
// account, lists the week's coordinated pushes, and names anyone in more than
// one push. Everything in it is a lead for the admin, never proof.

export interface ReportAlert {
  type: string;
  severity?: string;
  details?: string;
  reviewed?: boolean;
  /** Epoch ms. */
  at: number;
  names?: string[];
  watchedUID?: string;
  relatedUID?: string | null;
  ticker?: string;
  direction?: string;
  combinedImpact?: number;
  day?: string;
  participants?: string[];
  participantUIDs?: string[];
}

export interface ReportMember {
  name: string;
  banned: boolean;
  /** Net worth now. */
  value: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;
export const REPORT_WEEK_MS = 7 * DAY_MS;
// Open alt pairs stay in the groups this long; after that the admin has
// plainly let them go.
export const REPORT_LINK_MAX_AGE_MS = 30 * DAY_MS;
const MAX_GROUPS = 8;
const MAX_PUSHES = 6;
const DISCORD_LIMIT = 2000;

/** The uids of each group of accounts linked by open alt pairs, biggest group first. */
export const linkedGroups = (alerts: ReportAlert[], now: number): string[][] => {
  const parent = new Map<string, string>();
  const find = (u: string): string => {
    let r = u;
    while (parent.get(r) !== r) r = parent.get(r)!;
    parent.set(u, r);
    return r;
  };
  for (const a of alerts) {
    if (a.type !== 'alt_suspected' || a.reviewed || now - a.at > REPORT_LINK_MAX_AGE_MS) continue;
    if (!a.watchedUID || !a.relatedUID) continue;
    for (const u of [a.watchedUID, a.relatedUID]) if (!parent.has(u)) parent.set(u, u);
    parent.set(find(a.watchedUID), find(a.relatedUID));
  }
  const groups = new Map<string, string[]>();
  for (const u of parent.keys()) {
    const r = find(u);
    groups.set(r, [...(groups.get(r) || []), u]);
  }
  return [...groups.values()].sort((x, y) => y.length - x.length);
};

/** This week's coordinated pushes, newest first. */
const weekPushes = (alerts: ReportAlert[], now: number) =>
  alerts
    .filter((a) => a.type === 'coordinated_pressure' && !a.reviewed && now - a.at <= REPORT_WEEK_MS)
    .sort((x, y) => y.at - x.at);

/** Players in two or more coordinated pushes in the last 30 days, most first. */
const repeatPushers = (alerts: ReportAlert[], now: number) => {
  const count = new Map<string, number>();
  for (const a of alerts) {
    if (a.type !== 'coordinated_pressure' || now - a.at > REPORT_LINK_MAX_AGE_MS) continue;
    for (const n of new Set(a.participants || [])) count.set(n, (count.get(n) || 0) + 1);
  }
  return [...count.entries()].filter(([, n]) => n >= 2).sort((x, y) => y[1] - x[1]);
};

const money = (n: number) =>
  n >= 1e6 ? `$${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `$${Math.round(n / 1e3)}k` : `$${Math.round(n)}`;

/**
 * The report. `members` has the current name, ban and net worth for every uid
 * in the groups; `blockedSignups` is signups refused this week from blocked
 * networks.
 */
export const buildSuspicionReport = (
  alerts: ReportAlert[],
  members: Record<string, ReportMember>,
  blockedSignups: number,
  now: number,
  heading: string,
): string => {
  const lines = [`${heading} **Weekly suspicious-account report** (private, only you get this)`];

  const groups = linkedGroups(alerts, now);
  if (groups.length) {
    lines.push('', '**Linked accounts** (traded from the same connection)');
    for (const g of groups.slice(0, MAX_GROUPS)) {
      const ms = g.map((u) => members[u] || { name: u, banned: false, value: 0 });
      const banned = ms.some((m) => m.banned);
      const names = ms.map((m) => `${m.name}${m.banned ? ' (banned)' : ''}`).join(', ');
      const value = ms.filter((m) => !m.banned).reduce((s, m) => s + m.value, 0);
      lines.push(
        `• ${banned ? '**Tied to a banned account:** ' : ''}${names} · ${g.length} accounts · ${money(value)} combined`,
      );
    }
    if (groups.length > MAX_GROUPS) lines.push(`...and ${groups.length - MAX_GROUPS} more groups`);
  }

  const pushes = weekPushes(alerts, now);
  if (pushes.length) {
    lines.push('', '**Pushed a stock together** (this week)');
    for (const p of pushes.slice(0, MAX_PUSHES)) {
      lines.push(
        `• $${p.ticker} ${p.direction} ${(p.combinedImpact || 0).toFixed(1)}% on ${p.day}: ${(p.participants || []).join(', ')}`,
      );
    }
    if (pushes.length > MAX_PUSHES) lines.push(`...and ${pushes.length - MAX_PUSHES} more`);
  }

  const repeats = repeatPushers(alerts, now);
  if (repeats.length) {
    lines.push(
      '',
      `**In more than one push** (30 days): ${repeats
        .slice(0, 10)
        .map(([n, c]) => `${n} (${c})`)
        .join(', ')}`,
    );
  }

  if (blockedSignups > 0) {
    lines.push('', `**Blocked signups:** ${blockedSignups} this week from blocked networks`);
  }

  if (!groups.length && !pushes.length && !repeats.length && !blockedSignups) {
    lines.push('', 'Quiet week: nothing new to look at.');
  }
  lines.push(
    '',
    'Leads, not proof. A shared connection can be a family or a school. Admin panel → Watchlist to review.',
  );

  const text = lines.join('\n');
  return text.length <= DISCORD_LIMIT ? text : `${text.slice(0, DISCORD_LIMIT - 40)}\n...(cut off, see Watchlist)`;
};
