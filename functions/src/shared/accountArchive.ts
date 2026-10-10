// Keeps a copy of an account before it is deleted.
//
// Deletion used to erase everything the account held, so after the fact there
// was no way to see what it owned, how it got it, or which market shares it
// took with it. The copy goes to deletedUsers/{uid} (admin-only), and any open
// long-term market position is also written to the event-trade history as a
// 'deleted' record, because those shares stay counted in the market's q.
import * as admin from 'firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import { buildEventTradeRecord, eventTradesCol } from './eventTradeRecords';

type Position = { shares?: Record<string, number>; settled?: boolean } | null | undefined;

export const deletedUsersCol = () => admin.firestore().collection('deletedUsers');

// Runs before the user doc is deleted. Throws on failure so the caller can stop
// the deletion rather than lose the record.
export const archiveAccount = async (uid: string, userData: Record<string, unknown>, deletedBy: string) => {
  const batch = admin.firestore().batch();
  batch.set(deletedUsersCol().doc(uid), {
    uid,
    displayName: userData.displayName ?? null,
    deletedAt: FieldValue.serverTimestamp(),
    deletedBy,
    data: userData,
  });

  const positions = (userData.eventPositions || {}) as Record<string, Position>;
  for (const [marketId, pos] of Object.entries(positions)) {
    if (!pos || pos.settled) continue;
    for (const [outcome, shares] of Object.entries(pos.shares || {})) {
      if (!(shares > 0)) continue;
      batch.set(
        eventTradesCol().doc(),
        buildEventTradeRecord({
          uid,
          displayName: (userData.displayName as string) ?? null,
          marketId,
          outcome,
          action: 'deleted',
          shares,
          cash: 0,
        }),
      );
    }
  }
  await batch.commit();
};
