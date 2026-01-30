/**
 * Content Generation Functions for Social Media
 * Generates videos from market events for YouTube Shorts
 */

const functions = require('firebase-functions');
const admin = require('firebase-admin');
const { createContentVideo } = require('./videoGenerator');
const { Storage } = require('@google-cloud/storage');
const storage = new Storage();
const os = require('os');
const path = require('path');
const fs = require('fs');

const db = admin.firestore();
const ADMIN_UID = process.env.ADMIN_UID || '4usiVxPmHLhmitEKH2HfCpbx4Yi1';

/**
 * Helper to get character name from ticker
 */
function getCharacterName(ticker) {
  // Map of common tickers to names (expand as needed)
  const tickerMap = {
    'DG': 'James Lee',
    'JIN': 'Mujin Jin',
    'SHNG': 'Shingen Yamazaki',
    'GAP': 'Gapryong Kim',
    'GUN': 'Gun Park',
    'GOO': 'Goo Kim',
    'BDNL': 'Daniel Park (Big)',
    'DNL': 'Daniel Park',
    'JAKE': 'Jake Kim',
    'SMUL': 'Samuel Seo'
  };

  return tickerMap[ticker] || ticker;
}

/**
 * Generate content video from event data
 * Stores video in Cloud Storage and metadata in Firestore
 */
async function generateAndStoreVideo(type, data, eventId) {
  try {
    const bucket = storage.bucket();
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stockism-content-'));
    const videoPath = path.join(tempDir, `${eventId}.mp4`);

    console.log(`Generating ${type} video for event ${eventId}`);

    // Generate video
    await createContentVideo(type, data, videoPath);

    // Upload to Cloud Storage
    const destination = `content/${eventId}.mp4`;
    await bucket.upload(videoPath, {
      destination,
      metadata: {
        contentType: 'video/mp4',
        metadata: {
          type,
          eventId,
          generated: new Date().toISOString()
        }
      }
    });

    // Get public URL
    const file = bucket.file(destination);
    const [url] = await file.getSignedUrl({
      action: 'read',
      expires: Date.now() + 1000 * 60 * 60 * 24 * 365 // 1 year
    });

    // Store metadata in Firestore
    await db.collection('contentQueue').doc(eventId).set({
      type,
      data,
      videoUrl: url,
      status: 'pending',
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      eventId
    });

    // Cleanup temp file
    fs.unlinkSync(videoPath);
    fs.rmdirSync(tempDir);

    console.log(`Video generated and stored: ${eventId}`);
    return { success: true, eventId, url };
  } catch (error) {
    console.error('Error generating video:', error);
    throw error;
  }
}

/**
 * Monitor market for content opportunities
 * Runs every 2 hours, generates character spotlight content
 */
exports.generateMarketContent = functions.pubsub
  .schedule('0 */2 * * *')
  .timeZone('UTC')
  .onRun(async (context) => {
    try {
      const marketRef = db.collection('market').doc('current');
      const marketSnap = await marketRef.get();

      if (!marketSnap.exists) {
        console.log('No market data found');
        return null;
      }

      const marketData = marketSnap.data();
      const prices = marketData.prices || {};
      const volumes = marketData.volumes || {};
      const priceHistory = marketData.priceHistory || {};

      // Find characters with interesting activity in last 24 hours
      const candidates = [];

      for (const [ticker, price] of Object.entries(prices)) {
        const history = priceHistory[ticker] || [];
        if (history.length < 2) continue;

        // Get 24h change
        const dayAgo = Date.now() - (24 * 60 * 60 * 1000);
        const dayHistory = history.filter(h => h.timestamp > dayAgo);
        if (dayHistory.length < 2) continue;

        const oldPrice = dayHistory[0].price;
        const newPrice = price;
        const changePercent = ((newPrice - oldPrice) / oldPrice) * 100;

        // Get volume (approximate from recent trades)
        const volume = volumes[ticker] || 0;

        // Score candidates (high volume + price movement)
        const score = Math.abs(changePercent) + (volume / 100);

        if (Math.abs(changePercent) > 15 || volume > 300) {
          candidates.push({
            ticker,
            name: getCharacterName(ticker),
            price,
            changePercent,
            volume,
            score
          });
        }
      }

      if (candidates.length === 0) {
        console.log('No interesting market activity found');
        return null;
      }

      // Pick top candidate
      candidates.sort((a, b) => b.score - a.score);
      const top = candidates[0];

      // Generate character spotlight video
      const eventId = `spotlight_${top.ticker}_${Date.now()}`;
      const videoData = {
        hook: top.changePercent > 0 ? `${top.name} IS TRENDING` : `Everyone's watching ${top.name}`,
        characterName: top.name,
        ticker: top.ticker,
        price: top.price,
        changePercent: top.changePercent,
        volume: top.volume,
        statLabel: 'LAST 24 HOURS',
        timeframe: '24h activity',
        duration: 15
      };

      await generateAndStoreVideo('character-spotlight', videoData, eventId);
      return { success: true, generated: eventId };
    } catch (error) {
      console.error('Error in generateMarketContent:', error);
      return null;
    }
  });

