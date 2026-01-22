# Stockism

A social stock market simulation game where you trade characters from Lookism. Real-time shared prices, crew competition, predictions, short selling, and more.

**Live at:** https://stockism-abb28.web.app

## Core Features

### Trading
- **Real-time Global Prices** - All users trade on the same market with live price updates
- **Price Impact Model** - Trades affect prices using a square root impact model with bid/ask spread
- **Buy & Sell** - Standard long positions with cost basis tracking
- **Short Selling** - Borrow shares to profit from price drops (50% margin requirement, 0.1% daily interest)
- **Margin Trading** - Leverage your positions with automatic liquidation protection

### Crews System
- **Join a Crew** - Align with your favorite characters
- **Daily Missions** - 3 crew-specific missions each day (rewards $75-$200)
- **Weekly Missions** - 2 harder missions per week (rewards $400-$1000)
- **Crew Dividends** - Earn passive income from crew member holdings

### Predictions Market
- **Bet on Outcomes** - Wager on community predictions
- **Pool Betting** - Winners split the total pot proportionally
- **Admin-Created Events** - New predictions added regularly

### IPO System
- **Hype Phase** - New characters announced before trading opens
- **IPO Phase** - Limited buying window at fixed price
- **Price Jump** - Market price established after IPO closes

### Social Features
- **Leaderboard** - Compete for top portfolio value
- **Activity Feed** - See your trading history and achievements
- **Achievements** - 20+ achievements to unlock
- **Profile Customization** - Custom usernames and collectible pins

## Sorting & Search

Sort stocks by:
- Price (High/Low)
- **Top Gainers** - Highest 24h % increase
- **Top Losers** - Lowest 24h % change
- Most Active (trade volume)
- Ticker A-Z
- Newest/Oldest added

## Economy

- **Price Impact**: `impact = price × 0.003 × sqrt(shares / liquidity)`
- **Max Change**: 2% per trade
- **Bid/Ask Spread**: 0.2%
- **Short Margin**: 50% of position value
- **Daily Interest**: 0.1% on short positions
- **Daily Check-in Bonus**: $25

## Tech Stack

- **Frontend**: React + Vite + Tailwind CSS
- **Backend**: Firebase (Auth, Firestore)
- **Hosting**: Firebase Hosting
- **Auth**: Google & Twitter sign-in

## Project Structure

```
src/
├── constants/        # Economy settings, achievements
├── utils/            # Formatters, calculations, dates
├── hooks/            # useAuth, useMarket, useNotifications
├── context/          # Auth, Market, Theme providers
├── services/         # Firebase operations
├── components/
│   ├── common/       # Modal, Button, Card, Loading
│   └── charts/       # Price charts
├── App.jsx           # Main application
├── AdminPanel.jsx    # Admin tools
├── characters.js     # Character data
├── crews.js          # Crews, missions
└── firebase.js       # Firebase config
```

## Development

```bash
npm install          # Install dependencies
npm run dev          # Start dev server
npm run build        # Production build
firebase deploy      # Deploy to Firebase
```

## Admin Features

Admins can:
- Adjust character prices manually
- Create/resolve predictions
- View all user portfolios
- Execute market rollbacks
- Manage IPOs

## Credits

Built for the Lookism community. Character data from the webtoon series.
