import { useCallback, useEffect, useState } from 'react';
import { getSeasonCoordFlagsFunction, setSeasonTopTierExclusionFunction } from '../../firebase';

// Who keeps getting flagged for coordinated trading this season, and the switch
// that keeps a player out of Platinum and Diamond. Loads only while a season runs.
export function useSeasonCoordFlags(active) {
  const [players, setPlayers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [busyUid, setBusyUid] = useState(null);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data } = await getSeasonCoordFlagsFunction({});
      setPlayers(data.players || []);
    } catch (err) {
      console.error(err);
      setError(err.message);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    if (active) load();
  }, [active, load]);

  const toggleExclusion = async (player) => {
    const excluded = !player.excluded;
    if (!confirm(excluded
      ? `Keep ${player.name} out of Platinum and Diamond this season?\n\nThey still score and can still earn Bronze, Silver and Gold. Their place goes to the next player in their division.`
      : `Let ${player.name} compete for Platinum and Diamond again this season?`
    )) return;

    setBusyUid(player.uid);
    setError(null);
    try {
      await setSeasonTopTierExclusionFunction({ uid: player.uid, excluded });
      setPlayers((rows) => rows.map((p) => (p.uid === player.uid ? { ...p, excluded } : p)));
    } catch (err) {
      console.error(err);
      setError(err.message);
    }
    setBusyUid(null);
  };

  return { players, loading, busyUid, error, reload: load, toggleExclusion };
}
