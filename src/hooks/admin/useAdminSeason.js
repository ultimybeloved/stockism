import { useEffect, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import {
  db,
  adminStartSeasonFunction,
  adminEndSeasonFunction,
  triggerSeasonCheckpointFunction,
} from '../../firebase';
import { DEFAULT_SEASON_THRESHOLDS } from '../../constants/seasons';

// Season controls for the admin panel. Starting a season pins a baseline on
// every account, and ending one hands out permanent titles — both are one-way,
// so every action here confirms first.
export function useAdminSeason({ showMessage, setLoading }) {
  const [season, setSeason] = useState(null);
  const [seasonName, setSeasonName] = useState('');
  const [thresholds, setThresholds] = useState(DEFAULT_SEASON_THRESHOLDS);

  useEffect(() => {
    const unsub = onSnapshot(
      doc(db, 'market', 'season'),
      (snap) => {
        const d = snap.exists() ? snap.data() : null;
        setSeason(d);
        if (d?.thresholds) setThresholds(d.thresholds);
      },
      (err) => console.error('Season subscription failed:', err)
    );
    return unsub;
  }, []);

  const handleStartSeason = async () => {
    const name = seasonName.trim();
    if (!name) {
      showMessage('error', 'Name the arc first (e.g. "Gapryong Kim Arc")');
      return;
    }
    if (!confirm(
      `Start a new season for "${name}"?\n\n` +
      'This pins a baseline on EVERY account. Anyone who joins later competes from a ' +
      'shorter window, and last season\'s tiers are cleared.\n\nThis cannot be undone.'
    )) return;

    setLoading(true);
    try {
      const { data } = await adminStartSeasonFunction({ name, thresholds });
      showMessage('success', `Season ${data.number} "${data.name}" started — ${data.playersPinned} baselines pinned.`);
      setSeasonName('');
    } catch (err) {
      console.error(err);
      showMessage('error', `Failed: ${err.message}`);
    }
    setLoading(false);
  };

  const handleEndSeason = async () => {
    if (!season || season.status !== 'active') return;
    if (!confirm(
      `End "${season.name}" now?\n\n` +
      'Standings freeze, everyone who earned a tier gets their two titles permanently, ' +
      'and the results are filed.\n\n' +
      'Best pressed during the Thursday halt, the week the arc finale lands — prices are ' +
      'frozen then, so nobody can spike the closing numbers.\n\nThis cannot be undone.'
    )) return;

    setLoading(true);
    try {
      const { data } = await adminEndSeasonFunction({});
      showMessage('success', `${season.name} ended — ${data.totalScored} scored, ${data.awarded} earned a tier.`);
    } catch (err) {
      console.error(err);
      showMessage('error', `Failed: ${err.message}`);
    }
    setLoading(false);
  };

  const handleRunCheckpoint = async () => {
    setLoading(true);
    try {
      const { data } = await triggerSeasonCheckpointFunction({});
      showMessage('success', data.ran
        ? `Checkpoint done — week ${data.weeks}, ${data.scored} scored, ${data.promoted} promoted.`
        : `Nothing to do: ${data.reason}.`);
    } catch (err) {
      console.error(err);
      showMessage('error', `Failed: ${err.message}`);
    }
    setLoading(false);
  };

  return {
    season, seasonName, setSeasonName, thresholds, setThresholds,
    handleStartSeason, handleEndSeason, handleRunCheckpoint,
  };
}
