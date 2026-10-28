import { COSMETICS, COSMETIC_MAP } from '../../../../constants/cosmetics';
import { prizeLabel, totalWinners, type GiveawayPrize } from '../../../../rules/giveaways';
import { draftEndsAt, useAdminGiveaways } from '../../hooks/useAdminGiveaways';
import type { AdminCommonProps } from '../types';
import type { DiscordChannel } from '../../../../api/types';
import AdminIcon from '../AdminIcon';

// Server roles a giveaway post can ping.
const ROLES = [
  { id: '', name: 'No ping' },
  { id: '1470587217607921674', name: 'Announcements' },
  { id: '1470587257051418838', name: 'Updates' },
  { id: '1534468500620578899', name: 'Event' },
];
const SELLABLE = COSMETICS.filter((c) => !c.earned).sort((a, b) => a.name.localeCompare(b.name));
const nameOf = (id: string) => COSMETIC_MAP[id]?.name;
const utc = (ms: number) => new Date(ms).toISOString().slice(0, 16).replace('T', ' ') + ' UTC';

// Start a bot giveaway in Discord and watch it through to the payout. The bot
// only lets linked accounts enter, draws the prizes top to bottom (nobody wins
// twice), and pays the winners itself.
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

  const setKind = (i: number, kind: GiveawayPrize['kind']) =>
    g.patchTier(i, {
      ...draft.tiers[i]!,
      prize: kind === 'cosmetic' ? { kind, cosmeticId: SELLABLE[0]!.id } : { kind, amount: 50000 },
    });

  return (
    <div className="p-4 rounded-sm border light:bg-white light:border-slate-200 dark:bg-slate-800 dark:border-slate-700 space-y-4">
      <div>
        <h3 className={`font-semibold ${textClass}`}>
          <AdminIcon name="gift" />
          Giveaways
        </h3>
        <p className={`text-xs ${mutedClass}`}>
          Only players with a linked Discord can enter, one entry each. Prizes are drawn top to bottom, nobody wins
          twice, and winners are paid automatically when it ends.
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
        <label>
          <span className={labelCls}>Ping</span>
          <select
            className={`${field} w-full`}
            value={draft.roleId}
            onChange={(e) => g.patch({ roleId: e.target.value })}
          >
            {ROLES.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        </label>
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
          <div key={i} className="flex flex-wrap items-center gap-2">
            <span className={`text-xs w-5 ${mutedClass}`}>{i + 1}.</span>
            <input
              type="number"
              min={1}
              aria-label="Winners"
              className={`${field} w-20`}
              value={t.winners}
              onChange={(e) => g.patchTier(i, { ...t, winners: Math.floor(Number(e.target.value)) })}
            />
            <span className={`text-xs ${mutedClass}`}>{t.winners === 1 ? 'winner gets' : 'winners each get'}</span>
            <select
              aria-label="Prize type"
              className={field}
              value={t.prize.kind}
              onChange={(e) => setKind(i, e.target.value as GiveawayPrize['kind'])}
            >
              <option value="credit">Shop credit</option>
              <option value="cash">Cash</option>
              <option value="cosmetic">Cosmetic</option>
            </select>
            {t.prize.kind === 'cosmetic' ? (
              <select
                aria-label="Cosmetic"
                className={field}
                value={t.prize.cosmeticId}
                onChange={(e) => g.patchTier(i, { ...t, prize: { kind: 'cosmetic', cosmeticId: e.target.value } })}
              >
                {SELLABLE.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} (${c.price.toLocaleString()})
                  </option>
                ))}
              </select>
            ) : (
              <input
                type="number"
                min={1}
                aria-label="Amount"
                className={`${field} w-32`}
                value={t.prize.amount}
                onChange={(e) =>
                  g.patchTier(i, {
                    ...t,
                    prize: { kind: t.prize.kind as 'credit' | 'cash', amount: Math.floor(Number(e.target.value)) },
                  })
                }
              />
            )}
            <button className={`text-xs ${mutedClass}`} onClick={() => g.moveTier(i, -1)} aria-label="Move up">
              Up
            </button>
            <button className={`text-xs ${mutedClass}`} onClick={() => g.moveTier(i, 1)} aria-label="Move down">
              Down
            </button>
            {draft.tiers.length > 1 && (
              <button className="text-xs text-red-500" onClick={() => g.removeTier(i)}>
                Remove
              </button>
            )}
          </div>
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
                  {t.winners} x {prizeLabel(t.prize, nameOf)}
                  {x.winners?.some((w) => w.tier === i) &&
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
