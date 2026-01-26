// Ticker Migration Script
// Usage: node scripts/migrate-ticker.js <oldTicker> <newTicker>
// Example: node scripts/migrate-ticker.js DOTS CROW

const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');

// Load service account key
const serviceAccount = require('../service-account-key.json');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

async function migrateTicker(oldTicker, newTicker) {
  console.log('🚀 Starting ticker migration...');
  console.log(`   Old: ${oldTicker}`);
  console.log(`   New: ${newTicker}\n`);

  try {
    // Step 1: Check current state
    console.log('🔍 Checking current state...');
    const marketRef = db.collection('market').doc('current');
    const marketSnap = await marketRef.get();

    if (!marketSnap.exists) {
      console.error('❌ Market document not found!');
      return;
    }

    const marketData = marketSnap.data();
    const oldPrice = marketData.prices?.[oldTicker];
    const oldHistory = marketData.priceHistory?.[oldTicker] || [];
    const oldVolume = marketData.volume?.[oldTicker] || 0;

    if (!oldPrice) {
      console.error(`❌ Old ticker ${oldTicker} not found in market!`);
      return;
    }

    console.log(`   ✓ Found ${oldTicker} price: $${oldPrice}`);
    console.log(`   ✓ Found ${oldHistory.length} price history entries`);

    // Count users with holdings
    const usersWithHoldings = await db.collection('users')
      .where(`holdings.${oldTicker}`, '>', 0)
      .get();

    const usersWithShorts = await db.collection('users')
      .where(`shorts.${oldTicker}.shares`, '>', 0)
      .get();

    console.log(`   ✓ Found ${usersWithHoldings.size} users with ${oldTicker} holdings`);
    console.log(`   ✓ Found ${usersWithShorts.size} users with ${oldTicker} shorts\n`);

    // Step 2: Create backup
    console.log('📦 Creating backup...');
    const backupData = {
      timestamp: Date.now(),
      oldTicker,
      newTicker,
      marketData: {
        price: oldPrice,
        history: oldHistory,
        volume: oldVolume
      },
      users: []
    };

    // Backup user data
    const allAffectedUsers = new Map();
    usersWithHoldings.forEach(doc => allAffectedUsers.set(doc.id, doc.data()));
    usersWithShorts.forEach(doc => {
      if (!allAffectedUsers.has(doc.id)) {
        allAffectedUsers.set(doc.id, doc.data());
      }
    });

    allAffectedUsers.forEach((userData, userId) => {
      backupData.users.push({ userId, data: userData });
    });

    const backupDir = path.join(__dirname, '..', 'backups');
    if (!fs.existsSync(backupDir)) {
      fs.mkdirSync(backupDir, { recursive: true });
    }

    const backupPath = path.join(backupDir, `migration_${oldTicker}_${newTicker}_${Date.now()}.json`);
    fs.writeFileSync(backupPath, JSON.stringify(backupData, null, 2));
    console.log(`   ✓ Backup saved to ${path.basename(backupPath)}\n`);

    // Step 3: Migrate market data
    console.log('🔄 Migrating market data...');
    const marketUpdates = {
      [`prices.${newTicker}`]: oldPrice,
      [`priceHistory.${newTicker}`]: oldHistory,
      [`volume.${newTicker}`]: oldVolume
    };

    await marketRef.update(marketUpdates);
    console.log(`   ✓ Copied prices.${oldTicker} → prices.${newTicker}`);
    console.log(`   ✓ Copied priceHistory.${oldTicker} → priceHistory.${newTicker} (${oldHistory.length} entries)`);
    console.log(`   ✓ Copied volume.${oldTicker} → volume.${newTicker}\n`);

    // Step 4: Archive old history to subcollection
    console.log('📚 Archiving price history...');
    const archiveRef = marketRef.collection('price_history').doc(newTicker);
    await archiveRef.set({
      history: oldHistory,
      migratedFrom: oldTicker,
      migratedAt: admin.firestore.FieldValue.serverTimestamp()
    });
    console.log(`   ✓ Archived to market/price_history/${newTicker}\n`);

    // Step 5: Migrate user holdings
    console.log(`👥 Migrating user holdings (${allAffectedUsers.size} users)...`);
    let migratedCount = 0;
    let errorCount = 0;

    for (const [userId, userData] of allAffectedUsers) {
      try {
        const userRef = db.collection('users').doc(userId);
        const updates = {};

        // Migrate holdings
        if (userData.holdings?.[oldTicker]) {
          updates[`holdings.${newTicker}`] = userData.holdings[oldTicker];
          updates[`holdings.${oldTicker}`] = admin.firestore.FieldValue.delete();
          console.log(`   ✓ User ${userId.substring(0, 8)}: ${userData.holdings[oldTicker]} ${oldTicker} → ${newTicker}`);
        }

        // Migrate cost basis
        if (userData.costBasis?.[oldTicker]) {
          updates[`costBasis.${newTicker}`] = userData.costBasis[oldTicker];
          updates[`costBasis.${oldTicker}`] = admin.firestore.FieldValue.delete();
        }

        // Migrate lowestWhileHolding
        if (userData.lowestWhileHolding?.[oldTicker]) {
          updates[`lowestWhileHolding.${newTicker}`] = userData.lowestWhileHolding[oldTicker];
          updates[`lowestWhileHolding.${oldTicker}`] = admin.firestore.FieldValue.delete();
        }

        // Migrate lastBuyTime
        if (userData.lastBuyTime?.[oldTicker]) {
          updates[`lastBuyTime.${newTicker}`] = userData.lastBuyTime[oldTicker];
          updates[`lastBuyTime.${oldTicker}`] = admin.firestore.FieldValue.delete();
        }

        // Migrate lastTickerTradeTime
        if (userData.lastTickerTradeTime?.[oldTicker]) {
          updates[`lastTickerTradeTime.${newTicker}`] = userData.lastTickerTradeTime[oldTicker];
          updates[`lastTickerTradeTime.${oldTicker}`] = admin.firestore.FieldValue.delete();
        }

        // Migrate shorts
        if (userData.shorts?.[oldTicker]) {
          updates[`shorts.${newTicker}`] = userData.shorts[oldTicker];
          updates[`shorts.${oldTicker}`] = admin.firestore.FieldValue.delete();
          console.log(`   ✓ User ${userId.substring(0, 8)}: Migrated short position`);
        }

        if (Object.keys(updates).length > 0) {
          await userRef.update(updates);
          migratedCount++;
        }

      } catch (error) {
        console.error(`   ❌ Error migrating user ${userId}: ${error.message}`);
        errorCount++;
      }
    }

    console.log(`   ✓ Migrated ${migratedCount} users successfully`);
    if (errorCount > 0) {
      console.log(`   ⚠️  ${errorCount} errors occurred\n`);
    } else {
      console.log('');
    }

    // Step 6: Clean up old ticker data
    console.log('🧹 Cleaning up old ticker data...');
    await marketRef.update({
      [`prices.${oldTicker}`]: admin.firestore.FieldValue.delete(),
      [`priceHistory.${oldTicker}`]: admin.firestore.FieldValue.delete(),
      [`volume.${oldTicker}`]: admin.firestore.FieldValue.delete()
    });
    console.log(`   ✓ Removed prices.${oldTicker}`);
    console.log(`   ✓ Removed priceHistory.${oldTicker}`);
    console.log(`   ✓ Removed volume.${oldTicker}\n`);

    // Step 7: Summary
    console.log('✅ Migration complete!');
    console.log(`   - Market data migrated from ${oldTicker} to ${newTicker}`);
    console.log(`   - ${migratedCount} users updated`);
    console.log(`   - ${errorCount} errors`);
    console.log(`   - Backup saved: ${path.basename(backupPath)}`);
    console.log('\n⚠️  IMPORTANT: Update characters.js manually:');
    console.log(`   - Change ticker: "${oldTicker}" → "${newTicker}"`);
    console.log(`   - Update any trailingFactors that reference "${oldTicker}"`);
    console.log(`   - Update crews.js if needed\n`);

  } catch (error) {
    console.error('\n❌ Migration failed:', error);
    console.error('   Check backup file for recovery');
  }

  process.exit(0);
}

// Parse arguments
const oldTicker = process.argv[2];
const newTicker = process.argv[3];

if (!oldTicker || !newTicker) {
  console.error('Usage: node scripts/migrate-ticker.js <oldTicker> <newTicker>');
  console.error('Example: node scripts/migrate-ticker.js DOTS CROW');
  process.exit(1);
}

migrateTicker(oldTicker.toUpperCase(), newTicker.toUpperCase());
