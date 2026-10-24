import { missionWeekId, missionWeekStartMs } from '../../../rules/missions';
import type { WeeklyRecap } from '../../../rules/weeklyRecap';
import { useSession } from '../../../context/AppContext';
import { useSeenFlag } from '../../../shared/hooks/useSeenFlag';

/**
 * Last week's recap, once the Thursday reopen has stored it (null for a week
 * the player sat out), and whether they've closed it on the home page.
 * Closing is per browser; the Missions page always shows it.
 */
export function useWeeklyRecap(): { recap: WeeklyRecap | null; closed: boolean; close: () => void } {
  const { userData } = useSession();
  const recap = userData?.weeklyRecap || null;
  const lastWeek = missionWeekId(missionWeekStartMs() - 1);
  const current = recap && recap.weekId === lastWeek ? recap : null;
  const [unseen, close] = useSeenFlag(`weeklyRecap:${lastWeek}`);
  return { recap: current, closed: !unseen, close };
}
