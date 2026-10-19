# Game rules

How Stockism plays, for players and for anyone changing the economy. The
numbers here describe the live game; the code is the authority if they ever
disagree (`src/rules/`, `src/constants/economy.ts`,
`functions/src/shared/constants/`). Update this file in the same commit as any
rule change.

## The Basics

You sign up with $1,000. Linking a Discord account is a one-time verification step that raises your starting cash to $3,000 and unlocks trading. Buying pushes a price up, selling pushes it down, and the market never resets. There are 158 characters and 11 ETFs to trade, most of them crew index funds.

The goal is the highest portfolio value: cash plus holdings, minus anything you borrowed.

---

## How Prices Move

Prices are driven by seven things:

1. **Player trades.** Every trade moves the price using a square root impact model, so a big order costs more per share than a small one. A single trade can move a price at most 5%.
2. **ETF trailing.** The 11 ETFs track their member characters. Trading a member nudges its ETFs, and trading an ETF nudges its members.
3. **Bots.** Every 15 minutes the bot engine moves a handful of stocks a little (at most 2.5% a move, 8 moves a stock a day), more when players are trading and right after the Thursday reopen. Since 2026-10-15 each stock follows a hidden storyline: calm stretches, slow climbs, slow slides, choppy patches and the odd bigger day, each lasting days to weeks. Climbs and slides lean against whatever the bots have already done to that stock and are capped at 35% either way, so over time bots add shape to the charts but never a trend. The storylines are server-only, and bot moves never count as trades.
ETFs follow every automated move on the stocks they hold (bots and the stabilizer), the same way they follow player trades. Linked characters do not: an automated move never drags its linked stocks.

4. **Market maker (the stabilizer).** Runs hourly. If a price has drifted more than 12% from its 7-day average, it nudges it back with a 6-share trade using the same impact math as a real trade. It will not lift a stock that confirmed manipulators bought the bottom of, or push down one they shorted the top of.
5. **Admin adjustments.** Manual price corrections after chapter events. Once an admin sets a price, the market maker and neglect leave that ticker alone for 7 days so they cannot claw the change back. Bots keep it busy with up to 3 small wiggles a day, but their combined effect always stays within 1.5% of the admin's price.
6. **Neglect.** A stock no player has traded for 14 days slides toward a hidden floor through the bot storylines: slides of about 1 to 1.5% a day, flat patches and small bounces, about 0.8% a day on average. Open short interest (25+ shares) freezes the slide, so a short seller cannot farm a guaranteed decline. Before 2026-10-15 this was a flat 1% every day.
7. **The market guard.** Players the admin has confirmed as manipulators are watched by the bot. When their trades move a stock 3% or more within 3 hours, the bot pushes it back toward where they started (at most 3% a run), but only when that costs them: a pump they still hold, or a dump they are short on. If other players opened positions that would profit from the reversal, it stands aside.

Stocks can also be **split** (for example 3-for-1): the price divides, every holder's shares multiply, and nobody's money changes.

---

## Features

### Trading

- **Buy and sell** with per-share cost basis tracking and per-lot purchase ages.
- **Short selling.** Fully collateralized: you post the position value dollar for dollar. Shorts on any one ticker are capped at 50% of your portfolio equity, and your total short value cannot exceed your net worth. Both caps use net worth, so margin debt is subtracted first. Positions are force-covered when equity falls under 25%.
- **Margin.** Unlocks after 10 daily check-ins, 35 trades, a $7,500 peak portfolio, and $2,000 in cash. Your borrow limit is a share of your collateral, scaled by your peak portfolio value (25% under $7,500, up to 75% over $30,000). Peak value is net of margin debt, so borrowing never raises it. Holdings count as collateral at the lower of cost basis or market price, so pumping a stock you own does not raise your limit. Interest is 0.5% per day. A margin call fires at 30% equity and forced liquidation at 25%, selling 5% below market.
- **Exit loyalty.** Holding a lot longer makes it cheaper to sell. Sell-side price impact is discounted 10% at 10 days, 25% at 4 weeks, and 40% at 8 weeks. The market still takes the full impact, only your cost is reduced.

