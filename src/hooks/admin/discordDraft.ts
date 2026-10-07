// Draft shape for the admin Discord message composer. Split out of
// useAdminDiscordMessages.js to keep the hook under the 200-line limit; this is
// pure shape conversion with no state or effects.

// Site orange. Matches the rules embed already in the server.
export const DEFAULT_EMBED_COLOR = '#f97316';

export interface DraftEmbed {
  title: string;
  description: string;
  color: string;
  imageUrl: string;
  footer: string;
}

export interface DraftButton {
  label?: string;
  url?: string;
  [key: string]: unknown;
}

export interface MessageDraft {
  id: string | null;
  channelId: string;
  label: string;
  content: string;
  useEmbed: boolean;
  embed: DraftEmbed;
  buttons: DraftButton[];
  allowMentions: boolean;
}

/** A bot message as stored (config/discordMessages). Embed color is a number there. */
export interface StoredDiscordMessage {
  id: string;
  channelId: string;
  label?: string;
  content?: string;
  embed?: { title?: string; description?: string; color?: number; imageUrl?: string; footer?: string } | null;
  buttons?: DraftButton[];
  allowMentions?: boolean;
}

export const emptyEmbed = (): DraftEmbed => ({
  title: '',
  description: '',
  color: DEFAULT_EMBED_COLOR,
  imageUrl: '',
  footer: '',
});

export const emptyDraft = (): MessageDraft => ({
  id: null, // set once the message exists, which flips send -> edit
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
const toHex = (n: number) =>
  `#${Math.max(0, Math.min(0xffffff, n | 0))
    .toString(16)
    .padStart(6, '0')}`;

/** Turn a tracked message from the server back into an editable draft. */
export function draftFromMessage(msg: StoredDiscordMessage): MessageDraft {
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
