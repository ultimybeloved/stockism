import { useEffect, useState } from 'react';
import { useSession } from '../../../context/AppContext';
import { loadBoard, type RankedLeader } from '../../leaderboard/hooks/boardCache';

// A crew's players by net worth: the leaderboard's crew board, through the same
// session cache, so opening the crew page after the leaderboard costs nothing.
export function useCrewPlayers(crewId: string | null) {
  const { user } = useSession();
  const [players, setPlayers] = useState<RankedLeader[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!crewId) return undefined;
    let live = true;
    setLoading(true);
    setFailed(false);
    loadBoard('value', crewId, user?.uid ?? null)
      .then((board) => live && setPlayers(board.leaders))
      .catch(() => live && setFailed(true))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [crewId, user?.uid]);

  return { players, loading, failed };
}
