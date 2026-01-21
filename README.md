# Stockism v2 - Community Edition

Trade Lookism characters with shared global prices, leaderboards, and Google Sign-In!

## New Features in v2

- **Shared Global Prices** - Everyone sees the same prices
- **Shared Price History** - Charts show real community trading data
- **Google Sign-In** - One-click login
- **Leaderboard** - See top traders globally
- **Portfolio Viewer** - View all your holdings in detail
- **Balanced Economy** - Prevents pump-and-dump manipulation

## Setup Instructions

### Step 1: Enable Google Sign-In in Firebase

1. Go to [Firebase Console](https://console.firebase.google.com)
2. Select your `stockism` project
3. Go to **Authentication** → **Sign-in method**
4. Click **Google**
5. Toggle **Enable**
6. Set a **Project support email** (your email)
7. Click **Save**

### Step 2: Update Firestore Security Rules

1. In Firebase Console, go to **Firestore Database** → **Rules**
2. Replace the rules with:

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    // Users can read/write their own data
    match /users/{userId} {
      allow read: if true;
      allow write: if request.auth != null && request.auth.uid == userId;
    }
    
    // Anyone can read market data, authenticated users can update prices
    match /market/{document} {
      allow read: if true;
      allow write: if request.auth != null;
    }
  }
}
```

3. Click **Publish**

### Step 3: Set Up Price Updates (Important!)

The market needs periodic price updates with gravity (pulling prices back to base). You have two options:

#### Option A: Simple (Client-Side Updates)
The current code updates prices when trades happen. This works but prices only move when people trade.

#### Option B: Cloud Functions (Recommended for Production)
For automatic price updates even when no one is trading:

1. Install Firebase CLI: `npm install -g firebase-tools`
2. Run `firebase login`
3. Run `firebase init functions` in your project folder
4. Replace `functions/index.js` with:

```javascript
const functions = require('firebase-functions');
const admin = require('firebase-admin');
admin.initializeApp();

const CHARACTERS = [
  { ticker: "DG", basePrice: 85, volatility: 0.03 },
  { ticker: "GUN", basePrice: 82, volatility: 0.035 },
  // ... add all characters
];

// Run every minute
exports.updatePrices = functions.pubsub.schedule('every 1 minutes').onRun(async (context) => {
  const db = admin.firestore();
  const marketRef = db.collection('market').doc('current');
  const snap = await marketRef.get();
  
  if (!snap.exists) return null;
  
  const data = snap.data();
  const prices = data.prices || {};
  const priceHistory = data.priceHistory || {};
  
  const newPrices = {};
  const GRAVITY = 0.002;
  
  CHARACTERS.forEach(char => {
    const current = prices[char.ticker] || char.basePrice;
    const gravityPull = (char.basePrice - current) * GRAVITY;
    const noise = (Math.random() - 0.5) * char.volatility * char.basePrice;
    const newPrice = Math.max(char.basePrice * 0.5, Math.min(char.basePrice * 1.5, current + gravityPull + noise));
    newPrices[char.ticker] = Math.round(newPrice * 100) / 100;
    
    // Add to history
    if (!priceHistory[char.ticker]) priceHistory[char.ticker] = [];
    priceHistory[char.ticker].push({ timestamp: Date.now(), price: newPrices[char.ticker] });
    
    // Keep last 10000 points
    if (priceHistory[char.ticker].length > 10000) {
      priceHistory[char.ticker] = priceHistory[char.ticker].slice(-10000);
    }
  });
  
  await marketRef.update({
    prices: newPrices,
    priceHistory: priceHistory,
    lastUpdate: admin.firestore.FieldValue.serverTimestamp()
  });
  
  return null;
});
```

5. Deploy: `firebase deploy --only functions`

### Step 4: Deploy to Vercel

1. Push code to GitHub
2. Go to [vercel.com](https://vercel.com)
3. Import your repository
4. Deploy!

## Economy Balancing

The new economy prevents manipulation through:

- **Lower Trade Impact** - Each trade moves price by only ~2%
- **Diminishing Returns** - Large trades have less impact per share
- **Price Gravity** - Prices slowly drift back toward base value
- **Max Deviation Cap** - Prices can't go more than 50% above/below base

## File Structure

```
stockism-v2/
├── src/
│   ├── App.jsx        # Main app with all components
│   ├── firebase.js    # Firebase configuration
│   ├── characters.js  # Character data
│   ├── main.jsx       # Entry point
│   └── index.css      # Tailwind CSS
├── public/
│   └── favicon.svg
├── index.html
├── package.json
├── vite.config.js
├── tailwind.config.js
└── postcss.config.js
```

## Troubleshooting

**Google Sign-In not working?**
- Make sure Google is enabled in Firebase Auth
- Check that your domain is authorized in Firebase Console → Authentication → Settings → Authorized domains

**Prices not updating?**
- Check Firestore rules are published
- Make sure market document exists (it auto-creates on first load)

**Leaderboard empty?**
- Users need to make at least one trade to appear
- Portfolio value updates after trades

Enjoy trading! 📈
