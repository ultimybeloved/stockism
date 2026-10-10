// Shared helpers for the emulator suites. Every suite runs against the LOCAL
// Firebase emulators that `firebase emulators:exec` starts; nothing here can
// reach production.
import { expect } from 'vitest';
import { execFileSync } from 'child_process';

export const PROJECT_ID = process.env.GCLOUD_PROJECT || 'stockism-abb28';

const describeDetail = (detail?: unknown) =>
  detail === undefined || detail === '' ? '' : ` — ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`;

/**
 * One named assertion. Logs a line like the old scripts did and records a soft
 * failure, so one bad check doesn't hide the ones after it.
 */
export const check = (label: string, cond: unknown, detail?: unknown) => {
  console.log(`${cond ? '  ✅' : '  ❌'} ${label}${cond ? '' : describeDetail(detail)}`);
  expect.soft(Boolean(cond), `${label}${describeDetail(detail)}`).toBe(true);
};

/** Wipes the emulator's Firestore (and Auth, when it is running). */
export async function resetEmulator() {
  const firestore = process.env.FIRESTORE_EMULATOR_HOST;
  if (!firestore) throw new Error('FIRESTORE_EMULATOR_HOST is not set. Run the suites through npm run test:emulator.');
  const wipe = async (url: string) => {
    const res = await fetch(url, { method: 'DELETE' });
    if (!res.ok) throw new Error(`Emulator reset failed: ${res.status} ${url}`);
  };
  await wipe(`http://${firestore}/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`);
  const auth = process.env.FIREBASE_AUTH_EMULATOR_HOST;
  if (auth) await wipe(`http://${auth}/emulator/v1/projects/${PROJECT_ID}/accounts`);
}

/** Writes the starting market doc, as `npm run seed:emulator` does. */
export function seedEmulator() {
  execFileSync(process.execPath, ['--import', 'tsx', 'scripts/seed-emulator.cjs'], { stdio: 'inherit' });
}

/**
 * Whatever the code under test wrote to the emulator. Suites read it loosely,
 * the way the JavaScript versions did.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Loose = any;
