# Stockism

A social stock market simulation game where you trade characters from Lookism. All players share the same live market — your trades move real prices for everyone.

**Live at:** https://stockism.app

---

## How It Works

Players start with **$1,000** in cash and compete to build the highest portfolio value. The market is live and shared — buying a stock raises the price for everyone; selling lowers it. There are no resets.

---

## Features

### Trading
- **Buy & Sell** — Standard long positions with per-share cost basis tracking
- **Short Selling** — Borrow and sell shares to profit from price drops. Requires 50% margin. 0.1% daily interest. Auto-closes if equity drops below 25%.
- **Limit Orders** — Set a target price; the order executes automatically when hit. 30-day expiry.
- **Margin Trading** — Borrow against your portfolio to buy more. Unlocked at $2,000 cash. Borrow limit scales with your peak portfolio value (25%–75%). 0.5% daily interest. Auto-liquidation at 25% equity.
- **Price Impact** — Every trade moves the price using a square root impact model. Max 5% change per trade. ETFs have a tighter spread (0.1%) than individual stocks (0.2%).
- **Anti-Manipulation** — New accounts have reduced price impact for their first 3 days. Max 10 trades per ticker per 24h. Max 10% cumulative price impact per user per ticker per day.

### Crews
- **Join a Crew** — Align with one of 9 crews. Switching costs 15% of your portfolio value.
- **Daily Missions** — 3 missions per day tied to your crew. Rewards range from $75–$200.
- **Weekly Missions** — 2 harder missions per week. Rewards range from $400–$1,000. Can be rerolled once per week before claiming any reward.
- **Crew Dividends** — Earn 1% daily on the value of holdings in your crew's member stocks.

### Dividends
Stocks are tiered. If you hold a stock for 10+ days, you receive weekly payouts every Thursday at 12:55 UTC (just before the halt), calculated against the pre-halt price snapshot:
- **Blue-chip**: 1.0% per week
- **Dividend**: 0.5% per week
- **ETF**: 0.7% per week
- **Growth**: no dividend

### IPOs
New characters enter the market in three stages:
1. **Hype Phase** (24h) — announced, not yet tradeable
2. **IPO Phase** (24h) — limited buying at a fixed price, max 10 shares per user, 150 shares total
3. **Launch** — IPO closes, price jumps 15%, open market trading begins

### Predictions Market
- Bet on admin-created outcome events
- Pool betting: winners split the total pot proportionally to their wager
- Admin resolves outcomes manually

### Ladder Game
A separate side game accessible via the Ladder tab. Players compete on a ranked ladder with its own progression system.

### Social
- **Leaderboard** — Global ranking by portfolio value, with a crew leaderboard tab
- **Public Profiles** — Stats, sparkline, top holdings, achievement showcase
- **Activity Feed** — Personal trading history and achievements
- **Achievements** — 20+ unlockable achievements
- **Pin Shop** — Collectible display pins purchasable with in-game cash
- **Cosmetics** — Profile customization items
- **Daily Check-in** — $300 bonus for logging in each day

### Market Halt
The market halts every **Thursday 13:00–21:00 UTC** for chapter review. No trades execute during the halt. Dividends and pre-halt price snapshots are taken at 12:55 UTC just before the halt opens.

---

## Economy at a Glance

| Parameter | Value |
|---|---|
| Starting cash | $1,000 |
| Daily check-in | $300 |
| Price impact model | `BASE_IMPACT × √shares / √liquidity` |
| Max price change per trade | 5% |
| Bid/ask spread (stocks) | 0.2% |
| Bid/ask spread (ETFs) | 0.1% |
| Short margin requirement | 50% |
| Short daily interest | 0.1% |
| Short margin call threshold | 25% equity |
| Margin daily interest | 0.5% |
| Margin liquidation threshold | 25% equity |
| Crew switch penalty | 15% of portfolio |
| IPO shares available | 150 total, 10 per user |
| IPO price jump on launch | 15% |
| Dividend hold requirement | 10 days |
| Weekly halt | Thursday 13:00–21:00 UTC |

