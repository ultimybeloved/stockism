// The admin players table: which fields each row keeps, net worth, filters
// and sorting. Pure, so the table component only draws.
import { getLastActiveMs } from '../../../rules/activity';
import { ms } from './termFormat';
import type { AdminUser } from './adminShared';
import type { UserData } from '../../../types';

// Extra fields the table shows, on top of withUserDefaults. The list loads the
// whole users collection, so rows keep only these; the player file loads the rest.
const LIST_FIELDS = [
  'createdAt',
  'lastActive',
  'lastSynced',
  'lastTradeTime',
  'lastCheckin',
  'eventPositionsValue',
  'grantedValue',
  'isBanned',
  'isBot',
  'welcomeStreak',
  'checkinStreak',
  'isCrewHead',
  'seasonTier',
  'activeTitle',
] as const;

export const pickListFields = (data: UserData) => {
  const out: Partial<UserData> = {};
  for (const f of LIST_FIELDS) if (data[f] !== undefined) (out as Record<string, unknown>)[f] = data[f];
  return out;
};

/** Leaderboard net worth: portfolio minus margin debt plus long-term market positions. */
export const netWorth = (u: Pick<UserData, 'portfolioValue' | 'marginUsed' | 'eventPositionsValue'>) =>
  (u.portfolioValue || 0) - (u.marginUsed || 0) + Math.max(0, u.eventPositionsValue || 0);

export const joinedMs = (u: UserData) => ms(u.createdAt);
export const activeMs = (u: UserData) => getLastActiveMs(u) || null;

export type PlayerFilter =
  'all' | 'active24h' | 'active7d' | 'new7d' | 'linked' | 'unlinked' | 'welcome' | 'margin' | 'banned' | 'bots';

export const PLAYER_FILTERS: { id: PlayerFilter; label: string }[] = [
  { id: 'all', label: 'All players' },
  { id: 'active24h', label: 'Active 24h' },
  { id: 'active7d', label: 'Active 7d' },
  { id: 'new7d', label: 'New this week' },
  { id: 'linked', label: 'Discord linked' },
  { id: 'unlinked', label: 'Not linked' },
  { id: 'welcome', label: 'In welcome week' },
  { id: 'margin', label: 'Using margin' },
  { id: 'banned', label: 'Banned' },
  { id: 'bots', label: 'Bots' },
];

const DAY = 86400000;

export function matchesFilter(u: AdminUser, filter: PlayerFilter, now = Date.now()): boolean {
  if (filter === 'bots') return !!u.isBot;
  if (u.isBot) return false;
  switch (filter) {
    case 'active24h':
      return (activeMs(u) || 0) > now - DAY;
    case 'active7d':
      return (activeMs(u) || 0) > now - 7 * DAY;
    case 'new7d':
      return (joinedMs(u) || 0) > now - 7 * DAY;
    case 'linked':
      return !!u.discordId;
    case 'unlinked':
      return !u.discordId;
    case 'welcome': {
      const day = u.welcomeStreak?.day || 0;
      return day > 0 && day < 7;
    }
    case 'margin':
      return (u.marginUsed || 0) > 0;
    case 'banned':
      return !!u.isBanned;
    default:
      return true;
  }
}

export function matchesSearch(u: AdminUser, query: string) {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return (
    (u.displayName || '').toLowerCase().includes(q) ||
    u.id.toLowerCase().includes(q) ||
    String(u.discordId || '').includes(q) ||
    String(u.discordUsername || '')
      .toLowerCase()
      .includes(q)
  );
}

export type PlayerSort =
  'name' | 'netWorth' | 'cash' | 'margin' | 'granted' | 'trades' | 'streak' | 'crew' | 'joined' | 'active' | 'welcome';

const SORT_VALUE: Record<PlayerSort, (u: AdminUser) => number | string> = {
  name: (u) => (u.displayName || '').toLowerCase(),
  netWorth: (u) => netWorth(u),
  cash: (u) => u.cash || 0,
  margin: (u) => u.marginUsed || 0,
  granted: (u) => u.grantedValue || 0,
  trades: (u) => u.totalTrades || 0,
  streak: (u) => u.checkinStreak || 0,
  crew: (u) => u.crew || '',
  joined: (u) => joinedMs(u) || 0,
  active: (u) => activeMs(u) || 0,
  welcome: (u) => u.welcomeStreak?.day || 0,
};

export function sortPlayers(users: AdminUser[], sort: PlayerSort, desc: boolean) {
  const val = SORT_VALUE[sort];
  return [...users].sort((a, b) => {
    const [x, y] = [val(a), val(b)];
    const c = typeof x === 'string' ? x.localeCompare(String(y)) : x - (y as number);
    return desc ? -c : c;
  });
}
