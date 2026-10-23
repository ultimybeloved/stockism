// Player file, overview tab: the money picture, net worth over time, and
// every fact about the account on one screen.
import type { ReactNode } from 'react';
import { WELCOME_STREAK_DAYS, WELCOME_STREAK_REWARDS } from '../../../../rules/welcome';
import { netWorth } from '../../utils/playerRows';
import { ago, int, money, signedMoney, utc, utcDate, ms } from '../../utils/termFormat';
import LineChart from '../shell/LineChart';
import { Panel, Stat, Tag } from '../shell/ui';
import { signClass, t } from '../shell/terminal';
import type { PlayerFileResponse } from '../../../../api/adminPanelTypes';
import type { PriceMap } from '../../../../types';

const Fact = ({ label, children }: { label: string; children: ReactNode }) => (
  <div className="flex items-baseline justify-between gap-3 py-1 border-b border-[var(--t-line)] text-sm">
    <span className={t.muted}>{label}</span>
    <span className={`${t.num} text-right truncate`}>{children}</span>
  </div>
);

const PlayerOverview = ({ file }: { file: PlayerFileResponse; prices: PriceMap }) => {
  const u = file.user;
  const nw = netWorth(u);
  const trading = (u.portfolioValue || 0) - (u.marginUsed || 0);
  const granted = u.grantedValue || 0;
  // Snapshots taken before they recorded the debt count today's debt, like the boards do.
  const snap = (s: { value?: number; marginUsed?: number } | undefined) =>
    s?.value != null ? s.value - (s.marginUsed ?? u.marginUsed ?? 0) : null;
  const d1 = snap(u.portfolioSnapshot24h);
  const d7 = snap(u.portfolioSnapshot7d);
  const d30 = snap(u.portfolioSnapshot30d);

  const history = file.history
    .map((h) => ({ x: ms(h.timestamp) || 0, y: Number(h.value) - (Number(h.marginUsed) || 0) }))
    .filter((p) => p.x && Number.isFinite(p.y))
    .sort((a, b) => a.x - b.x);

  const w = u.welcomeStreak;
  const welcomeDay = w?.day || 0;
  const ladderBalance = Number((file.ladder as Record<string, unknown> | null)?.balance ?? 0);
  const da = file.discordActivity;
  const holdingsCount = Object.values(u.holdings || {}).filter(
    (v) => Number(typeof v === 'object' ? (v as { shares?: number }).shares : v) > 0,
  ).length;
  const shortsCount = Object.values(u.shorts || {}).filter((p) => p && p.shares > 0).length;

  return (
    <div className="space-y-3">
      <div className={`${t.panel} grid grid-cols-4 xl:grid-cols-8 gap-4 p-3`}>
        <Stat label="Net worth" value={money(nw)} tone={t.green} sub="what the boards rank" />
        <Stat label="Cash" value={money(u.cash)} />
        <Stat label="Portfolio value" value={money(u.portfolioValue)} sub="before margin debt" />
        <Stat label="Margin debt" value={money(u.marginUsed)} tone={u.marginUsed ? t.amber : t.muted} />
        <Stat label="Long-term markets" value={money(u.eventPositionsValue)} sub="sell-back value" />
        <Stat label="Free money" value={money(granted)} sub="grants, rewards, flows" />
        <Stat
          label="Net minus free money"
          value={signedMoney(trading - granted)}
          tone={signClass(trading - granted)}
          sub="includes starting cash"
        />
        <Stat label="Peak" value={money(u.peakPortfolioValue)} />
      </div>

      <div className="grid grid-cols-3 gap-3">
        <Panel
          title="Net worth over time"
          className="col-span-2"
          right={
            <span className={`${t.num} text-xs`}>
              <span className={signClass(d1 == null ? 0 : trading - d1)}>
                24h {d1 == null ? '-' : signedMoney(trading - d1)}
              </span>
              {'  '}
              <span className={signClass(d7 == null ? 0 : trading - d7)}>
                7d {d7 == null ? '-' : signedMoney(trading - d7)}
              </span>
              {'  '}
              <span className={signClass(d30 == null ? 0 : trading - d30)}>
                30d {d30 == null ? '-' : signedMoney(trading - d30)}
              </span>
            </span>
          }
        >
          <LineChart points={history} height={170} />
        </Panel>

        <Panel title="Welcome week">
          {!u.discordId ? (
            <p className={`text-sm ${t.muted}`}>Not linked to Discord, so they can't start it.</p>
          ) : welcomeDay === 0 ? (
            <p className={`text-sm ${t.muted}`}>Hasn't started. They run /welcome in the official server.</p>
          ) : (
            <div className="space-y-2">
              <div className="flex gap-1">
                {Array.from({ length: WELCOME_STREAK_DAYS }, (_, i) => (
                  <div key={i} className="flex-1 text-center">
                    <div className="h-6" style={{ background: i < welcomeDay ? 'var(--t-amber)' : 'var(--t-line2)' }} />
                    <div className={`${t.label} mt-0.5`}>${WELCOME_STREAK_REWARDS[i]}</div>
                  </div>
                ))}
              </div>
              <Fact label="Progress">
                {welcomeDay}/{WELCOME_STREAK_DAYS}{' '}
                {welcomeDay >= WELCOME_STREAK_DAYS && <Tag tone="green">finished</Tag>}
              </Fact>
              <Fact label="Last claim">{w?.lastClaimDay || '-'}</Fact>
              <Fact label="Paid so far">
                {money(WELCOME_STREAK_REWARDS.slice(0, welcomeDay).reduce((s, r) => s + r, 0))}
              </Fact>
              {file.welcome?.completedAt && <Fact label="Finished">{utc(file.welcome.completedAt)}</Fact>}
            </div>
          )}
        </Panel>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <Panel title="Account">
          <Fact label="Joined">{utc(u.createdAt)}</Fact>
          <Fact label="Last opened the app">{utc(u.lastSynced)}</Fact>
          <Fact label="Last move">{utc(u.lastActive)}</Fact>
          <Fact label="Last trade">{utc(u.lastTradeTime)}</Fact>
          <Fact label="Last check-in">{utc(u.lastCheckin)}</Fact>
          <Fact label="Name changed">{u.nameChangedAt ? utc(u.nameChangedAt) : 'never'}</Fact>
          <Fact label="Profile">{u.isPublic === false ? 'private' : 'public'}</Fact>
          <Fact label="Theme">
            {u.darkMode === false ? 'light' : 'dark'}
            {u.colorBlindMode ? ', color-blind mode' : ''}
          </Fact>
        </Panel>

        <Panel title="Playing">
          <Fact label="Trades">{int(u.totalTrades)}</Fact>
          <Fact label="Stocks held / shorts">
            {holdingsCount} / {shortsCount}
          </Fact>
          <Fact label="Check-ins">{int(u.totalCheckins)}</Fact>
          <Fact label="Streak (best)">
            {u.checkinStreak || 0} ({u.maxCheckinStreak || 0})
          </Fact>
          <Fact label="Achievements">{(u.achievements || []).length}</Fact>
          <Fact label="Prediction wins">{int(u.predictionWins)}</Fact>
          <Fact label="Margin">{u.marginEnabled ? 'on' : 'off'}</Fact>
          <Fact label="Ladder balance">{money(ladderBalance)}</Fact>
        </Panel>

        <Panel title="Status and style">
          <Fact label="Season tier">{u.seasonTier?.tier || '-'}</Fact>
          <Fact label="Title">{u.activeTitle || '-'}</Fact>
          <Fact label="Titles owned">{(u.ownedTitles || []).length}</Fact>
          <Fact label="Cosmetics owned">{(u.ownedCosmetics || []).length}</Fact>
          <Fact label="Shop pins owned">{(u.ownedShopPins || []).length}</Fact>
          <Fact label="Streak saver">
            {u.streakSaverPermanent
              ? 'permanent'
              : u.streakSaverUntil && u.streakSaverUntil > Date.now()
                ? `until ${utcDate(u.streakSaverUntil)}`
                : 'no'}
          </Fact>
          <Fact label="Bot commands used">
            {da ? `${int(da.total)} (last ${ago(da.lastAt)} ago)` : 'none recorded'}
          </Fact>
          <Fact label="Crew lockouts">{Object.keys(u.crewLockouts || {}).length || '-'}</Fact>
        </Panel>
      </div>
    </div>
  );
};

export default PlayerOverview;