---

## Tech Stack

- **Frontend**: React + Vite + Tailwind CSS, hosted on Vercel
- **Backend**: Firebase Cloud Functions (Node.js)
- **Database**: Firestore
- **Auth**: Firebase Auth — Google & Twitter sign-in
- **Discord**: Bot integration for OAuth linking and update announcements

---

## Project Structure

```
src/
├── App.jsx                  # Router, subscriptions, modal rendering
├── characters.js            # All character/ETF data (source of truth)
├── crews.js                 # Crew definitions, missions, shop pins
├── firebase.js              # Firebase config + callable function wrappers
├── context/
│   └── AppContext.jsx       # Global state (prices, user, holdings, etc.)
├── hooks/                   # useAuth, useMarket, useModalManager, useNotifications
├── utils/                   # calculations, formatters, theme, marketHours
├── constants/               # economy.js, achievements.js, cosmetics.js
└── components/
    ├── layout/              # Header, Footer, MobileBottomNav
    ├── modals/              # All modal components
    ├── admin/               # Admin panel sub-components
    └── common/              # Shared UI (ErrorBoundary, etc.)

functions/
├── index.js                 # Re-exporter only (~25 lines)
├── constants.js             # All backend economy constants
├── helpers.js               # Shared utilities
├── characters.js            # Generated — never edit directly
├── botTrader.js             # Automated bot trading scheduler
└── services/
    ├── trading.js           # executeTrade, validateTrade
    ├── users.js             # Account management, check-in
    ├── market.js            # Price updates, summaries, halt management
    ├── leaderboard.js       # Rankings
    ├── dividends.js         # Weekly dividend payouts
    ├── margin.js            # Margin lending, short margin calls
    ├── limitOrders.js       # Limit order processing
    ├── missions.js          # Daily/weekly missions
    ├── predictions.js       # Prediction markets, IPO price jumps
    ├── ladderGame.js        # Ladder game
    ├── crew.js              # Crew switching
    ├── alerts.js            # Price alerts
    ├── discord.js           # Discord OAuth and linking
    ├── admin.js             # User management tools
    ├── adminOps.js          # Repair and recovery tools
    ├── watchlist.js         # IP fraud detection
    └── archiving.js         # Data cleanup
```

---

## Development

```bash
npm install       # Install dependencies
npm run dev       # Start dev server (http://localhost:5173)
npm run build     # Production build
npm test          # Run unit tests
```

Dev runs against the **production** Firebase backend. Any trades or writes hit live data.

**Deploying:**
```bash
# Frontend — automatic via Vercel on push to main
git push

# Backend — manual step required
npm run sync:chars   # if characters.js changed
firebase deploy --only functions
```

Never run `firebase deploy` without `--only functions` — Vercel owns hosting.

---

## Admin Features

Accessible to admin accounts only via the ⚙️ button in the header:
- Manually adjust character prices
- Halt / resume the market with a custom reason
- Create and resolve predictions
- Manage IPO lifecycle (announce → open → close)
- View and search all user portfolios
- Ban / reinstate users, adjust cash balances
- Execute price rollbacks and spike repairs
- Run dividend payouts manually
- Assign badges and achievements
- IP watchlist and fraud detection tools

---

## Legal Disclaimer

This is an unofficial, fan-made project created for entertainment purposes. It is not affiliated with, endorsed by, or sponsored by the original creators or publishers of Lookism.

**Lookism** is created by **Taejun Park (PTJ)** and published by **Naver Corporation** through **Naver Webtoon**. All character names, likenesses, and intellectual property related to Lookism belong to their respective copyright holders.

No copyright infringement is intended. This is a non-commercial project created by fans, for fans of the Lookism series.

For copyright concerns: **support@stockism.app**
