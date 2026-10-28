import { useCallback, useEffect, useState } from 'react';
import {
  adminCreateGiveawayFunction,
  adminEndGiveawayFunction,
  adminListGiveawaysFunction,
} from '../../../api/callables';
import { errorMessage } from '../../../utils/errors';
import { tierProblem, type GiveawayTier } from '../../../rules/giveaways';
import { COSMETIC_MAP } from '../../../constants/cosmetics';
import type { AdminGiveaway } from '../../../api/adminPanelTypes';

export interface GiveawayDraft {
  title: string;
  text: string;
  channelId: string;
  roleId: string;
  /** UTC, as typed: YYYY-MM-DD and HH:MM. */
  endDate: string;
  endTime: string;
  tiers: GiveawayTier[];
}

const blankDraft = (): GiveawayDraft => ({
  title: '',
  text: '',
  channelId: '',
  roleId: '',
  endDate: '',
  endTime: '21:00',
  tiers: [{ prize: { kind: 'credit', amount: 50000 }, winners: 1 }],
});

export const draftEndsAt = (d: GiveawayDraft) => Date.parse(`${d.endDate}T${d.endTime || '00:00'}:00Z`);

// Admin panel giveaways: the draft being built, the recent list, and the
// start / end early / cancel actions (functions/src/admin/adminGiveaways.ts).
export function useAdminGiveaways() {
  const [draft, setDraft] = useState<GiveawayDraft>(blankDraft);
  const [list, setList] = useState<AdminGiveaway[]>([]);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(async () => {
    try {
      setList((await adminListGiveawaysFunction()).data.giveaways);
    } catch (e) {
      setNote({ ok: false, text: errorMessage(e) || 'Could not load giveaways.' });
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const patch = (p: Partial<GiveawayDraft>) => setDraft((d) => ({ ...d, ...p }));
  const patchTier = (i: number, t: GiveawayTier) =>
    setDraft((d) => ({ ...d, tiers: d.tiers.map((x, j) => (j === i ? t : x)) }));
  const addTier = () =>
    setDraft((d) => ({ ...d, tiers: [...d.tiers, { prize: { kind: 'credit', amount: 50000 }, winners: 1 }] }));
  const removeTier = (i: number) => setDraft((d) => ({ ...d, tiers: d.tiers.filter((_, j) => j !== i) }));
  const moveTier = (i: number, by: -1 | 1) =>
    setDraft((d) => {
      const tiers = [...d.tiers];
      const j = i + by;
      if (j < 0 || j >= tiers.length) return d;
      [tiers[i], tiers[j]] = [tiers[j]!, tiers[i]!];
      return { ...d, tiers };
    });

  const problem =
    (!draft.title.trim() && 'Give it a title.') ||
    (!draft.channelId && 'Pick a channel.') ||
    (!Number.isFinite(draftEndsAt(draft)) && 'Set the end date and time.') ||
    tierProblem(draft.tiers, (id) => !!COSMETIC_MAP[id] && !COSMETIC_MAP[id]!.earned);

  const start = async () => {
    if (problem || busy) return;
    setBusy(true);
    setNote(null);
    try {
      await adminCreateGiveawayFunction({
        title: draft.title.trim(),
        text: draft.text.trim(),
        channelId: draft.channelId,
        roleId: draft.roleId || null,
        endsAt: draftEndsAt(draft),
        tiers: draft.tiers,
      });
      setNote({ ok: true, text: 'Posted. The bot draws and pays the winners when it ends.' });
      setDraft(blankDraft());
      await load();
    } catch (e) {
      setNote({ ok: false, text: errorMessage(e) || 'Could not start it.' });
    } finally {
      setBusy(false);
    }
  };

  const end = async (id: string, cancel: boolean) => {
    setBusy(true);
    setNote(null);
    try {
      const { data } = await adminEndGiveawayFunction({ id, cancel });
      setNote({ ok: true, text: cancel ? 'Cancelled.' : `Ended. ${data.winners ?? 0} winners drawn and paid.` });
      await load();
    } catch (e) {
      setNote({ ok: false, text: errorMessage(e) || 'That did not work.' });
    } finally {
      setBusy(false);
    }
  };

  return { draft, patch, patchTier, addTier, removeTier, moveTier, problem, start, end, list, load, busy, note };
}
