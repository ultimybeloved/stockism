// Long-term markets close at every weekly halt (rules/eventTrading). The admin
// reopens them after the chapter review, and can close one by hand at any time.
import { doc, runTransaction } from 'firebase/firestore';
import { db } from '../../../firebase';
import type { PredictionDoc } from '../../../types';
import { logPanelAction } from './panelLog';

const updateMarkets = async (change: (p: PredictionDoc) => PredictionDoc) => {
  const predictionsRef = doc(db, 'predictions', 'current');
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(predictionsRef);
    const list: PredictionDoc[] = snap.exists() ? snap.data().list || [] : [];
    tx.update(predictionsRef, { list: list.map(change) });
  });
};

/** Close one market by hand, or reopen it. */
export const toggleEventTrading = async (predictionId: string) => {
  const now = Date.now();
  await updateMarkets((p) => {
    if (p.id !== predictionId) return p;
    return p.tradingClosed ? { ...p, tradingClosed: false, reopenedAt: now } : { ...p, tradingClosed: true };
  });
  await logPanelAction({ action: 'toggle_event_trading', after: { id: predictionId } });
};

/** After the chapter review: reopen every live market except any closed by hand. */
export const reopenEventMarkets = async () => {
  const now = Date.now();
  await updateMarkets((p) =>
    p.type === 'event' && !p.resolved && !p.cancelled && !p.tradingClosed ? { ...p, reopenedAt: now } : p,
  );
  await logPanelAction({ action: 'reopen_event_markets' });
};
