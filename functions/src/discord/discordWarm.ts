// Keeps the Discord bot's instance awake.
//
// INTERNAL MODULE. Discord gives an interaction 3 seconds, and that includes
// the wake-up of a sleeping instance. In November 2026 about 1 press in 8
// failed that way ("This interaction failed"), every one of them 3 to 6
// seconds old by the time this code ran. A plain GET is answered with a 405
// before any work, but it has to load the module to get there, which is the
// slow part. Called from runGiveaways, which already runs every 5 minutes, so
// it costs no extra scheduled job.
import axios from 'axios';
import * as logger from 'firebase-functions/logger';

const WARM_TIMEOUT_MS = 8000;

export const warmDiscordBot = async () => {
  const project = process.env.GCLOUD_PROJECT;
  // Nothing to wake in the sandbox or the test suites.
  if (!project || process.env.FIRESTORE_EMULATOR_HOST || process.env.FUNCTIONS_EMULATOR) return;
  try {
    await axios.get(`https://us-central1-${project}.cloudfunctions.net/discordInteractions`, {
      timeout: WARM_TIMEOUT_MS,
      validateStatus: () => true,
    });
  } catch (err) {
    // Never worth failing the caller over; the next run tries again.
    logger.warn(`warmDiscordBot: ${(err as Error).message}`);
  }
};
