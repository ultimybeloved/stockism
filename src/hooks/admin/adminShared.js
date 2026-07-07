import { doc } from 'firebase/firestore';
import { db } from '../../firebase';

// Chart history lives in its own doc (market/priceHistory), keyed by ticker.
// Shared by the price tools, trade rollback, and maintenance hooks.
export const priceHistoryDocRef = () => doc(db, 'market', 'priceHistory');
