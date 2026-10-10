// The emulator suites. They need running emulators, so `npm test` leaves them
// out; `npm run test:emulator` starts the emulators and runs them all, and each
// `npm run test:<suite>` runs one.
//
// Two projects because they need different emulators: `core` runs against
// Firestore + Auth, `functions` also boots the functions emulator (slow, and its
// triggers would interfere with the core suites).
import { defineConfig } from 'vitest/config';

const shared = {
  environment: 'node',
  setupFiles: ['functions/test/setup.ts', 'tests/emulator/setup.ts'],
  // One emulator, so one file at a time, each in a fresh process.
  pool: 'forks',
  fileParallelism: false,
  isolate: true,
  testTimeout: 10 * 60 * 1000,
  hookTimeout: 2 * 60 * 1000,
  // The suites print a line per check; show it only when something failed.
  silent: 'passed-only',
};

export default defineConfig({
  test: {
    projects: [
      { test: { ...shared, name: 'core', include: ['tests/emulator/*.test.ts'] } },
      { test: { ...shared, name: 'functions', include: ['tests/emulator/functions/*.test.ts'] } },
    ],
  },
});
