# Stockism

A social stock market simulation game where you trade characters from Lookism. Real-time shared prices, crew competition, predictions, short selling, and more.

**Live at:** https://stockism.app

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
- **Daily Check-in Bonus**: $300

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

## Credits & Legal Disclaimer

This is an unofficial, fan-made project created for entertainment purposes and is not affiliated with, endorsed by, or sponsored by the original creators or publishers of Lookism.

**Lookism** is created by **Taejun Park (PTJ)** and published by **Naver Corporation** through **Naver Webtoon**. All character names, likenesses, and intellectual property related to Lookism belong to their respective copyright holders, including but not limited to:
- **Taejun Park (PTJ)** - Original creator and author
- **Naver Corporation** - Publisher
- **PTJ Comics** - Production company

All rights to the Lookism intellectual property remain with the original copyright holders. This project uses character names and references solely for the purpose of creating a fan-made stock market simulation game. **No copyright infringement is intended.** This is a non-commercial project created by fans, for fans of the Lookism series.

If you have any concerns regarding copyright or intellectual property, please contact us at **support@stockism.app** and we will address them promptly.

Built with appreciation for the Lookism community.
