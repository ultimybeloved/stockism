// Rough preview of how the message will land in Discord. Deliberately not a
// pixel-perfect clone — it exists so you can see the colour bar, the title and
// the buttons before posting, not to replace looking at Discord.
export default function EmbedPreview({ draft, darkMode }) {
  const hasEmbed = draft.useEmbed
    && (draft.embed.title || draft.embed.description || draft.embed.imageUrl);
  const nothing = !draft.content && !hasEmbed && !draft.buttons.length;

  const shell = darkMode ? 'bg-[#313338] text-slate-100' : 'bg-white text-slate-900';
  const muted = darkMode ? 'text-slate-400' : 'text-slate-500';

  return (
    <div className={`rounded-sm border p-3 ${darkMode ? 'border-slate-700' : 'border-slate-300'} ${shell}`}>
      <div className={`text-[10px] uppercase tracking-wide mb-2 ${muted}`}>Preview</div>

      {nothing && <p className={`text-xs italic ${muted}`}>Nothing to show yet.</p>}

      {draft.content && (
        <p className="text-sm whitespace-pre-wrap break-words mb-2">{draft.content}</p>
      )}

      {hasEmbed && (
        <div
          className={`rounded-sm pl-3 py-2 pr-2 mb-2 ${darkMode ? 'bg-[#2b2d31]' : 'bg-slate-100'}`}
          style={{ borderLeft: `4px solid ${draft.embed.color || '#f97316'}` }}
        >
          {draft.embed.title && <div className="font-semibold text-sm mb-1">{draft.embed.title}</div>}
          {draft.embed.description && (
            <div className="text-sm whitespace-pre-wrap break-words opacity-90">{draft.embed.description}</div>
          )}
          {draft.embed.imageUrl && (
            <img src={draft.embed.imageUrl} alt="" className="mt-2 max-h-40 rounded-sm" />
          )}
          {draft.embed.footer && <div className={`text-[11px] mt-2 ${muted}`}>{draft.embed.footer}</div>}
        </div>
      )}

      {draft.buttons.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {draft.buttons.filter((b) => b.label).map((b, i) => (
            <span
              key={i}
              className={`px-3 py-1.5 text-xs font-medium rounded-sm ${darkMode ? 'bg-slate-600 text-slate-100' : 'bg-slate-200 text-slate-800'}`}
            >
              {b.emoji ? `${b.emoji} ` : ''}{b.label}
            </span>
          ))}
        </div>
      )}

      <p className={`text-[11px] mt-2 ${muted}`}>
        Role and user mentions show as raw codes here. In Discord they render as coloured pills.
      </p>
    </div>
  );
}
