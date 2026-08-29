import { formatUTCDateTime } from '../../../utils/formatters';

// Everything the panel can still edit. A message only appears here if it was
// posted through the panel or imported — the bot's automated posts (daily drop,
// market alerts) are not tracked and are not meant to be hand-edited.
export default function TrackedMessageList({
  darkMode, textClass, mutedClass,
  messages, activeId, busy, onEdit, onDelete,
}) {
  if (!messages.length) {
    return (
      <p className={`text-sm ${mutedClass}`}>
        Nothing tracked yet. Post one above, or import a message the bot already sent.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      {messages.map((m) => {
        const active = m.id === activeId;
        return (
          <div
            key={m.id}
            className={`p-3 rounded-sm border ${
              active
                ? 'border-teal-500'
                : darkMode ? 'border-slate-700' : 'border-slate-200'
            } ${darkMode ? 'bg-slate-800' : 'bg-white'}`}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className={`text-sm font-semibold truncate ${textClass}`}>
                  {m.label || m.embed?.title || m.content?.slice(0, 60) || 'Untitled'}
                  {m.imported && <span className={`ml-2 text-[10px] font-normal ${mutedClass}`}>imported</span>}
                </div>
                <div className={`text-xs ${mutedClass}`}>
                  {m.channelName ? `#${m.channelName}` : `channel ${m.channelId}`}
                  {' · '}
                  {m.updatedAt ? `edited ${formatUTCDateTime(m.updatedAt)}` : 'never edited'}
                </div>
              </div>
              <div className="flex gap-2 shrink-0">
                <button
                  onClick={() => onEdit(m)}
                  disabled={busy}
                  className="px-3 py-1 text-xs font-semibold rounded-sm bg-teal-600 hover:bg-teal-700 text-white disabled:opacity-50"
                >
                  Edit
                </button>
                {/* Forget keeps the message in Discord and only drops our record —
                    the right move for anything another tool also writes. */}
                <button
                  onClick={() => onDelete(m, true)}
                  disabled={busy}
                  className={`px-2 py-1 text-xs rounded-sm ${darkMode ? 'bg-slate-700' : 'bg-slate-200'} ${mutedClass} disabled:opacity-50`}
                  title="Stop tracking it here, leave it in Discord"
                >
                  Forget
                </button>
                <button
                  onClick={() => onDelete(m, false)}
                  disabled={busy}
                  className="px-2 py-1 text-xs rounded-sm bg-red-600/80 hover:bg-red-600 text-white disabled:opacity-50"
                  title="Delete it from Discord"
                >
                  Delete
                </button>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
