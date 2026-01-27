const admin = require('firebase-admin');

// Initialize Firebase Admin
const serviceAccount = require('../service-account.json');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  storageBucket: 'stockism-abb28.firebasestorage.app',
  databaseURL: 'https://stockism-abb28.firebaseio.com'
});

const db = admin.firestore();
const bucket = admin.storage().bucket();

async function restoreFromLatestBackup() {
  try {
    console.log('🔍 Listing backups...');

    // List all manual backups
    const [files] = await bucket.getFiles({ prefix: 'backups/manual/' });

    if (files.length === 0) {
      console.error('❌ No backups found!');
      process.exit(1);
    }

    // Sort by name (which includes timestamp) to get latest
    files.sort((a, b) => b.name.localeCompare(a.name));

    console.log('\n📦 Available backups:');
    files.forEach((f, i) => console.log(`  ${i + 1}. ${f.name}`));

    const latestBackup = files[0];
    console.log(`\n⬇️  Downloading latest backup: ${latestBackup.name}`);

    // Download backup
    const [content] = await latestBackup.download();
    const backupData = JSON.parse(content.toString());

    console.log(`\n✅ Backup loaded. Contains ${Object.keys(backupData.priceHistory || {}).length} tickers`);

    // Restore only price history (keep current prices)
    const marketRef = db.collection('market').doc('current');

    console.log('\n🔄 Restoring price history to Firestore...');

    await marketRef.update({
      priceHistory: backupData.priceHistory
    });

    console.log('✅ Price history restored successfully!');
    console.log('\n📊 Summary:');
    console.log(`  - Backup file: ${latestBackup.name}`);
    console.log(`  - Tickers restored: ${Object.keys(backupData.priceHistory || {}).length}`);
    console.log(`  - Current prices: KEPT (not changed)`);

    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

restoreFromLatestBackup();
