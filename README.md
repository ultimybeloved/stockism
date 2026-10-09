# Stockism

A stock market game built on Lookism characters. Every player trades in the same live market, so your buys and sells move the price for everyone else.

**Live at:** https://stockism.app

---

## The Basics

You sign up with $1,000. Linking a Discord account is a one-time verification step that raises your starting cash to $3,000 and unlocks trading. Buying pushes a price up, selling pushes it down, and the market never resets. There are 158 characters and 11 ETFs to trade, most of them crew index funds.

The goal is the highest portfolio value: cash plus holdings, minus anything you borrowed.

---

## How Prices Move

Prices are driven by six things:

1. **Player trades.** Every trade moves the price using a square root impact model, so a big order costs more per share than a small one. A single trade can move a price at most 5%.
2. **ETF trailing.** The 11 ETFs track their member characters. Trading a member nudges its ETFs, and trading an ETF nudges its members.
3. **Bots.** Automated traders run every 30 minutes. Each has a personality (market follower, momentum, contrarian, hodler, day trader, panic seller, and a few others) so quiet hours still have movement.
4. **Market maker.** Runs hourly. If a price has drifted more than 12% from its 7-day average, it nudges it back with a 6-share trade using the same impact math as a real trade.
5. **Admin adjustments.** Manual price corrections after chapter events. Once an admin sets a price, bots and the market maker leave that ticker alone for 7 days so they cannot claw the change back.
6. **Neglect decay.** A stock no player has traded for 14 days drifts down 1% a day until it reaches a hidden floor. Open short interest pauses the decay, so a short seller cannot farm a guaranteed decline.

Stocks can also be **split** (for example 3-for-1): the price divides, every holder's shares multiply, and nobody's money changes.

---

## Features

### Trading

- **Buy and sell** with per-share cost basis tracking and per-lot purchase ages.
- **Short selling.** Fully collateralized: you post the position value dollar for dollar. Shorts on any one ticker are capped at 50% of your portfolio equity, and your total short value cannot exceed your net worth. Positions are force-covered when equity falls under 25%.
- **Margin.** Unlocks after 10 daily check-ins, 35 trades, a $7,500 peak portfolio, and $2,000 in cash. Your borrow limit is a share of your collateral, scaled by your peak portfolio value (25% under $7,500, up to 75% over $30,000). Holdings count as collateral at the lower of cost basis or market price, so pumping a stock you own does not raise your limit. Interest is 0.5% per day. A margin call fires at 30% equity and forced liquidation at 25%, selling 5% below market.
- **Exit loyalty.** Holding a lot longer makes it cheaper to sell. Sell-side price impact is discounted 10% at 10 days, 25% at 4 weeks, and 40% at 8 weeks. The market still takes the full impact, only your cost is reduced.

### Order Types

- **Market orders** execute instantly at the bid or ask.
- **Limit orders** (buy or sell) sit on the book and fill when the price hits your target. Swept every 15 minutes, 90-day expiry, optional partial fills.
- **Stop-loss orders** sell automatically if a price drops to your trigger.
- **Pre-market orders** queue during the Thursday halt and fill in the reopening auction.

### Crews

There are 10 crews: Allied, Big Deal, Fist Gang, God Dog, Secret Friends, Hostel, White Tiger Job Center, Workers, Kitae Kim Union, and Yamazaki Syndicate.

