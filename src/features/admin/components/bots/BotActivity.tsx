// Bots: what the bot engine has been doing. Its recent runs, every price move
// it made in the last two days, and the storyline each stock is on right now.
import { useMemo, useState } from 'react';
import { adminBotActivityFunction } from '../../../../api/callables';
import { useAdminLoad } from '../../hooks/useAdminLoad';
import { ago, int, money2, pct, utc } from '../../utils/termFormat';
import { Empty, Panel, Stat, SubTabs, Tag } from '../shell/ui';
import { signClass, t } from '../shell/terminal';
import type { BotStock } from '../../../../api/adminPanelTypes';

const PHASES: Record<string, string> = {
  calm: 'Quiet',
  climb: 'Climbing',
  slide: 'Sliding',
  choppy: 'Choppy',
  big_day: 'Big day',
  n_slide: 'Sliding',
  n_flat: 'Flat',
  n_bounce: 'Bouncing',
  hold: 'Busy around your price',
};

const KINDS: Record<string, { label: string; tone: 'green' | 'amber' | 'cyan' | 'dim' }> = {
  normal: { label: 'traded', tone: 'green' },
  neglected: { label: 'untraded', tone: 'amber' },
  neglected_still: { label: 'untraded, paused', tone: 'dim' },
  held: { label: 'your price', tone: 'cyan' },
};

const FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'today', label: 'Moved today' },
  { id: 'untraded', label: 'Untraded' },
  { id: 'held', label: 'Your prices' },
];

const inTime = (at: number) => {
  const s = (at - Date.now()) / 1000;
  if (s <= 0) return 'now';
  if (s < 3600) return `${Math.ceil(s / 60)}m`;
  if (s < 86400) return `${Math.round(s / 3600)}h`;
  return `${Math.round(s / 86400)}d`;
};

/** How far the bots have pushed a stock overall, in percent. */
const pushOf = (s: BotStock) => (Math.exp(s.kind === 'held' ? s.holdDrift : s.botDrift) - 1) * 100;

