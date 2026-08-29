import EmbedPreview from './EmbedPreview';

const CONTENT_MAX = 2000;
const EMBED_TITLE_MAX = 256;
const EMBED_DESCRIPTION_MAX = 4096;
const MAX_BUTTONS = 5;

// Compose a new bot message, or edit one that is already in Discord. Which of
// the two is decided by draft.id: an existing message edits in place, which is
// what keeps its pins, reactions and links alive.
export default function MessageComposer({
  darkMode, textClass, mutedClass, inputClass,
  draft, channels, channelNote, busy,
  onPatch, onPatchEmbed, onAddButton, onPatchButton, onRemoveButton,
  onSend, onNew,
}) {
  const editing = !!draft.id;
  const field = `w-full px-3 py-2 text-sm rounded-sm border ${inputClass}`;
  const labelCls = `block text-xs font-semibold mb-1 ${mutedClass}`;
  const channel = channels.find((c) => c.id === draft.channelId);

  return (
    <div className={`p-4 rounded-sm border ${darkMode ? 'bg-slate-800 border-slate-700' : 'bg-white border-slate-200'}`}>
      <div className="flex items-center justify-between mb-3">
        <h3 className={`font-semibold ${textClass}`}>
          {editing ? '✏️ Editing a live message' : '💬 New message'}
        </h3>
        {editing && (
          <button onClick={onNew} className={`text-xs underline ${mutedClass} hover:text-teal-500`}>
            Start a new one instead
          </button>
        )}
      </div>

      {editing && (
        <p className="text-xs mb-3 px-2 py-1.5 rounded-sm bg-amber-500/15 text-amber-500">
          Saving edits the message that is already in Discord, in {channel ? `#${channel.name}` : 'its channel'}.
          It does not post a new one.
        </p>
      )}

      {/* Channel is locked once the message exists — Discord cannot move a
          message between channels, only delete and repost. */}
      <div className="grid sm:grid-cols-2 gap-3 mb-3">
        <div>
          <label className={labelCls}>Channel</label>
          {editing ? (
            <div className={`${field} opacity-60`}>{channel ? `#${channel.name}` : draft.channelId}</div>
          ) : channels.length ? (
            <select
              value={draft.channelId}
              onChange={(e) => onPatch({ channelId: e.target.value })}
              className={field}
            >
              <option value="">Pick a channel…</option>
              {channels.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.category ? `${c.category} / ` : ''}#{c.name}
                </option>
              ))}
            </select>
          ) : (
            <input
              value={draft.channelId}
              onChange={(e) => onPatch({ channelId: e.target.value.trim() })}
              placeholder="Paste a channel ID"
              className={field}
            />
          )}
          {!!channelNote && !editing && (
            <p className={`text-[11px] mt-1 ${mutedClass}`}>
              Channel list unavailable ({channelNote}) — paste the ID instead.
            </p>
          )}
        </div>
        <div>
          <label className={labelCls}>Name it (only you see this)</label>
          <input
            value={draft.label}
            onChange={(e) => onPatch({ label: e.target.value })}
            maxLength={100}
            placeholder="e.g. Server rules"
            className={field}
          />
        </div>
      </div>

      <div className="mb-3">
        <label className={labelCls}>
          Message text <span className="font-normal">({draft.content.length}/{CONTENT_MAX})</span>
        </label>
        <textarea
          value={draft.content}
          onChange={(e) => onPatch({ content: e.target.value })}
          maxLength={CONTENT_MAX}
          rows={4}
          placeholder="Plain text. Leave empty if you only want the box below."
          className={field}
        />
      </div>

      {/* Embed = the bordered box with the coloured bar, like the rules message. */}
      <label className={`flex items-center gap-2 mb-3 text-sm ${textClass}`}>
        <input
          type="checkbox"
          checked={draft.useEmbed}
          onChange={(e) => onPatch({ useEmbed: e.target.checked })}
        />
        Add a fancy box (embed)
      </label>

      {draft.useEmbed && (
        <div className={`p-3 mb-3 rounded-sm border ${darkMode ? 'border-slate-700 bg-slate-900/40' : 'border-slate-200 bg-slate-50'}`}>
          <div className="grid sm:grid-cols-[1fr_auto] gap-3 mb-3">
            <div>
              <label className={labelCls}>Box title</label>
              <input
                value={draft.embed.title}
                onChange={(e) => onPatchEmbed({ title: e.target.value })}
                maxLength={EMBED_TITLE_MAX}
                className={field}
              />
            </div>
            <div>
              <label className={labelCls}>Colour</label>
              <input
                type="color"
                value={draft.embed.color}
                onChange={(e) => onPatchEmbed({ color: e.target.value })}
                className="h-[38px] w-16 rounded-sm border border-slate-500 bg-transparent"
              />
            </div>
          </div>
          <div className="mb-3">
            <label className={labelCls}>
              Box body <span className="font-normal">({draft.embed.description.length}/{EMBED_DESCRIPTION_MAX})</span>
            </label>
            <textarea
              value={draft.embed.description}
              onChange={(e) => onPatchEmbed({ description: e.target.value })}
              maxLength={EMBED_DESCRIPTION_MAX}
              rows={6}
              className={field}
            />
          </div>
          <div className="grid sm:grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Image link (optional, https)</label>
              <input
                value={draft.embed.imageUrl}
                onChange={(e) => onPatchEmbed({ imageUrl: e.target.value.trim() })}
                placeholder="https://…"
                className={field}
              />
            </div>
            <div>
              <label className={labelCls}>Small footer text (optional)</label>
              <input
                value={draft.embed.footer}
                onChange={(e) => onPatchEmbed({ footer: e.target.value })}
                className={field}
              />
            </div>
          </div>
        </div>
      )}

      {/* Link buttons only. They open a URL and fire no interaction, so nothing
          has to be listening on the backend for them to keep working. */}
      <div className="mb-3">
        <div className="flex items-center justify-between mb-1">
          <label className={labelCls}>Link buttons ({draft.buttons.length}/{MAX_BUTTONS})</label>
          {draft.buttons.length < MAX_BUTTONS && (
            <button onClick={onAddButton} className="text-xs underline text-teal-500">+ add button</button>
          )}
        </div>
        {draft.buttons.map((b, i) => (
          <div key={i} className="grid grid-cols-[3rem_1fr_2fr_auto] gap-2 mb-2">
            <input
              value={b.emoji}
              onChange={(e) => onPatchButton(i, { emoji: e.target.value })}
              placeholder="🔗"
              className={`px-2 py-2 text-sm rounded-sm border text-center ${inputClass}`}
            />
            <input
              value={b.label}
              onChange={(e) => onPatchButton(i, { label: e.target.value })}
              placeholder="Button text"
              maxLength={80}
              className={`px-3 py-2 text-sm rounded-sm border ${inputClass}`}
            />
            <input
              value={b.url}
              onChange={(e) => onPatchButton(i, { url: e.target.value.trim() })}
              placeholder="https://…"
              className={`px-3 py-2 text-sm rounded-sm border ${inputClass}`}
            />
            <button onClick={() => onRemoveButton(i)} className="px-2 text-red-500 hover:text-red-400">×</button>
          </div>
        ))}
      </div>

      <label className={`flex items-center gap-2 mb-4 text-sm ${textClass}`}>
        <input
          type="checkbox"
          checked={draft.allowMentions}
          onChange={(e) => onPatch({ allowMentions: e.target.checked })}
        />
        Let this message ping people
        <span className={`text-xs ${mutedClass}`}>(off = @role and @everyone show but notify nobody)</span>
      </label>

      <div className="mb-4">
        <EmbedPreview draft={draft} darkMode={darkMode} />
      </div>

      <button
        onClick={onSend}
        disabled={busy}
        className="px-4 py-2 text-sm font-semibold rounded-sm bg-orange-600 hover:bg-orange-700 text-white disabled:opacity-50"
      >
        {busy ? 'Working…' : editing ? 'Save changes to Discord' : 'Post to Discord'}
      </button>
    </div>
  );
}
