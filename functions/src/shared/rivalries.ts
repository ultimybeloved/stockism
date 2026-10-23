// The live Crew Rivalry board: rivalries/{weekId}, world-readable.
//
// { weekId, matches: [[crewA, crewB], ...],
//   crews: { [crewId]: { active: { uid: true }, qualified: { uid: true } } },
//   settled?, results? }
//
// `crews` is display only, written after the claim or check-in commits so it
// never adds a hot document to those transactions. The weekly settlement
// (functions/src/crews/rivalries.ts) recounts everything from the user docs.

import * as admin from 'firebase-admin';
import * as logger from 'firebase-functions/logger';
const db = admin.firestore();

export const rivalryRef = (weekId: string) => db.collection('rivalries').doc(weekId);

/** Mark a player active (and maybe qualified) on their crew's side of the board. */
export async function noteRivalryActivity(weekId: string, crew: string, uid: string, qualified = false) {
  try {
    await rivalryRef(weekId).set(
      { crews: { [crew]: { active: { [uid]: true }, ...(qualified ? { qualified: { [uid]: true } } : {}) } } },
      { merge: true },
    );
  } catch (err) {
    logger.warn('noteRivalryActivity failed:', (err as Error).message);
  }
}