const BotActivity = () => {
  const { data, loading, error, load } = useAdminLoad(() => adminBotActivityFunction({ action: 'bots' }));
  const [filter, setFilter] = useState('all');

  // The newest chart point each stock got from the bots, last two days.
  const lastMove = useMemo(() => {
    const out = new Map<string, number>();
    for (const m of data?.moves || []) if (!out.has(m.ticker)) out.set(m.ticker, m.at);
    return out;
  }, [data]);

  const stocks = useMemo(() => {
    const list = [...(data?.stocks || [])];
    const shown = list.filter((s) => {
      if (filter === 'today') return s.movesToday > 0;
      if (filter === 'untraded') return s.kind === 'neglected' || s.kind === 'neglected_still';
      if (filter === 'held') return s.kind === 'held';
      return true;
    });
    return shown.sort((a, b) => (lastMove.get(b.ticker) || 0) - (lastMove.get(a.ticker) || 0));
  }, [data, filter, lastMove]);

  if (!data) return <Empty>{error ? `Could not load: ${error}` : 'Loading bots...'}</Empty>;

  const day = Date.now() - 86_400_000;
  const moves24 = data.moves.filter((m) => m.at >= day);
  const runs24 = data.runLog.filter((r) => r.at >= day);
  const names = new Map(data.stocks.map((s) => [s.ticker, s.name]));
  const untraded = data.stocks.filter((s) => s.kind === 'neglected' || s.kind === 'neglected_still').length;

  return (
    <div className="space-y-3">
      <div className={`${t.panel} grid grid-cols-5 gap-4 p-3`}>
        <Stat
          label="Last ran"
          value={data.updatedAt ? ago(data.updatedAt) : 'not yet'}
          sub={data.updatedAt ? utc(data.updatedAt) : ''}
        />
        <Stat label="Runs, 24h" value={int(runs24.length)} sub="every 15 min, none while halted" />
        <Stat label="Price moves, 24h" value={int(moves24.length)} tone={t.green} />
        <Stat label="Stocks moved, 24h" value={int(new Set(moves24.map((m) => m.ticker)).size)} />
        <Stat
          label="Guard moves, 24h"
          value={int(moves24.filter((m) => m.guard).length)}
          tone={t.amber}
          sub={`${int(untraded)} stocks untraded`}
        />
      </div>

      <div className="grid grid-cols-3 gap-3 items-start">
        <Panel
          title="Recent price moves"
          pad={false}
          right={
            <button className={t.btn} onClick={load} disabled={loading}>
              {loading ? 'Loading' : 'Refresh'}
            </button>
          }
        >
          {data.moves.length === 0 ? (
            <Empty>No bot moves in the last two days</Empty>
          ) : (
            <div className="max-h-[480px] overflow-y-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr>
                    <th className={t.th}>When</th>
                    <th className={t.th}>Stock</th>
                    <th className={`${t.th} text-right`}>From</th>
                    <th className={`${t.th} text-right`}>To</th>
                    <th className={`${t.th} text-right`}>Move</th>
                  </tr>
                </thead>
                <tbody>
                  {data.moves.map((m, i) => {
                    const change = m.from > 0 ? (m.to / m.from - 1) * 100 : 0;
                    return (
                      <tr key={`${m.at}-${m.ticker}-${i}`} className={t.row} title={names.get(m.ticker)}>
                        <td className={`${t.td} ${t.num} ${t.muted}`}>{utc(m.at).slice(5)}</td>
                        <td className={`${t.td} ${t.num}`}>
                          ${m.ticker} {m.guard && <Tag tone="amber">guard</Tag>}
                        </td>
                        <td className={`${t.td} ${t.num} text-right`}>{money2(m.from)}</td>
                        <td className={`${t.td} ${t.num} text-right`}>{money2(m.to)}</td>
                        <td className={`${t.td} ${t.num} text-right ${signClass(change)}`}>{pct(change, 2)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Panel>

        <Panel title="Recent runs" pad={false}>
          {data.runLog.length === 0 ? (
            <Empty>No runs logged yet</Empty>
          ) : (
            <div className="max-h-[480px] overflow-y-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr>
                    <th className={t.th}>When</th>
                    <th className={`${t.th} text-right`}>Moves</th>
                    <th className={`${t.th} text-right`}>Guard</th>
                    <th className={`${t.th} text-right`} title="Stocks players traded in the last 2 hours">
                      Busy stocks
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {data.runLog.map((r) => (
                    <tr key={r.at} className={t.row}>
                      <td className={`${t.td} ${t.num} ${t.muted}`}>{utc(r.at).slice(5)}</td>
                      <td className={`${t.td} ${t.num} text-right`}>{r.moves}</td>
                      <td className={`${t.td} ${t.num} text-right ${r.guard ? t.amber : t.muted}`}>{r.guard}</td>
                      <td className={`${t.td} ${t.num} text-right ${t.muted}`}>{r.active}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>

        <Panel title="How it works">
          <div className={`text-xs ${t.muted} space-y-2 whitespace-normal`}>
            <p>Every 15 minutes the bots nudge a handful of stocks. Busier markets get more nudges.</p>
            <p>Each stock follows a storyline for a few days: quiet, climbing, sliding, choppy or a big day.</p>
            <p>Stocks nobody has traded for 14 days slide slowly toward their floor, with flat days and bounces.</p>
            <p>A stock you set the price of stays busy within 1.5% of your price for 7 days.</p>
            <p>
              Bot push is how far the bots have moved a traded stock overall. The bigger it gets, the more they lean
              back the other way.
            </p>
          </div>
        </Panel>
      </div>

      <Panel
        title="Storylines"
        pad={false}
        right={<span className={`text-xs ${t.muted}`}>{stocks.length} stocks</span>}
      >
        <SubTabs tabs={FILTERS} active={filter} onChange={setFilter} />
        {stocks.length === 0 ? (
          <Empty>No stocks here</Empty>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr>
                <th className={t.th}>Stock</th>
                <th className={`${t.th} text-right`}>Price</th>
                <th className={t.th}>Status</th>
                <th className={t.th}>Doing</th>
                <th className={`${t.th} text-right`}>Changes in</th>
                <th className={`${t.th} text-right`}>Moves today</th>
                <th className={`${t.th} text-right`}>Last move</th>
                <th className={`${t.th} text-right`} title="For your prices: how far from the price you set">
                  Bot push
                </th>
              </tr>
            </thead>
            <tbody>
              {stocks.map((s) => {
                const kind = s.kind ? KINDS[s.kind] : null;
                const push = pushOf(s);
                // Untraded slides head for the floor and are not counted as push.
                const untracked = s.kind === 'neglected' || s.kind === 'neglected_still';
                return (
                  <tr key={s.ticker} className={t.row}>
                    <td className={t.td}>
                      <span className={t.num}>${s.ticker}</span> <span className={t.muted}>{s.name}</span>
                    </td>
                    <td className={`${t.td} ${t.num} text-right`}>{money2(s.price)}</td>
                    <td className={t.td}>{kind ? <Tag tone={kind.tone}>{kind.label}</Tag> : '-'}</td>
                    <td className={t.td}>{PHASES[s.phase] || s.phase || '-'}</td>
                    <td className={`${t.td} ${t.num} text-right ${t.muted}`}>{s.until ? inTime(s.until) : '-'}</td>
                    <td className={`${t.td} ${t.num} text-right`}>{s.movesToday}</td>
                    <td className={`${t.td} ${t.num} text-right ${t.muted}`}>
                      {lastMove.has(s.ticker) ? ago(lastMove.get(s.ticker)) : '-'}
                    </td>
                    <td className={`${t.td} ${t.num} text-right ${signClass(untracked ? 0 : push)}`}>
                      {untracked ? '-' : pct(push, 1)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Panel>
    </div>
  );
};

export default BotActivity;
