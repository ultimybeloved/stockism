// Acknowledging a Discord interaction without slowing down the work after it.
//
// INTERNAL MODULE. Discord needs an answer within 3s, so anything slower
// acknowledges first ("thinking...", or a message update) and edits the real
// content in after. Answering through the HTTP reply made that work crawl:
// Cloud Functions counts a request as finished once it is answered and
// throttles the instance, so the reads, the transaction and every edit after
// it ran on a throttled CPU (logs showed the request "taking" a few ms while
// the reply arrived seconds later). That was the bot's famous wait.
//
// So acknowledge through Discord's callback API instead and keep the HTTP
// request open until the work is done; call the returned release() then, on
// every path. If the callback fails, answer the HTTP request the old way so
// the interaction is still acknowledged.
import axios from 'axios';
import type { Response } from 'express';
import { reportError } from '../shared/sentry';

export const holdAck = async (
  interaction: { id: string; token: string },
  res: Response,
  ack: Record<string, unknown>,
): Promise<() => void> => {
  try {
    await axios.post(`https://discord.com/api/v10/interactions/${interaction.id}/${interaction.token}/callback`, ack);
    return () => void res.status(204).send('');
  } catch (err) {
    reportError(err, { where: 'discordHoldAck' });
    res.json(ack);
    return () => {};
  }
};
