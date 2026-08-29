// Draft shape for the admin Discord message composer. Split out of
// useAdminDiscordMessages.js to keep the hook under the 200-line limit; this is
// pure shape conversion with no state or effects.

// Site orange. Matches the rules embed already in the server.
export const DEFAULT_EMBED_COLOR = '#f97316';

export const emptyEmbed = () => ({
  title: '', description: '', color: DEFAULT_EMBED_COLOR, imageUrl: '', footer: '',
});

export const emptyDraft = () => ({
  id: null,            // set once the message exists, which flips send -> edit
  channelId: '',
  label: '',
  content: '',
  useEmbed: false,
  embed: emptyEmbed(),
  buttons: [],
  allowMentions: false,
});

// A saved message stores the embed colour as a number; the colour input needs
// '#rrggbb'.
const toHex = (n) => `#${Math.max(0, Math.min(0xffffff, n | 0)).toString(16).padStart(6, '0')}`;

/** Turn a tracked message from the server back into an editable draft. */
export function draftFromMessage(msg) {
  return {
    id: msg.id,
    channelId: msg.channelId,
    label: msg.label || '',
    content: msg.content || '',
    useEmbed: !!msg.embed,
    embed: msg.embed
      ? {
          title: msg.embed.title || '',
          description: msg.embed.description || '',
          color: typeof msg.embed.color === 'number' ? toHex(msg.embed.color) : DEFAULT_EMBED_COLOR,
          imageUrl: msg.embed.imageUrl || '',
          footer: msg.embed.footer || '',
        }
      : emptyEmbed(),
    buttons: (msg.buttons || []).map((b) => ({ ...b })),
    allowMentions: !!msg.allowMentions,
  };
}
