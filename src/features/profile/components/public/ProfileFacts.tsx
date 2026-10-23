// The four quick facts under the banner: net worth, ranks and join date.
import { formatCurrency } from '../../../../utils/formatters';
import { themeClasses } from '../../../../utils/theme';
import type { PublicProfile } from '../../../../api/types';

const { cardClass, textClass, mutedClass } = themeClasses;

/** Join date, from a serialized Firestore Timestamp or milliseconds. */
export const joinedOn = (createdAt: PublicProfile['stats']['createdAt']) => {
  const ms = createdAt == null ? null : typeof createdAt === 'object' ? createdAt._seconds * 1000 : createdAt;
  return ms ? new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '-';
};

const ProfileFacts = ({ profile }: { profile: PublicProfile }) => {
  const facts = [
    ['Net worth', formatCurrency(profile.portfolioValue || 0)],
    ['Global rank', profile.rank ? `#${profile.rank}` : '-'],
    ['Crew rank', profile.crewRank ? `#${profile.crewRank}` : '-'],
    ['Joined', joinedOn(profile.stats?.createdAt)],
  ];
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
      {facts.map(([label, value]) => (
        <div key={label} className={`${cardClass} border rounded-sm px-3 py-2.5 min-w-0`}>
          <div className={`text-[11px] uppercase tracking-wider ${mutedClass}`}>{label}</div>
          <div className={`text-lg font-bold truncate ${textClass}`}>{value}</div>
        </div>
      ))}
    </div>
  );
};

export default ProfileFacts;
