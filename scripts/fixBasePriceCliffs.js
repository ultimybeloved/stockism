// Script to remove base price points that create artificial cliffs in charts
// Removes first data point if jump to second point is >2%
// Calls the Cloud Function (admin-only)

import { initializeApp } from 'firebase/app';
import { getAuth, signInWithEmailAndPassword } from 'firebase/auth';
import { getFunctions, httpsCallable } from 'firebase/functions';
import * as readline from 'readline';

const firebaseConfig = {
  apiKey: "AIzaSyA7h7BCmgIUkJHLENTRjCj6i43BV6ly5DA",
  authDomain: "stockism-abb28.firebaseapp.com",
  projectId: "stockism-abb28",
  storageBucket: "stockism-abb28.firebasestorage.app",
  messagingSenderId: "765989843498",
  appId: "1:765989843498:web:332d3470293741bb9fc953"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const functions = getFunctions(app);

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function question(query) {
  return new Promise(resolve => rl.question(query, resolve));
}

async function fixBasePriceCliffs() {
  console.log('Base Price Cliff Fix Tool\n');
  console.log('This script will remove the first data point for any ticker');
  console.log('where there is a >2% jump to the second data point.\n');

  // Admin authentication
  console.log('Admin authentication required.\n');
  const email = await question('Email: ');
  const password = await question('Password: ');

  try {
    console.log('\nAuthenticating...');
    await signInWithEmailAndPassword(auth, email, password);
    console.log('✓ Authenticated successfully\n');

    console.log('Calling Cloud Function to fix price cliffs...\n');
    const fixBasePriceCliffsFunction = httpsCallable(functions, 'fixBasePriceCliffs');
    const result = await fixBasePriceCliffsFunction();

    console.log('Result:', result.data);

    if (result.data.fixed && result.data.fixed.length > 0) {
      console.log('\nFixed tickers:');
      result.data.fixed.forEach(fix => {
        console.log(`  ${fix.ticker}:`);
        console.log(`    First: $${fix.firstPrice.toFixed(2)} (${fix.firstTimestamp})`);
        console.log(`    Second: $${fix.secondPrice.toFixed(2)}`);
        console.log(`    Jump: ${fix.percentChange}%`);
      });
    }

    console.log(`\n✓ Complete! Fixed ${result.data.tickersFixed} tickers.`);
  } catch (error) {
    console.error('\nError:', error.message);
    if (error.code === 'permission-denied') {
      console.error('You must be logged in as admin to run this script.');
    }
  } finally {
    rl.close();
    process.exit(0);
  }
}

fixBasePriceCliffs();
