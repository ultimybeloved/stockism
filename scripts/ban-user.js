// Quick script to ban a user
// Usage: node scripts/ban-user.js <userId>

const admin = require('firebase-admin');
const serviceAccount = require('../service-account-key.json'); // You'll need your service account key

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

async function banUser(userId) {
  try {
    console.log(`Banning user: ${userId}`);

    const userRef = db.collection('users').doc(userId);
    const userDoc = await userRef.get();

    if (!userDoc.exists) {
      console.error('User not found!');
      return;
    }

    // Reset user to starting state and mark as banned
    await userRef.update({
      cash: 1000,
      holdings: {},
      shorts: {},
      portfolioValue: 1000,
      portfolioHistory: [{ timestamp: Date.now(), value: 1000 }],
      isBanned: true,
      bannedAt: admin.firestore.FieldValue.serverTimestamp(),
      banReason: 'Check-in fraud, timestamp manipulation, bailout abuse'
    });

    // Disable authentication (prevents sign-in)
    await admin.auth().updateUser(userId, {
      disabled: true
    });

    console.log('✅ User banned successfully');
    console.log('- Account disabled (cannot sign in)');
    console.log('- Cash/portfolio reset to $1000');
    console.log('- Marked as banned in database');

  } catch (error) {
    console.error('Error banning user:', error);
  }

  process.exit(0);
}

const userId = process.argv[2];
if (!userId) {
  console.error('Usage: node scripts/ban-user.js <userId>');
  process.exit(1);
}

banUser(userId);