/**
 * Generate drama event video (called from other functions)
 */
exports.generateDramaVideo = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Must be logged in.');
  }

  const { eventType, eventData } = data;

  try {
    const eventId = `drama_${eventType}_${Date.now()}`;
    await generateAndStoreVideo('drama-event', eventData, eventId);
    return { success: true, eventId };
  } catch (error) {
    console.error('Error generating drama video:', error);
    throw new functions.https.HttpsError('internal', 'Failed to generate video: ' + error.message);
  }
});

/**
 * List pending content for admin review
 */
exports.listPendingContent = functions.https.onCall(async (data, context) => {
  if (!context.auth || context.auth.uid !== ADMIN_UID) {
    throw new functions.https.HttpsError('permission-denied', 'Admin only.');
  }

  try {
    const contentSnap = await db.collection('contentQueue')
      .where('status', '==', 'pending')
      .orderBy('createdAt', 'desc')
      .limit(50)
      .get();

    const content = [];
    contentSnap.forEach(doc => {
      content.push({
        id: doc.id,
        ...doc.data()
      });
    });

    return { content };
  } catch (error) {
    console.error('Error listing content:', error);
    throw new functions.https.HttpsError('internal', 'Failed to list content: ' + error.message);
  }
});

/**
 * Approve content for publishing
 */
exports.approveContent = functions.https.onCall(async (data, context) => {
  if (!context.auth || context.auth.uid !== ADMIN_UID) {
    throw new functions.https.HttpsError('permission-denied', 'Admin only.');
  }

  const { contentId } = data;

  try {
    await db.collection('contentQueue').doc(contentId).update({
      status: 'approved',
      approvedAt: admin.firestore.FieldValue.serverTimestamp(),
      approvedBy: context.auth.uid
    });

    return { success: true };
  } catch (error) {
    console.error('Error approving content:', error);
    throw new functions.https.HttpsError('internal', 'Failed to approve content: ' + error.message);
  }
});

/**
 * Reject content
 */
exports.rejectContent = functions.https.onCall(async (data, context) => {
  if (!context.auth || context.auth.uid !== ADMIN_UID) {
    throw new functions.https.HttpsError('permission-denied', 'Admin only.');
  }

  const { contentId } = data;

  try {
    await db.collection('contentQueue').doc(contentId).update({
      status: 'rejected',
      rejectedAt: admin.firestore.FieldValue.serverTimestamp(),
      rejectedBy: context.auth.uid
    });

    return { success: true };
  } catch (error) {
    console.error('Error rejecting content:', error);
    throw new functions.https.HttpsError('internal', 'Failed to reject content: ' + error.message);
  }
});

/**
 * Generate daily market movers video
 */
exports.generateDailyMovers = functions.pubsub
  .schedule('0 21 * * *') // 9 PM UTC (4 PM EST)
  .timeZone('UTC')
  .onRun(async (context) => {
    try {
      const marketRef = db.collection('market').doc('current');
      const marketSnap = await marketRef.get();

      if (!marketSnap.exists) {
        return null;
      }

      const marketData = marketSnap.data();
      const prices = marketData.prices || {};
      const priceHistory = marketData.priceHistory || {};

      // Calculate daily changes
      const changes = [];
      const dayAgo = Date.now() - (24 * 60 * 60 * 1000);

      for (const [ticker, price] of Object.entries(prices)) {
        const history = priceHistory[ticker] || [];
        const dayHistory = history.filter(h => h.timestamp > dayAgo);

        if (dayHistory.length >= 2) {
          const oldPrice = dayHistory[0].price;
          const changePercent = ((price - oldPrice) / oldPrice) * 100;

          changes.push({
            ticker,
            name: getCharacterName(ticker),
            change: changePercent
          });
        }
      }

      // Get top 3 gainers and losers
      changes.sort((a, b) => b.change - a.change);
      const topGainers = changes.slice(0, 3);
      const topLosers = changes.slice(-3).reverse();

      // Generate gainers video
      if (topGainers.length > 0 && topGainers[0].change > 5) {
        const eventId = `gainers_${Date.now()}`;
        await generateAndStoreVideo('market-movers', {
          type: 'gainers',
          timeframe: 'TODAY',
          movers: topGainers,
          duration: 20
        }, eventId);
      }

      // Generate losers video if significant
      if (topLosers.length > 0 && topLosers[0].change < -5) {
        const eventId = `losers_${Date.now()}`;
        await generateAndStoreVideo('market-movers', {
          type: 'losers',
          timeframe: 'TODAY',
          movers: topLosers,
          duration: 20
        }, eventId);
      }

      return { success: true };
    } catch (error) {
      console.error('Error generating daily movers:', error);
      return null;
    }
  });

module.exports = {
  generateMarketContent: exports.generateMarketContent,
  generateDramaVideo: exports.generateDramaVideo,
  listPendingContent: exports.listPendingContent,
  approveContent: exports.approveContent,
  rejectContent: exports.rejectContent,
  generateDailyMovers: exports.generateDailyMovers
};
