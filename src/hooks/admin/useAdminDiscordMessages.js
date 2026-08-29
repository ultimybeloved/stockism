import { useState, useCallback } from 'react';
import {
  adminListDiscordChannelsFunction,
  adminListDiscordMessagesFunction,
  adminSendDiscordMessageFunction,
  adminUpdateDiscordMessageFunction,
  adminDeleteDiscordMessageFunction,
  adminImportDiscordMessageFunction,
} from '../../firebase';
import { emptyDraft, draftFromMessage } from './discordDraft';

// Firebase wraps a thrown HttpsError so the readable text is on .message.
const errText = (e) => e?.message || 'Something went wrong.';

// The embed is only sent when the toggle is on, so turning it off and saving
// actually strips the embed from the live message.
const payload = (d, channels) => ({
  channelId: d.channelId,
  channelName: channels.find((c) => c.id === d.channelId)?.name || '',
  label: d.label,
  content: d.content,
  embed: d.useEmbed ? d.embed : null,
  buttons: d.buttons,
  allowMentions: d.allowMentions,
});

/**
 * Admin panel: post, edit and delete messages sent by the Stockism bot.
 *
 * Every message sent through the panel is tracked, so editing one later is a
 * real Discord edit rather than a repost. That is what keeps pins, reactions
 * and links to the message alive.
 */
export function useAdminDiscordMessages({ showMessage }) {
  const [channels, setChannels] = useState([]);
  const [channelNote, setChannelNote] = useState('');
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState(emptyDraft);
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const loadDiscordMessages = useCallback(async () => {
    setBusy(true);
    try {
      const [chan, msgs] = await Promise.all([
        adminListDiscordChannelsFunction(),
        adminListDiscordMessagesFunction(),
      ]);
      setChannels(chan.data.channels || []);
      setChannelNote(chan.data.reason || '');
      setMessages(msgs.data.messages || []);
      setLoaded(true);
    } catch (e) {
      showMessage('error', errText(e));
    } finally {
      setBusy(false);
    }
  }, [showMessage]);

  const patchDraft = useCallback((changes) => setDraft((d) => ({ ...d, ...changes })), []);
  const patchEmbed = useCallback(
    (changes) => setDraft((d) => ({ ...d, embed: { ...d.embed, ...changes } })),
    []
  );

  const addButton = useCallback(
    () => setDraft((d) => (d.buttons.length >= 5 ? d : { ...d, buttons: [...d.buttons, { label: '', url: '', emoji: '' }] })),
    []
  );
  const patchButton = useCallback(
    (i, changes) => setDraft((d) => ({ ...d, buttons: d.buttons.map((b, j) => (j === i ? { ...b, ...changes } : b)) })),
    []
  );
  const removeButton = useCallback(
    (i) => setDraft((d) => ({ ...d, buttons: d.buttons.filter((_, j) => j !== i) })),
    []
  );

  const newDraft = useCallback(() => setDraft(emptyDraft()), []);
  const editMessage = useCallback((msg) => setDraft(draftFromMessage(msg)), []);

  const sendDraft = useCallback(async () => {
    const editing = !!draft.id;
    if (!editing && !draft.channelId) {
      showMessage('error', 'Pick a channel first.');
      return;
    }
    if (draft.allowMentions && !editing
      && !window.confirm('Pings are ON. Any @role or @everyone in this message will notify people. Send it?')) return;

    setBusy(true);
    try {
      const res = editing
        ? await adminUpdateDiscordMessageFunction({ id: draft.id, ...payload(draft, channels) })
        : await adminSendDiscordMessageFunction(payload(draft, channels));
      const saved = res.data.message;
      setMessages((prev) => (editing
        ? prev.map((m) => (m.id === saved.id ? saved : m))
        : [saved, ...prev.filter((m) => m.id !== saved.id)]));
      setDraft(draftFromMessage(saved));
      showMessage('success', editing ? 'Message updated in Discord.' : 'Message posted to Discord.');
    } catch (e) {
      showMessage('error', errText(e));
    } finally {
      setBusy(false);
    }
  }, [draft, channels, showMessage]);

  const deleteMessage = useCallback(async (msg, forget) => {
    const what = forget
      ? `Stop tracking "${msg.label || msg.messageId}"? It stays in Discord, you just can't edit it from here any more.`
      : `Delete "${msg.label || msg.messageId}" from Discord for good? This cannot be undone.`;
    if (!window.confirm(what)) return;

    setBusy(true);
    try {
      await adminDeleteDiscordMessageFunction({ id: msg.id, forget: !!forget });
      setMessages((prev) => prev.filter((m) => m.id !== msg.id));
      setDraft((d) => (d.id === msg.id ? emptyDraft() : d));
      showMessage('success', forget ? 'Stopped tracking it.' : 'Deleted from Discord.');
    } catch (e) {
      showMessage('error', errText(e));
    } finally {
      setBusy(false);
    }
  }, [showMessage]);

  const importMessage = useCallback(async ({ channelId, messageId, label }) => {
    setBusy(true);
    try {
      const res = await adminImportDiscordMessageFunction({ channelId, messageId, label });
      const saved = res.data.message;
      setMessages((prev) => [saved, ...prev.filter((m) => m.id !== saved.id)]);
      setDraft(draftFromMessage(saved));
      showMessage('success', res.data.alreadyTracked ? 'Already tracked, opened it for editing.' : 'Imported. You can edit it now.');
      return true;
    } catch (e) {
      showMessage('error', errText(e));
      return false;
    } finally {
      setBusy(false);
    }
  }, [showMessage]);

  return {
    discordChannels: channels,
    discordChannelNote: channelNote,
    discordMessages: messages,
    discordDraft: draft,
    discordBusy: busy,
    discordLoaded: loaded,
    loadDiscordMessages,
    patchDiscordDraft: patchDraft,
    patchDiscordEmbed: patchEmbed,
    addDiscordButton: addButton,
    patchDiscordButton: patchButton,
    removeDiscordButton: removeButton,
    newDiscordDraft: newDraft,
    editDiscordMessage: editMessage,
    sendDiscordDraft: sendDraft,
    deleteDiscordMessage: deleteMessage,
    importDiscordMessage: importMessage,
  };
}