- Joining is free. Switching costs 5% of your portfolio and locks you out of the crew you left for 30 days.
- **Underdog bonus.** Crews with fewer active players earn a reward multiplier of up to 2x on all mission payouts, recalculated every Monday from last week's activity.
- **Crew head.** Every Monday the biggest portfolio among a crew's active members is crowned. Four straight weeks earns a dynasty, and taking the crown off a long-reigning head is tracked separately. The crown is cosmetic and pays nothing.
- **Crew missions.** Collective goals (buy, sell, and volume targets on the crew's own stocks) that scale with roster size. You need a minimum personal contribution to claim the payout, so one share does not earn you a share of the reward.

### Missions

- **Daily:** 3 missions per crew per day, $75 to $150 each.
- **Weekly:** 2 missions per week, $400 to $1,000 each. Rerollable once per week before you claim anything.

Every mission rewards an action you take or a portfolio balance you actively maintain. Missions that paid out for simply owning something were removed, because they were free income for no effort.

### Dividends

Every stock pays a weekly dividend on Thursday at 12:58 UTC, calculated against the frozen pre-halt price snapshot so payout prices cannot be gamed.

The base rate is the stock's rarity tier, which is ranked by live price and updates itself as the market moves:

| Tier | Weekly yield |
|---|---|
| Legendary | 1.00% |
| Epic | 0.80% |
| Rare | 0.60% |
| Uncommon | 0.45% |
| Common | 0.30% |
| ETF | 0.70% (flat) |

On top of that, each purchase lot climbs a loyalty ladder: nothing under 10 days, 1x at 10 days, 1.25x at 4 weeks, 1.5x at 8 weeks. Maximum possible yield stays well under margin interest, so borrowing to farm dividends always loses money.

### IPOs

New characters arrive in three stages:

1. **Hype** (24h): announced, not tradeable.
2. **IPO window** (24h): fixed price, 150 shares total, 10 per player.
3. **Launch**: the price jumps 15% and open trading begins.

IPO shares are locked from selling for 24 hours after the window closes, so the guaranteed launch pop cannot be flipped risk-free.

### Prediction Markets

Two formats run side by side:

- **Weekly bets.** Cash pool betting on chapter outcomes. Winners split the pot in proportion to their stake.
- **Event markets.** Long-term markets where each outcome is a share that pays $1 if it happens and $0 if it does not. Prices come from a house-run LMSR market maker, so you can buy or sell at any time instead of waiting for resolution. Admin sets the opening odds. The house takes the other side and can lose.

### Ladder Game

A double-or-nothing side game. You pick a side and a bet, a random ladder resolves, and you either double your stake or lose it. Deposits from your main account are capped, and withdrawals are taxed: 5% on returning principal, a lifetime-progressive 15/30/45% on profit, plus 15% extra if you withdraw within 12 hours of depositing. A required tutorial spells out that the outcome is random and there is no strategy.

### Seasons

A season runs alongside a story arc and scores how much each player grows their account from the day it starts. Scoring uses live net worth at frozen prices, with free stock, bonuses, and other granted money taken out. A weekly checkpoint runs every Thursday during the halt.

Tiers are a ladder, and each one needs the one before it:

| Tier | How to earn it |
|---|---|
| Bronze | Be active in 2 weeks of the season |
| Silver | Bronze, and finish the season up |
| Gold | Silver, and finish ahead of the market index |
| Platinum | Gold, and finish in the top 15% of your size division against the market |
| Diamond | The best Platinum finishers, up to the top 5% of your division, who beat the market in 75% of weeks and never had more than 60% of their invested money in one character |

Platinum and Diamond are ranked within four size divisions (Rookie under $10k, Trader $10k to $50k, Whale $50k to $200k, Titan $200k and up), so small accounts that can swing further do not crowd out big ones. Gold, Platinum, and Diamond earn a title. A season can only be ended, and a checkpoint only run by hand, while the market is halted.

### Discord

- **Daily drop.** A claim button posts to Discord every day at 14:00 UTC and stays claimable for 72 hours. Each claim rolls three tables: a guaranteed core pull, a guaranteed bonus of cheap shares, and a 10% shot at one legendary share. 3% of claims are jackpots.
- **Slash commands.** A public bot installable in any server: `/leaderboard`, `/profile`, `/price`, `/portfolio`, `/missions`, and `/buy` (deep-links to the site).
- **Alerts.** Market open and close, chapter recaps, whale trades, crew milestones, IPO announcements, weekly summaries.
- **Crew head roles.** Optional Discord roles that color the weekly crew head's name. Dormant until the role IDs are filled in.

### Progression and Social

- **Leaderboards** by total portfolio value, by weekly percentage gain (with a minimum baseline so a $50 account doubling up cannot top it), by crew, and the season board.
- **Public profiles** at `/u/username` with stats, portfolio sparkline, top holdings, and pinned achievements.
- **49 achievements** with pinnable badges. Extra pin slots are purchasable.
- **43 cosmetics**: name colors, row glows, backdrops, and animated frames, $5,000 to $120,000.
- **Daily check-in** with a streak: $300 on day one, rising to $500 by day seven.
- **Price alerts** you set per ticker, checked every 30 minutes.
- **Bankruptcy and bailout.** If your portfolio falls to $100 or below you are marked bankrupt and can take a $1,500 bailout once per 24 hours. The bailout wipes every position you hold, turns off margin, and removes you from your crew, so it is a last resort. Bankruptcy clears itself once you are back above $500.
- **Guest mode** lets people browse the market without an account.
- Dark mode, color-blind mode, mobile layout, and installable as a PWA.

---

## The Weekly Halt

The market halts every **Thursday 13:00 to 21:00 UTC** for chapter review, so nobody who reads the new chapter early can trade on it first. Trading, weekly bets, event shares, and IPO buys are all frozen.

The Thursday timeline:

| Time (UTC) | What happens |
|---|---|
| 12:55 | Pre-halt prices frozen and saved |
| 12:58 | Dividends paid on the frozen snapshot |
| 13:00 | Market halts |
| 20:30 | Pre-market order window opens, chapter recap posts |
| 20:55 | Order book locks, no new orders or cancellations |
| 20:56 | Opening auction runs, IPO price jumps apply, stop-losses sweep |
| 21:00 | Market reopens |

Admins can also halt the market manually at any time with a custom reason.

---

## Economy Reference

| Parameter | Value |
|---|---|
| Starting cash (unverified) | $1,000 |
| Starting cash (Discord linked) | $3,000 |
| Daily check-in | $300 to $500 by streak |
| Bailout | $1,500 |
| Name change | $10,000 |
| Base price impact | 1.2% per sqrt share, liquidity base 100 |
| Max price change per trade | 5% |
| Bid/ask spread | 0.2% stocks, 0.1% ETFs |
| Short collateral | 100% of position value |
| Short force-cover | below 25% equity |
| Short concentration cap | 50% of portfolio equity per ticker |
| Total short exposure cap | 100% of net worth |
| Margin unlock | 10 check-ins, 35 trades, $7,500 peak, $2,000 cash |
| Margin borrow limit | 25% to 75% of collateral by peak portfolio |
| Margin interest | 0.5% per day |
| Margin call / liquidation | 30% / 25% equity |
| Margin-bought share lockup | 36 hours |
| Crew switch penalty | 5% of portfolio |
| Crew rejoin lockout | 30 days |
| Crew underdog bonus | up to 2x |
| Daily missions | 3 per day, $75 to $150 |
| Weekly missions | 2 per week, $400 to $1,000 |
| Dividend hold requirement | 10 days |
| Dividend loyalty ladder | 1x / 1.25x at 4 weeks / 1.5x at 8 weeks |
| Exit impact discount | 10% / 25% / 40% on the same ladder |
| IPO supply | 150 shares, 10 per player |
| IPO launch jump | 15% |
| IPO share lockup | 24 hours after the window closes |
| Limit order expiry | 90 days |
| Wash rule | 4% down-impact in 24h blocks buying back for 48h |
| Circuit breaker | 10% move in 5 min pauses the stock 3 min, max 2 a day |
| Neglect decay | 1% a day after 14 days untraded, to a hidden floor |
| Event market liquidity (b) | 5,000 |
| Ladder starting balance | $500 |
| Weekly halt | Thursday 13:00 to 21:00 UTC |

---

## Anti-Abuse

The economy is fake money, but the leaderboard is not, so a fair amount of the backend exists to stop manipulation and alt farming.

**Price manipulation**
- Max 5% price move per trade, and max 10% cumulative move per player per ticker per day in each direction (down and up are counted separately).
- New accounts have their price impact scaled down for their first 3 days, ramping from 10% to full.
- 3 second cooldown between trades, 45 second minimum hold before a position can be closed.
- Per ticker: 10 trades per rolling 24 hours, 15 per hour, 3 per 5-minute burst, and a 10 second gap between buys or shorts.
- After 3 shorts on one ticker, further shorts wait for the oldest to age out of an 8-hour window.
- Forced short covers are capped at 3 per ticker per scan so a crowded short cannot cascade into a squeeze.
- Margin-bought shares lock for 36 hours, so borrowed money cannot spike a stock and bail.
- **Wash rule.** Pushing a stock down 4% or more in 24 hours with sells or shorts blocks buying it back for 48 hours. A heavy sell also blocks shorting that stock for 48 hours. Exits are never blocked.
- **Circuit breaker.** A stock that moves 10% in 5 minutes pauses for 3 minutes, at most twice a day. This binds bots and the market maker too, and catches groups that each stay inside their own limits.
- **Coordination scan.** An hourly scan flags groups trading one stock together. Tight downward clusters get the 48-hour buy-back and short block. Admins can review what a flagged push made each player, remove it, and keep repeat offenders out of Platinum and Diamond for the season.

**Alt accounts**
- Hard cap of 2 accounts per IP, enforced at signup and at trade time inside the same transaction.
- A deleted account holds its IP slot for 30 days, which kills the pump, delete, remake loop.
- One Discord account maps to one Stockism account permanently. Relinking is admin-only, and a Discord ID tied to a deleted account is blocked for 30 days.
- Three layers of disposable-email blocking at signup: a hand list, an npm package, and a live daily list, all fail-soft.
- Suspected alts can be walled behind Discord verification, which gates every order path including limit and pre-market orders.
- IP watchlist and signup reporting tools in the admin panel.

**Cost and blast radius**
- Every Cloud Function is capped at 10 concurrent instances.
- A billing killswitch function can disable the project if spend spikes.
- App Check is enforced on every callable, so only the real app can call the backend.

---

## Scheduled Jobs

| Job | Schedule (UTC) |
|---|---|
| Bot trading | every 30 min |
| Market maker | hourly |
| Limit order sweep | every 15 min |
| Short margin calls | every 30 min |
| Margin lending scan | every 30 min |
| Price alerts | every 30 min |
| Event market settlement | every 30 min |
| IPO price jumps | every 30 min |
| Daily drop post | 14:00 daily |
| All-time high/low sweep | hourly at :20 |
| Coordination scan | hourly at :35 |
| Alt account scan | 04:00 daily |
| Neglect decay | 21:40 daily |
| Daily market summary | 21:00 daily |
| Market backup | every 24h |
| Archiving and portfolio sync | every 24h |
| Dividends | Thursday 12:58 |
| Pre-halt price save | Thursday 12:55 |
| Chapter recap | Thursday 20:30 |
| Opening auction | Thursday 20:56 |
| Season checkpoint | Thursday 14:00 |
| Weekly market summary | Monday 00:00 |
| Weekly leaderboard | Monday 01:00 |
| Weekly crew rankings | Monday 01:30 |
| Monthly permanent backup | 1st of month 00:00 |

---

## Tech Stack

- **Frontend:** React 18, Vite 5, Tailwind 3, React Router 7. Hosted on Vercel.
- **Backend:** Firebase Cloud Functions (1st gen, Node 22), 153 functions across 50 service files.
- **Database:** Firestore, with an allowlist-based security rule on user documents.
- **Auth:** Firebase Auth. Google, Twitter, email/password with verification, and Discord via custom token.
- **Monitoring:** Sentry on both frontend and backend, loaded lazily on the backend so it costs nothing on a cold start.
- **Discord:** Two apps, one bot for messages and slash commands and one for OAuth login.

---

## Project Structure

```
src/
├── App.tsx                    Router, subscriptions, state and handler assembly
├── AdminPanel.tsx             Admin orchestrator (state lives in hooks/admin/)
├── characters.ts              Source of truth: characters, ETFs, rarity, dividends
├── crews.ts                   Source of truth: crews, missions, pins, penalties
├── firebase.ts                Firebase config and callable wrappers
├── context/AppContext.tsx     Global state: prices, user, holdings, market data
├── pages/                     Home, Leaderboard, Achievements, Ladder, Predictions,
│                              Profile, PublicProfile, Stock
├── hooks/                     One concern per hook (trade, margin, crew, missions,
│   ├── admin/                 IPO, predictions, pin shop, daily ops, market data)
│   └── ladder/
├── components/
│   ├── layout/                Header, Footer, MobileBottomNav, Layout
│   ├── modals/                Every modal
│   ├── home/                  Market grid, controls, dashboard rail
│   ├── portfolio/             Holdings, shorts, pending orders, charts
│   ├── trading/               Trade inputs, limit order controls, margin preview
│   ├── ladder/                Ladder board, side panel, ladder modals
│   ├── admin/                 Admin tabs
│   └── charts/, profile/, leaderboard/, missions/, notifications/, common/
├── utils/                     calculations, theme, formatters, rarity, marketHours,
│                              ladderTax, cosmetics, username, profanity
└── constants/                 economy.js, achievements.js, cosmetics.js

functions/src/
├── index.js                   Entry point, 7 lines
├── servicePaths.js            Joins every domain's services.js into one list
├── serviceLoader.js           Loads only the service owning the invoked function
├── shared/                    constants, helpers, fnConfig (instance cap, App Check),
│                              sentry, characters.js + crews.js (generated, never edit)
├── trading/                   executeTrade and its trade* internals
├── orders/                    Limit orders, pre-market queue, opening auction
├── margin/                    Margin actions and liquidation scanners
├── market/                    Prices, halts, weekly summary, dividends, alerts,
│                              market maker, bots, rename and split engines
├── season/                    Seasons, tiers, standings
├── users/                     Accounts, profiles, portfolio, leaderboard, signup checks
├── crews/                     Crew switching and crew missions
├── missions/                  Daily and weekly missions
├── predictions/               Weekly bets, event shares
├── ladder/                    Ladder game
├── discord/                   Login, slash commands, roles, daily drop
├── moderation/                Watchlist, alt detection, coordination scan and review
└── admin/                     Backups, ops, repair, migrations, health, billing

Each domain folder's services.js lists the files there that declare Cloud
Functions; the rest are internal modules.
```

### Architecture Rules

Hard limits that exist because this codebase was untangled from a set of god files:

| Location | Limit |
|---|---|
| Components (`src/features/*/components/`, `src/shared/components/`, `src/app/`) | 400 lines |
| Pages (`src/features/*/pages/`) | 300 lines |
| Hooks (`src/features/*/hooks/`, `src/shared/hooks/`) | 200 lines |
| `src/App.tsx` | 500 lines |
| `functions/src/<domain>/` | 600 lines |
| `functions/src/index.js` | 15 lines, entry point only |

Shared values live in exactly one place: price and portfolio math in `src/utils/calculations.ts`, theme strings in `src/utils/theme.ts`, backend economy numbers in `functions/src/shared/constants/`, character and crew data in `src/characters.ts` and `src/crews.ts`. See `CLAUDE.md` for the full rules.

---

## Development

```bash
npm install
npm run dev          # http://localhost:5173
npm run build
npm run lint
```

`npm run dev` runs against the **production** Firebase backend. Any trade or write hits live data.

### Sandbox

For anything risky, use the local emulator sandbox. Requires Java 21 or newer.

```bash
npm run emulators       # auth, firestore, functions + UI on :4000
npm run seed:emulator   # seed a starting market doc
npm run dev:emulator    # run the app against the emulators
```

The sandbox is a clean database and nothing in it can touch live players. Restarting the emulators wipes it.

### Tests

```bash
npm test               # vitest unit and component tests
npm run test:trading   # 155-check executeTrade + margin scanner suite (emulator)
npm run test:limitorders
npm run test:rules     # Firestore security rules
npm run test:ipcap     # per-IP account cap
npm run test:loyalty
npm run test:crewroles
npm run test:discord
npm run test:season    # season checkpoints, tiers, end of season
npm run test:coord     # coordination scan
npm run test:rename    # ticker rename, end to end
npm run test:split     # stock split, end to end
```

`npm run test:trading` is the characterization suite for the most critical path in the codebase. Run it before and after any change to `trading.js` or the margin scanners.

---

## Deploying

**Frontend** deploys automatically via Vercel on push to `main`.

**Backend** is a manual step:

```bash
npm run sync:chars        # if characters.js or crews.js changed
npm run check:functions   # verifies export purity + constants imports
firebase deploy --only functions:executeTrade,functions:payDividends
```

Deploy only the functions you changed, by name. A full redeploy of all 153 functions hits rate limits and costs build minutes. `npm run deploy:functions` batches a full deploy when one is genuinely needed.

Never run `firebase deploy` without `--only functions`. Vercel owns hosting.

---

## Admin Tools

Admin accounts get a panel in the header with tabs for:

- Market: manual price adjustments, halts, base price repair, backups and restores, starting and ending seasons
- Users: search, ban and reinstate, cash adjustments, cosmetic grants, account deletion
- Holders: who owns what, per-ticker
- Trades: recent trade log and backfill tools
- IPO: announce, open, and close IPO windows
- Predictions: create, extend, resolve, and cancel both bet formats
- Badges: grant and revoke achievements
- Dividends: run payouts manually, override tiers
- Bots: create and manage bot traders
- Watchlist: IP tracking, signup reports, alt linking
- Recovery: spike repair, portfolio history reconstruction, ticker rollback, rename ticker, split stock
- Diagnostics: scheduled job status, orphan cleanup, health checks

---

## Legal

Unofficial fan project, made for entertainment, not affiliated with or endorsed by the creators of Lookism.

**Lookism** is created by **Taejun Park (PTJ)** and published by **Naver Corporation** through **Naver Webtoon**. All character names, likenesses, and related intellectual property belong to their respective copyright holders.

No copyright infringement intended. Non-commercial, made by fans for fans.

Copyright concerns: **support@stockism.app**
