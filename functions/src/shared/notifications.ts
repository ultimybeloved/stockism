// Player notifications.

import * as admin from 'firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import * as logger from 'firebase-functions/logger';
const db = admin.firestore();

// ============================================
// NOTIFICATION HELPER
// ============================================
// Writes a notification doc to users/{uid}/notifications subcollection
// Fire-and-forget — errors are logged but don't block the caller
export const writeNotification = async (
  uid: string,
  { type, title, message, data = {} }: { type: string; title: string; message: string; data?: Record<string, unknown> },
) => {
  try {
    await db.collection('users').doc(uid).collection('notifications').add({
      type, // 'trade', 'alert', 'achievement', 'margin', 'system'
      title,
      message,
      read: false,
      createdAt: FieldValue.serverTimestamp(),
      data, // { ticker?, price?, orderId?, achievementId? }
    });
  } catch (err) {
    logger.error(`Failed to write notification for ${uid}:`, (err as Error).message);
  }
};
