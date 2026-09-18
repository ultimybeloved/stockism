import { useEffect, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import {
  db,
  adminStartSeasonFunction,
  adminEndSeasonFunction,
  triggerSeasonCheckpointFunction,
} from '../../firebase';

// Season controls for the admin panel. Starting a season pins a baseline on
// every account, and ending one hands out permanent titles — both are one-way,
// so every action here confirms first.
export function useAdminSeason({ showMessage, setLoading }) {
  const [season, setSeason] = useState(null);
  const [seasonName, setSeasonName] = useState('');
  const [preseason, setPreseason] = useState(false);
  const [countThisWeek, setCountThisWeek] = useState(false);

  useEffect(() => {
    const unsub = onSnapshot(
      doc(db, 'market', 'season'),
      (snap) => setSeason(snap.exists() ? snap.data() : null),
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
      `Start a new ${preseason ? 'PRESEASON (trial run)' : 'season'} for "${name}"?\n\n` +
      'This pins a baseline on EVERY account. Anyone who joins later competes from when they ' +
      'joined, and last season\'s tiers are cleared.\n\nThis cannot be undone.'
    )) return;

    setLoading(true);
    try {
      const { data } = await adminStartSeasonFunction({ name, preseason, countThisWeek });
      showMessage('success', `${data.preseason ? 'Preseason' : `Season ${data.number}`} "${data.name}" started. ${data.playersPinned} baselines pinned.`);
      setSeasonName('');
      setPreseason(false);
      setCountThisWeek(false);
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
      'Standings freeze, Platinum and Diamond are handed out, titles go to every tier that ' +
      'pays one, and the results are filed.\n\n' +
      'Best pressed during the Thursday halt, the week the arc finale lands. Prices are ' +
      'frozen then, so nobody can spike the closing numbers.\n\nThis cannot be undone.'
    )) return;

    setLoading(true);
    try {
      const { data } = await adminEndSeasonFunction({});
      const counts = Object.entries(data.tierCounts || {}).map(([tier, n]) => `${n} ${tier}`).join(', ');
      showMessage('success', `${season.name} ended. ${data.totalScored} scored, ${data.awarded} earned a tier${counts ? ` (${counts})` : ''}.`);
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
        ? `Checkpoint done. Week ${data.weeks}, ${data.scored} scored, ${data.promoted} promoted.`
        : `Nothing to do: ${data.reason}.`);
    } catch (err) {
      console.error(err);
      showMessage('error', `Failed: ${err.message}`);
    }
    setLoading(false);
  };

  return {
    season, seasonName, setSeasonName, preseason, setPreseason, countThisWeek, setCountThisWeek,
    handleStartSeason, handleEndSeason, handleRunCheckpoint,
  };
}
