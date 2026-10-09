// Each suite used to get a freshly started emulator. They now share one, so
// every file starts from an empty database instead.
import { beforeAll } from 'vitest';
import { resetEmulator } from './harness.js';

beforeAll(resetEmulator);
