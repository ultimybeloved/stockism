import { COSMETIC_MAP } from '../../../../constants/cosmetics';
import { getPinCollection } from '../../../../crews';
import { prizeLabel, totalWinners } from '../../../../rules/giveaways';
import { draftEndsAt, useAdminGiveaways } from '../../hooks/useAdminGiveaways';
import type { AdminCommonProps } from '../types';
import type { DiscordChannel } from '../../../../api/types';
import AdminIcon from '../AdminIcon';
import GiveawayTierRow from './GiveawayTierRow';

// Server roles a giveaway post can ping.
const ROLES = [
  { id: '1470587217607921674', name: 'Announcements' },
  { id: '1470587257051418838', name: 'Updates' },
  { id: '1534468500620578899', name: 'Event' },
];
// Names a cosmetic or a pin collection in prize labels.
const nameOf = (id: string) => COSMETIC_MAP[id]?.name ?? getPinCollection(id)?.name;
const utc = (ms: number) => new Date(ms).toISOString().slice(0, 16).replace('T', ' ') + ' UTC';

// Start a bot giveaway in Discord and watch it through to the payout. The bot
// only lets linked accounts enter, draws the prizes top to bottom (nobody wins
// twice in the same draw), and pays the winners itself.
export default function GiveawayCard({
  textClass,
  mutedClass,
  inputClass,
  channels,
}: Pick<AdminCommonProps, 'textClass' | 'mutedClass' | 'inputClass'> & { channels: DiscordChannel[] }) {
  const g = useAdminGiveaways();
  const { draft } = g;
  const field = `px-2 py-1.5 text-sm rounded-sm border ${inputClass}`;
  const labelCls = `block text-xs font-semibold mb-1 ${mutedClass}`;
  const endsAt = draftEndsAt(draft);

  return (
    <div className="p-4 rounded-sm border light:bg-white light:border-slate-200 dark:bg-slate-800 dark:border-slate-700 space-y-4">
      <div>
        <h3 className={`font-semibold ${textClass}`}>
          <AdminIcon name="gift" />
          Giveaways
        </h3>
        <p className={`text-xs ${mutedClass}`}>
          Only players with a linked Discord can enter, one entry each. Prizes are drawn top to bottom and nobody wins
          twice in the same draw; put a prize in Draw 2 to let earlier winners win it too. Skip top leaves out that many
          players from the top of the leaderboard. Winners are paid automatically when it ends.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="sm:col-span-2">
          <span className={labelCls}>Title</span>
          <input
            className={`${field} w-full`}
            value={draft.title}
            maxLength={100}
            onChange={(e) => g.patch({ title: e.target.value })}
          />
        </label>
        <label className="sm:col-span-2">
          <span className={labelCls}>Message (optional)</span>
          <textarea
            className={`${field} w-full`}
            rows={3}
            maxLength={1500}
            value={draft.text}
            onChange={(e) => g.patch({ text: e.target.value })}
          />
        </label>
        <label>
          <span className={labelCls}>Channel</span>
          <select
            className={`${field} w-full`}
            value={draft.channelId}
            onChange={(e) => g.patch({ channelId: e.target.value })}
          >
            <option value="">Pick a channel</option>
            {channels.map((c) => (
              <option key={c.id} value={c.id}>
                #{c.name}
              </option>
            ))}
          </select>
        </label>
        <div>
          <span className={labelCls}>Ping roles (ids, comma separated, up to 3)</span>
          <input
            className={`${field} w-full`}
            value={draft.roleIds}
            onChange={(e) => g.patch({ roleIds: e.target.value })}
          />
          <div className="flex gap-2 mt-1">
            {ROLES.map((r) => (
              <button
                key={r.id}
                className={`text-xs underline ${mutedClass}`}
                onClick={() =>
                  !draft.roleIds.includes(r.id) &&
                  g.patch({ roleIds: [draft.roleIds.trim(), r.id].filter(Boolean).join(', ') })
                }
              >
                + {r.name}
              </button>
            ))}
          </div>
        </div>
        <label>
          <span className={labelCls}>Ends (date, UTC)</span>
          <input
            type="date"
            className={`${field} w-full`}
            value={draft.endDate}
            onChange={(e) => g.patch({ endDate: e.target.value })}
          />
        </label>
        <label>
          <span className={labelCls}>Ends (time, UTC, 24h)</span>
          <input
            type="time"
            className={`${field} w-full`}
            value={draft.endTime}
            onChange={(e) => g.patch({ endTime: e.target.value })}
          />
        </label>
      </div>

      <div className="space-y-2">
        <span className={labelCls}>Prizes, drawn in this order</span>
        {draft.tiers.map((t, i) => (
          <GiveawayTierRow
            key={i}
            i={i}
            tier={t}
            count={draft.tiers.length}
            field={field}
            mutedClass={mutedClass}
            onChange={(next) => g.patchTier(i, next)}
            onMove={(by) => g.moveTier(i, by)}
            onRemove={() => g.removeTier(i)}
          />
        ))}
        <button className={`text-xs underline ${mutedClass}`} onClick={g.addTier}>
          Add a prize
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button
          onClick={() => {
            if (window.confirm(`Post this giveaway (${totalWinners(draft.tiers)} winners) to Discord now?`))
              void g.start();
          }}
          disabled={!!g.problem || g.busy}
          className="px-4 py-2 text-sm font-semibold rounded-sm bg-teal-600 hover:bg-teal-700 text-white disabled:opacity-50"
        >
          {g.busy ? 'Working…' : 'Post giveaway'}
        </button>
        <span className={`text-xs ${g.problem ? 'text-amber-500' : mutedClass}`}>
          {g.problem || `${totalWinners(draft.tiers)} winners, ends ${utc(endsAt)}`}
        </span>
      </div>
      {g.note && <p className={`text-sm ${g.note.ok ? 'text-teal-500' : 'text-red-500'}`}>{g.note.text}</p>}

      <div className="space-y-2">
        <h4 className={`text-sm font-semibold ${textClass}`}>Recent</h4>
        {g.list.length === 0 && <p className={`text-sm ${mutedClass}`}>None yet.</p>}
        {g.list.map((x) => (
          <div key={x.id} className="p-3 rounded-sm border light:border-slate-200 dark:border-slate-700 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className={`font-semibold ${textClass}`}>{x.title}</span>
              <span className={`text-xs ${mutedClass}`}>
                {x.status}, {x.entries || 0} entries, ends {utc(x.endsAt)}
              </span>
            </div>
            <ul className={`text-xs mt-1 ${mutedClass}`}>
              {x.tiers.map((t, i) => (
                <li key={i}>
                  {t.everyone ? 'Everyone' : `${t.winners} x`} {prizeLabel(t.prize, nameOf)}
                  {t.draw && t.draw > 1 ? ` (draw ${t.draw})` : ''}
                  {t.skipTop ? ` (skips top ${t.skipTop})` : ''}
                  {t.everyone && x.winners?.length
                    ? `: ${x.winners.filter((w) => w.tier === i).length} players`
                    : x.winners?.some((w) => w.tier === i) &&
                      `: ${x.winners
                        .filter((w) => w.tier === i)
                        .map((w) => w.name)
                        .join(', ')}`}
                </li>
              ))}
            </ul>
            {x.status === 'open' && (
              <div className="flex gap-3 mt-2">
                <button
                  className="text-xs font-semibold text-teal-500"
                  disabled={g.busy}
                  onClick={() => window.confirm('Draw and pay the winners now?') && void g.end(x.id, false)}
                >
                  End now
                </button>
                <button
                  className="text-xs font-semibold text-red-500"
                  disabled={g.busy}
                  onClick={() => window.confirm('Cancel this giveaway? Nobody wins.') && void g.end(x.id, true)}
                >
                  Cancel
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
