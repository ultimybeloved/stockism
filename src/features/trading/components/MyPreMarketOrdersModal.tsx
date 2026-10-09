import { useState, useEffect } from 'react';
import { collection, query, where, onSnapshot, Timestamp } from 'firebase/firestore';
import { db } from '../../../firebase';
import { cancelPreMarketOrderFunction } from '../../../api/callables';
import { getThemeClasses } from '../../../utils/theme';
import { useTheme, useSession } from '../../../context/AppContext';
import { useEscapeKey } from '../../../shared/hooks/useEscapeKey';
import { errorMessage } from '../../../utils/errors';

/** preMarketOrders/{id}: an order queued for the reopening auction. */
interface PreMarketOrder {
  id: string;
  action: 'buy' | 'sell';
  ticker: string;
  shares: number;
  allowPartialFills?: boolean;
}

const MyPreMarketOrdersModal = ({ onClose }: { onClose: () => void }) => {
  useEscapeKey(onClose);
  const { darkMode } = useTheme();
  const { user, showNotification } = useSession();
  const [orders, setOrders] = useState<PreMarketOrder[]>([]);
  const [cancelling, setCancelling] = useState<string | null>(null);
  const { textClass, mutedClass, borderClass, overlayClass, modalShellClass } = getThemeClasses(darkMode);

  useEffect(() => {
    if (!user) return;
    const preMarketStart = new Date();
    preMarketStart.setUTCHours(20, 30, 0, 0);
    const ts = Timestamp.fromDate(preMarketStart);
    let buys: PreMarketOrder[] = [],
      sells: PreMarketOrder[] = [];
    const merge = () => setOrders([...buys, ...sells]);

    const qBuy = query(
      collection(db, 'preMarketOrders'),
      where('userId', '==', user.uid),
      where('action', '==', 'buy'),
      where('status', '==', 'PENDING'),
      where('createdAt', '>=', ts),
    );
    const qSell = query(
      collection(db, 'preMarketOrders'),
      where('userId', '==', user.uid),
      where('action', '==', 'sell'),
      where('status', '==', 'PENDING'),
      where('createdAt', '>=', ts),
    );
    const unsubBuy = onSnapshot(qBuy, (snap) => {
      buys = snap.docs.map((d) => ({ id: d.id, ...d.data() }) as PreMarketOrder);
      merge();
    });
    const unsubSell = onSnapshot(qSell, (snap) => {
      sells = snap.docs.map((d) => ({ id: d.id, ...d.data() }) as PreMarketOrder);
      merge();
    });
    return () => {
      unsubBuy();
      unsubSell();
    };
  }, [user]);

  const handleCancel = async (orderId: string) => {
    setCancelling(orderId);
    try {
      await cancelPreMarketOrderFunction({ orderId });
      showNotification('success', 'Order cancelled.');
    } catch (err) {
      showNotification('error', errorMessage(err) || 'Failed to cancel order.');
    } finally {
      setCancelling(null);
    }
  };

  const buys = orders.filter((o) => o.action === 'buy');
  const sells = orders.filter((o) => o.action === 'sell');

  return (
    <div className={`${overlayClass} z-50`} onClick={onClose}>
      <div className={`${modalShellClass} relative max-w-md`} onClick={(e) => e.stopPropagation()}>
        <div className={`flex items-center justify-between px-4 py-3 border-b ${borderClass}`}>
          <h2 className={`font-bold text-base ${textClass}`}>My Pre-Market Orders</h2>
          <button onClick={onClose} className={`text-lg leading-none ${mutedClass} hover:opacity-70`}>
            ✕
          </button>
        </div>

        <div className="p-4 space-y-3 max-h-[70vh] overflow-y-auto">
          {orders.length === 0 ? (
            <p className={`text-sm text-center py-6 ${mutedClass}`}>No pending orders this session.</p>
          ) : (
            <>
              {buys.length > 0 && (
                <div>
                  <p className={`text-xs font-semibold uppercase mb-2 ${mutedClass}`}>Buys</p>
                  <div className="space-y-2">
                    {buys.map((o) => (
                      <OrderRow
                        key={o.id}
                        order={o}
                        onCancel={handleCancel}
                        cancelling={cancelling}
                        darkMode={darkMode}
                        textClass={textClass}
                        mutedClass={mutedClass}
                      />
                    ))}
                  </div>
                </div>
              )}
              {sells.length > 0 && (
                <div>
                  <p className={`text-xs font-semibold uppercase mb-2 ${mutedClass}`}>Sells</p>
                  <div className="space-y-2">
                    {sells.map((o) => (
                      <OrderRow
                        key={o.id}
                        order={o}
                        onCancel={handleCancel}
                        cancelling={cancelling}
                        darkMode={darkMode}
                        textClass={textClass}
                        mutedClass={mutedClass}
                      />
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
};

const OrderRow = ({
  order,
  onCancel,
  cancelling,
  darkMode,
  textClass,
  mutedClass,
}: {
  order: PreMarketOrder;
  onCancel: (orderId: string) => void;
  cancelling: string | null;
  darkMode: boolean;
  textClass: string;
  mutedClass: string;
}) => (
  <div
    className={`flex items-center justify-between px-3 py-2 rounded-sm ${darkMode ? 'bg-zinc-800' : 'bg-slate-100'}`}
  >
    <div>
      <span className={`font-bold text-sm ${textClass}`}>${order.ticker}</span>
      <span className={`text-xs ml-2 ${order.action === 'buy' ? 'text-green-500' : 'text-red-400'}`}>
        {order.action.toUpperCase()}
      </span>
      <span className={`text-xs ml-2 ${mutedClass}`}>{order.shares} shares</span>
      {order.allowPartialFills && <span className={`text-xs ml-1 ${mutedClass}`}>(partial ok)</span>}
    </div>
    <button
      onClick={() => onCancel(order.id)}
      disabled={!!cancelling}
      className="text-xs px-2 py-1 rounded-sm bg-red-600 hover:bg-red-700 text-white disabled:opacity-50"
    >
      {cancelling === order.id ? '...' : 'Cancel'}
    </button>
  </div>
);

export default MyPreMarketOrdersModal;
