const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');

// Initialize Firebase Admin
const serviceAccount = require('../service-account.json');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  storageBucket: 'stockism-abb28.firebasestorage.app'
});

const bucket = admin.storage().bucket();

async function downloadBackup() {
  const filePath = 'backups/manual/2026-01-25_07-41-38_manual_market.json';
  const destPath = path.join(__dirname, '..', 'market_backup.json');

  console.log(`Downloading ${filePath}...`);

  try {
    await bucket.file(filePath).download({
      destination: destPath
    });
    console.log(`✅ Downloaded to: ${destPath}`);
  } catch (err) {
    console.error('Error downloading:', err.message);
  }

  process.exit(0);
}

downloadBackup();