### Order Types

- **Market orders** execute instantly at the bid or ask.
- **Limit orders** (buy or sell) sit on the book and fill when the price hits your target. Swept every 15 minutes, 90-day expiry, optional partial fills. A partial-fill buy short on cash fills as many shares as the cash covers at the ask. Pending and partly filled orders can be cancelled.
- **Stop-loss orders** sell automatically if a price drops to your trigger. One that triggers at the Thursday open is priced like every other sale (own impact, exit-loyalty discount).
- **Pre-market orders** queue during the Thursday halt and fill in the reopening auction.
  Queued orders are private. Other players only see each stock's total queued buys and sells (the indicative opening price), never who queued them.

### Crews

There are 10 crews: Allied, Big Deal, Fist Gang, God Dog, Secret Friends, Hostel, White Tiger Job Center, Workers, Kitae Kim Union, and Yamazaki Syndicate.

- Joining is free. Switching costs 5% of your portfolio and locks you out of the crew you left for 30 days.
- **Underdog bonus.** Crews with fewer active players earn a reward multiplier of up to 2x on all mission and rivalry payouts, recalculated every Thursday reopen from last week's activity.
- **Crew head.** Every Thursday reopen (Monday until 2026-10-22) the biggest net worth (portfolio minus margin debt, since 2026-10-14) among a crew's active members is crowned. Crew totals and weekly gains in the weekly report are net of margin debt too. Four straight weeks earns a dynasty, and taking the crown off a long-reigning head is tracked separately. The crown is cosmetic and pays nothing.
- **Crew Rivalries** (replaced crew missions 2026-10-22). Every Thursday reopen crews are paired 1 vs 1 by last week's active players (a 3-way when the count is odd), never the same opponent two weeks running. A crew's score is the share of its members who finished at least one mission in the crew that week and went on to finish 5. A member who only checked in does not count against the crew. At the next reopen, members who finished 5 get $1,500 if their crew won and $500 if it lost, times the underdog bonus. A tie is a win for both; a 0% crew never wins. The winners' crest glows gold everywhere for the following week. Players without a crew are not in Rivalries.

### Missions

Missions 2.0 since 2026-10-22. Missions are a way to start earning money to invest, and every one needs a real trade or a portfolio balance you keep:

