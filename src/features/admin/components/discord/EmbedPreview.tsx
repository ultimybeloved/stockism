// Rough preview of how the message will land in Discord. Deliberately not a
// pixel-perfect clone — it exists so you can see the colour bar, the title and
// the buttons before posting, not to replace looking at Discord.
import type { MessageDraft } from '../../utils/discordDraft';

export default function EmbedPreview({ draft }: { draft: MessageDraft }) {
  const hasEmbed = draft.useEmbed && (draft.embed.title || draft.embed.description || draft.embed.imageUrl);
  const nothing = !draft.content && !hasEmbed && !draft.buttons.length;

  const shell = 'light:bg-white light:text-slate-900 dark:bg-[#313338] dark:text-slate-100';
  const muted = 'light:text-slate-500 dark:text-slate-400';

  return (
    <div className={`rounded-sm border p-3 light:border-slate-300 dark:border-slate-700 ${shell}`}>
      <div className={`text-[10px] uppercase tracking-wide mb-2 ${muted}`}>Preview</div>

      {nothing && <p className={`text-xs italic ${muted}`}>Nothing to show yet.</p>}

      {draft.content && <p className="text-sm whitespace-pre-wrap break-words mb-2">{draft.content}</p>}

      {hasEmbed && (
        <div
          className="rounded-sm pl-3 py-2 pr-2 mb-2 light:bg-slate-100 dark:bg-[#2b2d31]"
          style={{ borderLeft: `4px solid ${draft.embed.color || '#f97316'}` }}
        >
          {draft.embed.title && <div className="font-semibold text-sm mb-1">{draft.embed.title}</div>}
          {draft.embed.description && (
            <div className="text-sm whitespace-pre-wrap break-words opacity-90">{draft.embed.description}</div>
          )}
          {draft.embed.imageUrl && <img src={draft.embed.imageUrl} alt="" className="mt-2 max-h-40 rounded-sm" />}
          {draft.embed.footer && <div className={`text-[11px] mt-2 ${muted}`}>{draft.embed.footer}</div>}
        </div>
      )}

      {draft.buttons.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {draft.buttons
            .filter((b) => b.label)
            .map((b, i) => (
              <span
                key={i}
                className="px-3 py-1.5 text-xs font-medium rounded-sm light:bg-slate-200 light:text-slate-800 dark:bg-slate-600 dark:text-slate-100"
              >
                {b.emoji ? `${b.emoji} ` : ''}
                {b.label}
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
