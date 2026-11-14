import { useEffect, useState, type RefObject } from 'react';
import { useSession } from '../../../context/AppContext';
import { themeClasses } from '../../../utils/theme';
import { formatCurrency } from '../../../utils/formatters';
import { RECRUITER_REWARD, RECRUIT_MIN_AGE_DAYS, RECRUIT_PLAY_TEXT, RECRUITS_SORT } from '../../../rules/recruiting';
import InviteCard from '../../profile/components/InviteCard';
import { loadBoard, type RankedLeader } from '../hooks/boardCache';
import LeaderboardPodium from './LeaderboardPodium';
import LeaderboardRow from './LeaderboardRow';

// Top recruiters: players ranked by how many people they brought in who stuck
// (rules/recruiting). Its own ranking, so it replaces the list like the season
// board does. The player's invite link sits on top: this is where it pays off.
const RecruiterBoard = ({ userRowRef }: { userRowRef: RefObject<HTMLDivElement | null> }) => {
  const { user } = useSession();
  const { mutedClass, divideClass } = themeClasses;
  const [leaders, setLeaders] = useState<RankedLeader[] | null>(null);
  const [failed, setFailed] = useState(false);
  const uid = user?.uid ?? null;

  useEffect(() => {
    let live = true;
    loadBoard(RECRUITS_SORT, null, uid)
      .then((board) => live && setLeaders(board.leaders))
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, [uid]);

  const podium = !!leaders && leaders.length >= 3;
  const rows = leaders ? (podium ? leaders.slice(3) : leaders) : [];

  return (
    <div>
      <div className="p-3 space-y-2">
        <p className={`text-xs ${mutedClass}`}>
          Ranked by recruits who stuck: they joined through the player's invite link, linked Discord, and kept playing
          for {RECRUIT_MIN_AGE_DAYS} days ({RECRUIT_PLAY_TEXT}). Each one pays the recruiter{' '}
          {formatCurrency(RECRUITER_REWARD)}.
        </p>
        <InviteCard hideBoardLink />
      </div>
      {failed ? (
        <p className="text-center py-8 text-red-400">Could not load the recruiters board.</p>
      ) : !leaders ? (
        <p className={`text-center py-8 ${mutedClass}`}>Loading...</p>
      ) : leaders.length === 0 ? (
        <div className={`text-center py-8 px-4 ${mutedClass}`}>
          <p>Nobody is on the board yet.</p>
          <p className="text-sm">
            {user ? 'Share your invite link to be the first.' : 'Sign in to get your invite link and be the first.'}
          </p>
        </div>
      ) : (
        <>
          {podium && <LeaderboardPodium leaders={leaders} sortBy={RECRUITS_SORT} user={user} userRowRef={userRowRef} />}
          <div className={`divide-y ${divideClass}`}>
            {rows.map((leader) => (
              <LeaderboardRow
                key={leader.id}
                leader={leader}
                displayRank={leader.rank}
                isCurrentUser={leader.id === uid}
                userRowRef={userRowRef}
                sortBy={RECRUITS_SORT}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
};

export default RecruiterBoard;