- **Real trades only.** A trade counts if it is worth at least 1% of your net worth, never less than $50 and never more than $500. A buy counts only while you still hold those shares when you claim. A sell counts only on shares held a day or more (shares leave oldest first).
- **The week** runs from the Thursday reopen (21:00 UTC) to the next one. The halt hours belong to the week that is ending. Daily missions still reset at 00:00 UTC. The first week is 2026-10-22: between the deploy and that reopen no weekly mission can be claimed or rerolled (`FIRST_MISSION_WEEK_ID`), since that week's claims were recorded on the old Monday week.
- **Daily:** 3 a day, picked by date and crew, $75 to $125 each: Crew Support, Rival Trader, Underdog Investor (under $20), Bargain Hunter (down 5%+ from the week-open price), Spread Out (3 different stocks), Profit Taker, Cut Your Losses (sold below cost), Order Filled (a limit order), Crew Majority (50%+ of stock value in your crew).
- **Weekly:** your Call plus one of Trading Streak (real trades on 5 days, $600), Daily Grinder (7 check-ins, $500), Buy and Hold (bought Thursday to Saturday, still held Wednesday, $500; daily drop shares don't count), Diversified (5+ stocks worth 1% of net worth each, none over 40% of stock value, $500), Crew Maximalist (80%+ in your crew, $600), Portfolio Builder (15%+ growth, $750).
- **Your Call.** From the Thursday reopen to the end of Saturday, pick one stock and up or down (changeable until picks close, free). It is scored on the next chapter halt: the price when the halt began (13:00 UTC) against the price at the 20:55 lock, before the opening auction, so no player trade can move it. A 1%+ move your way pays $500, a 10%+ move pays $1,000, under 1% either way is a push. If no stock moves 1% during the halt (a chapter break), every Call gets $250 instead. Paid automatically and counted as a mission. Admin accounts sit Calls out. Every player keeps a lifetime Call record (right, wrong, pushes, best streak; `src/rules/callRecord.ts`) shown on their profile, and the leaderboard's Calls tab ranks the top 50 by right Calls, then accuracy (pushes and chapter breaks count neither way), rebuilt each time Calls are scored.
- **Crew missions** (Crew Support, Rival Trader, Crew Majority, Crew Maximalist) are only offered to players in a crew. Everyone else gets missions from the rest.
- Rerollable once per week for $50 (today's dailies and the week's second mission) before you claim anything. A reroll always gives a different weekly mission and a different set of dailies. The underdog bonus applies to every payout.

Growth missions measure net worth: free money received that week and margin debt are both taken out. The week's starting point is recorded at the nightly sync (01:20 UTC), or at your first visit that week if that comes sooner. Crew Majority and Crew Maximalist count your stock by value, not by number of shares.

### Dividends

Every stock pays a weekly dividend on Thursday at 12:58 UTC, calculated against the frozen pre-halt price snapshot so payout prices cannot be gamed. Each player is paid at most once per week (a re-run skips anyone already paid). Bots and banned accounts are not paid.

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

- **Weekly bets.** Cash pool betting on chapter outcomes. Winners split the pot in proportion to their stake. One bet per question, unless the admin reopens it for top-ups.
- **Event markets.** Long-term markets where each outcome is a share that pays $1 if it happens and $0 if it does not. Prices come from a house-run LMSR market maker, so you can buy or sell at any time instead of waiting for resolution. Admin sets the opening odds. The house takes the other side and can lose. The card shows what you put in, what your shares are worth now, and what they pay if the outcome wins. Open positions count toward your net worth (leaderboard, profile, crew head) at what selling them back would pay right now (since 2026-10-14), but stay out of percent-gain boards and season scoring, so a lucky long-shot can't win a season.

**One shared limit** (src/rules/equity.ts `sideGameRoom`, since 2026-10-11): open weekly bets, long-term market positions (at what you paid) and your own money in the ladder (not the free check-in chips) together can't exceed what you've invested in stocks. Before, each game had its own limit, so the same stock let you put the full amount into all three.

### Ladder Game

A double-or-nothing side game. You pick a side and a bet, a random ladder resolves, and you either double your stake or lose it. Deposits from your main account are capped, and withdrawals are taxed: 5% on returning principal, a lifetime-progressive 15/30/45% on profit, plus 15% extra if you withdraw within 12 hours of depositing. A required tutorial spells out that the outcome is random and there is no strategy.

It can also be played in the Stockism Discord with `/ladder bet:<dollars>` (official server only, posted in the channel for everyone to see). It is the same game: same odds, the same ladder balance, cooldown and records. The player needs a linked Discord account, and only they can press their game's buttons. The board is drawn in emojis and the path lights up step by step; blue lands on ODD, red on EVEN.

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

Platinum and Diamond are ranked within four size divisions (Rookie under $10k, Trader $10k to $50k, Whale $50k to $200k, Titan $200k and up), so small accounts that can swing further do not crowd out big ones. Platinum and Diamond earn a title (Gold did until 2026-10-11). Every tier also earns the season's reward cosmetic, plus those of the tiers below it (`SEASON_REWARDS` in src/rules/seasons.ts); the kind of reward rotates by season. Preseason 1 pays five row frames: Bronze, Silver, Gold (Laurel Band), Platinum (Holographic Foil) and Diamond (Brilliant Cut, with an engraved PRESEASON banner). They are booked in the ledger as `season_reward` and each winner gets a bell notification and a Discord DM (if linked) naming their frames and title. A season can only be ended, and a checkpoint only run by hand, while the market is halted.

### Discord

- **Daily drop.** A claim button posts to Discord every day at 14:00 UTC and stays claimable for 72 hours. Each claim rolls three tables: a guaranteed core pull, a guaranteed bonus of cheap shares, and a 10% shot at one legendary share. 3% of claims are jackpots.
- **Slash commands.** A public bot installable in any server: `/leaderboard`, `/profile`, `/price`, `/portfolio`, `/missions`, `/buy` (deep-links to the site), and `/welcome`.
- **Welcome week** (`/welcome`, src/rules/welcome.ts). Run once a day in the official server for 7 days: $1,000, $700, $800, $900, $1,000, $1,100, $1,500 ($7,000 total). With the $3,000 Discord-linked start that makes $10,000. A missed day pauses the week, never resets it. Needs a linked account and a Discord account at least 30 days old; once per Discord account and once per Stockism account, ever. Booked as free money (ledger `welcome_streak`, grantedValue). Finishing posts a shout-out in the channel.
- **Alerts.** Market open and close, chapter recaps, whale trades, crew milestones, IPO announcements, weekly summaries.
- **Crew head roles.** Optional Discord roles that color the weekly crew head's name. Dormant until the role IDs are filled in.

### Progression and Social

- **Leaderboards** by net worth (portfolio value minus margin debt plus long-term market positions at sell-back value, since 2026-10-14, so borrowing never lifts your rank), by weekly gain in dollars or percent (also net of margin debt at both ends; the percent board has a minimum baseline so a $50 account doubling up cannot top it), by crew, and the season board. Banned players are left off.
- **Public profiles** at `/u/username` with stats, portfolio sparkline, top holdings, and pinned achievements. Value, sparkline and rank are net worth, matching the leaderboard. Banned players' profiles are hidden.
- **49 achievements** with pinnable badges. Extra pin slots are purchasable.
- **88 shop cosmetics**: names, effects (row glows), backdrops and frames, $5,000 to $250,000, plus 5 season reward frames that are earned only (never sold, gifted, bundled or featured). The shop shows one category at a time on three shelves: Showcase ($100k and up), Premium ($30k to $99k) and Classics (under $30k), with a search box that lists everything most expensive first. Since 2026-10-16: the plain glows are $5,000 (pulsing $10,000), the plain color backdrops $5,000 (each comes with both a Fade and a Solid look), Steel, Jade and Ruby $5,000, Bull / Bear $50,000, Shimmer $100,000 and Rainbow $75,000. The 2026-10 drop added 13 animated names (Cash and Split Flap $100k, Chrome $85k, Holographic, Galaxy, Neon Sign and Glitch (was Corrupted) $75k, Wildfire, Glacier, Toxic, Sunset, Ocean and Sakura $50k), 12 effects (Overcome Mastery $250k; Make It Rain and Gold Rush $150k; Strength, Speed, Endurance and Technique Mastery $100k; Path to Mastery and Spotlight $50k; Paparazzi, Premiere and Static Shock $35k) and 12 animated backdrops (Vault and Banknote $100k, Terminal $85k, Night Skyline $75k, Trading Floor $50k, Thunderstorm, Neon Alley, Chalkboard, Graffiti Wall, Shooting Stars, Rooftop Sunset and Fight Night $30k). Three items come with a style the owner picks anytime (`cosmeticStyle`, src/rules/cosmetics.ts): Split Flap (Random, Scramble or Arrivals), Bull / Bear (Daily, or Split to always show both halves) and the color backdrops (Fade or Solid). Frame animations are offset per player so identical frames never move in step; the Ticker Tape, Terminal and Banknote serial are unique per player. Cosmetics given out without payment (admin grants) are booked in the ledger at their shop price. Players who paid more than the new price for a cheaper item got the difference back (scripts/refund-price-drops.cjs, ledger type `shop_price_refund`).
- **Shop pins** (src/crews.ts, original pixel art): Black Card $100k, Ultra-Instinct $75k, Gold Mongkol and Gapryong's Cap $50k, Polycoria $35k, Shiba $10k, Red Mongkol $5k.
- **Shop deals** (src/rules/shop.ts): 10 bundles (name colour + glow + backdrop + frame) at 20% off the pieces you don't own yet; one featured item each week at 25% off, rotating at the Thursday reopen (Monday 00:00 UTC until 2026-10-22) through every item worth $25,000+, announced in the weekly Discord report. Gilded Frame and Comet are never discounted.
- **Gifting** (functions/src/users/cosmeticGifts.ts): buy any shop cosmetic or bundle for another player by name, at the price you would pay yourself (a gifted bundle always costs the whole set at the bundle discount; the recipient gets the pieces they don't own). No message box (harassment channel); the recipient gets a bell notification and a Discord DM naming the sender. Max 10 gifts a day; no gifts to yourself, bots, banned players or someone who already owns the item. Both sides are booked in the ledger, and every gift goes in the admin-only giftLog with the giver's connection; Admin, Watchlist, Gift Log flags pairs that look like one person (shared connection, alt-scan pair, watchlist link, receiver under a week old).
- **Your week.** At each Thursday reopen, everyone who did anything that week gets a bell notification summing it up: net worth, split into what trading made and what came in as rewards, the biggest mover they hold, their Call, missions finished and their crew's rivalry result (`functions/src/market/weeklyRecap.ts`).
- **Daily check-in** with a streak: $300 on day one, rising to $500 by day seven.
- **Streak saver** (shop perk, src/rules/economy.ts): while active, every check-in pays $500 even after missed days. $10,000 for 30 days (buying again adds 30 more) or $100,000 permanent. Buying needs a live 7-day check-in streak, unless a saver is already running. The streak number itself still resets on a missed day, so streak achievements and the margin unlock still need real check-ins.
- **Price alerts** you set per ticker (up to 10), checked every 5 minutes against every price since the last check, so a quick spike that comes back down still fires. You get a bell notification, and a Discord DM if your Discord is linked.
- **Dust cleanup.** Positions worth under $5 can be cleared in one click from the portfolio: tiny longs are sold at the bid, tiny shorts are bought back at the ask with their collateral returned. No price impact, and it does not count as a trade.
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

Every stock chart flags each chapter review with a marker (since 2026-10-22, with past reviews filled in from price history). Hovering or tapping it shows that stock's move from the halt to the 20:55 lock and the admin's chapter name and note (Admin, Weekly). Recorded at 20:55 by `market/chapterMarkers`, shape in `src/rules/chapterMarkers.ts`.

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
| Daily missions | 3 per day, $75 to $125 |
| Weekly missions | your Call ($500 / $1,000) + 1 more, $500 to $750 |
| Crew rivalry | $1,500 win / $500 loss, for finishing 5 missions |
| Dividend hold requirement | 10 days |
| Dividend loyalty ladder | 1x / 1.25x at 4 weeks / 1.5x at 8 weeks |
| Exit impact discount | 10% / 25% / 40% on the same ladder |
| IPO supply | 150 shares, 10 per player |
| IPO launch jump | 15% |
| IPO share lockup | 24 hours after the window closes |
| Limit order expiry | 90 days |
| Wash rule | 4% down-impact in 24h blocks buying back for 48h |
| Circuit breaker | 10% move in 5 min pauses the stock 3 min, max 2 a day |
| Neglect | about 0.8% a day on average after 14 days untraded, to a hidden floor |
| Bot moves | at most 2.5% each, 8 a stock a day (3 on an admin-set price), 6% total a stock a day |
| Event market liquidity (b) | 20,000 default for new markets (admin can set per market; existing markets keep theirs) |
| Ladder starting balance | $500 |
| Weekly halt | Thursday 13:00 to 21:00 UTC |

---

## Anti-Abuse

The economy is fake money, but the leaderboard is not, so a fair amount of the backend exists to stop manipulation and alt farming.

**Price manipulation**
- Max 5% price move per trade, and max 10% cumulative move per player per ticker per day in each direction (down and up are counted separately).
- New accounts have their price impact scaled down for their first 3 days, ramping from 10% to full.
- Players the admin confirms as manipulators move the market a random 50% to 75% of what their order would (picked fresh for each order), but still pay the full-impact price and use up their daily impact allowance in full. So pushing a stock costs them the same and gets them half to three quarters of the move. Applies to market, limit and stop-loss orders, not the pooled opening auction. Takes effect within 5 minutes of confirming. Nothing tells the player.
- 3 second cooldown between trades, 45 second minimum hold before a position can be closed.
- Per ticker: 10 trades per rolling 24 hours, 15 per hour, 3 per 5-minute burst, and a 10 second gap between buys or shorts.
- After 3 shorts on one ticker, further shorts wait for the oldest to age out of an 8-hour window.
- Forced short covers are capped at 3 per ticker per scan so a crowded short cannot cascade into a squeeze.
- Margin-bought shares lock for 36 hours, so borrowed money cannot spike a stock and bail.
- **Wash rule.** Pushing a stock down 4% or more in 24 hours with sells or shorts blocks buying it back for 48 hours. A heavy sell also blocks shorting that stock for 48 hours. Sells through limit orders and stop losses count too. Exits are never blocked.
- **Circuit breaker.** A stock that moves 10% in 5 minutes pauses for 3 minutes, at most twice a day. This binds bots and the market maker too, and catches groups that each stay inside their own limits.
- **Coordination scan.** An hourly scan flags groups trading one stock together. Tight downward clusters get the 48-hour buy-back and short block. Admins can review what a flagged push made each player, remove it, and keep repeat offenders out of Platinum and Diamond for the season.

**Alt accounts**
- Hard cap of 2 accounts per IP, enforced at signup and at trade time inside the same transaction. An IPv6 connection counts as one (its /64 network), since each device on it gets its own changing address. Since 2026-10-13.
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
| Bot engine (storylines, neglect, market guard) | every 15 min |
| Market maker | hourly |
| Limit order sweep | every 15 min |
| Short margin calls | every 30 min |
| Margin lending scan | every 30 min |
| Price alerts | every 5 min |
| Event market settlement | every 30 min |
| IPO price jumps | every 30 min |
| Daily drop post | 14:00 daily |
| All-time high/low sweep | hourly at :20 |
| Coordination scan | hourly at :35 |
| Alt account scan | 04:00 daily |
| Daily market summary | 21:00 daily |
| Market backup | every 24h |
| Archiving and portfolio sync | every 24h |
| Dividends | Thursday 12:58 |
| Pre-halt price save | Thursday 12:55 |
| Chapter recap | Thursday 20:30 |
| Opening auction | Thursday 20:56 |
| Season checkpoint | Thursday 14:00 |
| Call price lock | Thursday 13:00 |
| Calls scored and paid | Thursday 20:55 |
| Weekly crew rankings, rivalries, week-open prices | Thursday 21:05 |
| Weekly market summary | Thursday 21:10 |
| Weekly leaderboard | Thursday 21:15 |
| Monthly permanent backup | 1st of month 00:00 |

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
- Watchlist: IP tracking, signup reports, alt linking
- Market guard: confirm or remove manipulators, see what the guard did, and the accounts flagged most for teaming up
- Recovery: spike repair, portfolio history reconstruction, ticker rollback, rename ticker, split stock
- Diagnostics: scheduled job status, orphan cleanup, health checks
