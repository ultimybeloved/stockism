import MessageComposer from './discord/MessageComposer';
import TrackedMessageList from './discord/TrackedMessageList';
import ImportMessageForm from './discord/ImportMessageForm';
import AnnounceCard from './AnnounceCard';

// Send and edit messages as the Stockism bot without touching code.
//
// The whole point is that a bot message stays editable forever, so everything
// sent here is recorded with its channel and message id. Fixing a typo later is
// an edit, not a repost, which keeps the pin and any links to it alive.
export default function DiscordTab({
  darkMode, textClass, mutedClass, inputClass,
  discordChannels, discordChannelNote, discordMessages, discordDraft, discordBusy, discordLoaded,
  loadDiscordMessages,
  patchDiscordDraft, patchDiscordEmbed,
  addDiscordButton, patchDiscordButton, removeDiscordButton,
  newDiscordDraft, editDiscordMessage, sendDiscordDraft,
  deleteDiscordMessage, importDiscordMessage,
}) {
  const common = { darkMode, textClass, mutedClass, inputClass };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className={`font-semibold ${textClass}`}>💬 Discord Messages</h3>
          <p className={`text-xs ${mutedClass}`}>
            Posts as the Stockism bot. Anything sent here can be edited later, in place.
          </p>
        </div>
        <button
          onClick={loadDiscordMessages}
          disabled={discordBusy}
          className={`px-3 py-1.5 text-xs font-semibold rounded-sm ${darkMode ? 'bg-slate-700' : 'bg-slate-200'} ${textClass} disabled:opacity-50`}
        >
          {discordBusy ? 'Loading…' : 'Refresh'}
        </button>
      </div>

      <MessageComposer
        {...common}
        draft={discordDraft}
        channels={discordChannels}
        channelNote={discordChannelNote}
        busy={discordBusy}
        onPatch={patchDiscordDraft}
        onPatchEmbed={patchDiscordEmbed}
        onAddButton={addDiscordButton}
        onPatchButton={patchDiscordButton}
        onRemoveButton={removeDiscordButton}
        onSend={sendDiscordDraft}
        onNew={newDiscordDraft}
      />

      <div>
        <h4 className={`text-sm font-semibold mb-2 ${textClass}`}>Editable messages</h4>
        {discordLoaded ? (
          <TrackedMessageList
            {...common}
            messages={discordMessages}
            activeId={discordDraft.id}
            busy={discordBusy}
            onEdit={editDiscordMessage}
            onDelete={deleteDiscordMessage}
          />
        ) : (
          <p className={`text-sm ${mutedClass}`}>Loading…</p>
        )}
      </div>

      <ImportMessageForm {...common} busy={discordBusy} onImport={importDiscordMessage} />

      {/* In-app bell announcements live next to Discord ones because they are the
          same job from the admin's side: tell everybody something. */}
      <AnnounceCard darkMode={darkMode} />
    </div>
  );
}
