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

/** A signup refused this week, and the accounts already on its connection. */
export interface ReportSignup {
  name: string;
  /** 'banned' (a connection a ban blocked), 'cap' (connection already full), 'email' (throwaway email). */
  kind: 'banned' | 'cap' | 'email' | 'other';
  /** The ban's reason, for 'banned'. */
  reason?: string;
  /** Names of the accounts already on that connection (the banned group, for 'banned'). */
  linked: string[];
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

const openPairs = (alerts: ReportAlert[], now: number) =>
  alerts
    .filter(
      (a) =>
        a.type === 'alt_suspected' &&
        !a.reviewed &&
        now - a.at <= REPORT_LINK_MAX_AGE_MS &&
        !!a.watchedUID &&
        !!a.relatedUID,
    )
    .map((a) => [a.watchedUID!, a.relatedUID!] as const);

/** The uids of each group of accounts linked by open alt pairs, biggest group first. */
export const linkedGroups = (alerts: ReportAlert[], now: number): string[][] => {
  const parent = new Map<string, string>();
  const find = (u: string): string => {
    let r = u;
    while (parent.get(r) !== r) r = parent.get(r)!;
    parent.set(u, r);
    return r;
  };
  for (const [a, b] of openPairs(alerts, now)) {
    for (const u of [a, b]) if (!parent.has(u)) parent.set(u, u);
    parent.set(find(a), find(b));
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

const listNames = (names: string[]) =>
  names.length <= 1 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;

/**
 * Who in a group shares a connection with whom, one line per account with the
 * most links first: "A shares a connection with B, C and D", then "B also
 * shares one with C". Every pair appears exactly once.
 */
export const groupLinks = (group: string[], pairs: (readonly [string, string])[], nameOf: (uid: string) => string) => {
  const inGroup = new Set(group);
  const left = new Map<string, Set<string>>();
  const link = (x: string, y: string) => {
    if (!left.has(x)) left.set(x, new Set());
    left.get(x)!.add(y);
  };
  for (const [a, b] of pairs) {
    if (!inGroup.has(a) || a === b) continue;
    link(a, b);
    link(b, a);
  }
  const lines: string[] = [];
  for (;;) {
    const hub = [...left.entries()].filter(([, n]) => n.size).sort((x, y) => y[1].size - x[1].size)[0];
    if (!hub) break;
    const [uid, others] = hub;
    const names = listNames([...others].map(nameOf));
    lines.push(
      lines.length
        ? `${nameOf(uid)} also shares one with ${names}`
        : `${nameOf(uid)} shares a connection with ${names}`,
    );
    for (const o of others) left.get(o)?.delete(uid);
    others.clear();
  }
  return lines;
};

const signupLine = (s: ReportSignup) => {
  const who = s.linked.length ? listNames(s.linked) : 'no accounts we could find';
  if (s.kind === 'banned')
    return `"${s.name}" tried to sign up from a connection blocked in a ban (${s.reason || 'banned group'}), used by ${who}`;
  if (s.kind === 'cap') return `"${s.name}" was refused because their connection already has 2 accounts: ${who}`;
  if (s.kind === 'email') return `"${s.name}" used a throwaway email address`;
  return `"${s.name}" was refused at signup`;
};

const money = (n: number) =>
  n >= 1e6 ? `$${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `$${Math.round(n / 1e3)}k` : `$${Math.round(n)}`;

/**
 * The report, split into Discord-sized messages. `members` has the current
 * name, ban and net worth for every uid in the groups; `signups` is this
 * week's refused signups.
 */
export const buildSuspicionReport = (
  alerts: ReportAlert[],
  members: Record<string, ReportMember>,
  signups: ReportSignup[],
  now: number,
  heading: string,
): string[] => {
  const lines = [`${heading} **Weekly suspicious-account report** (private, only you get this)`];

  const groups = linkedGroups(alerts, now);
  const pairs = openPairs(alerts, now);
  if (groups.length) {
    lines.push('', '**Accounts that traded from the same internet connection**');
    groups.slice(0, MAX_GROUPS).forEach((g, i) => {
      const m = (u: string) => members[u] || { name: u, banned: false, value: 0 };
      const nameOf = (u: string) => `${m(u).name}${m(u).banned ? ' (banned)' : ''}`;
      const banned = g.filter((u) => m(u).banned).map((u) => m(u).name);
      const value = g.filter((u) => !m(u).banned).reduce((s, u) => s + m(u).value, 0);
      if (i) lines.push('');
      lines.push(
        `**Group ${i + 1}:** ${g.length} accounts, ${money(value)} between the active ones` +
          (banned.length ? `. **Includes banned ${listNames(banned)}**` : ''),
      );
      for (const l of groupLinks(g, pairs, nameOf)) lines.push(`• ${l}`);
    });
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

  if (signups.length) {
    lines.push('', '**Blocked signups** (this week)');
    for (const s of signups) lines.push(`• ${signupLine(s)}`);
  }

  if (!groups.length && !pushes.length && !repeats.length && !signups.length) {
    lines.push('', 'Quiet week: nothing new to look at.');
  }
  lines.push(
    '',
    'Leads, not proof. A shared connection can be a family or a school. Admin panel → Watchlist to review.',
  );

  return splitForDiscord(lines);
};

/** Lines packed into messages under Discord's 2,000-character limit, never splitting a line. */
export const splitForDiscord = (lines: string[]) => {
  const out: string[] = [];
  let cur = '';
  for (const raw of lines) {
    const line = raw.length > DISCORD_LIMIT ? `${raw.slice(0, DISCORD_LIMIT - 3)}...` : raw;
    if (cur && cur.length + 1 + line.length > DISCORD_LIMIT) {
      out.push(cur);
      cur = line;
    } else cur = cur ? `${cur}\n${line}` : line;
  }
  if (cur) out.push(cur);
  return out;
};
