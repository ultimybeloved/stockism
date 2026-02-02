import React, { useState, useEffect } from 'react';
import { collection, query, where, orderBy, getDocs, addDoc, updateDoc, doc, serverTimestamp } from 'firebase/firestore';
import { db } from '../firebase';

const LimitOrders = ({ user, darkMode, prices, characters }) => {
  const [activeTab, setActiveTab] = useState('create'); // 'create' or 'orders'
  const [pendingOrders, setPendingOrders] = useState([]);
  const [loading, setLoading] = useState(false);

  // Form state
  const [selectedTicker, setSelectedTicker] = useState('');
  const [orderType, setOrderType] = useState('BUY');
  const [shares, setShares] = useState(1);
  const [limitPrice, setLimitPrice] = useState('');
  const [allowPartialFills, setAllowPartialFills] = useState(false);

  const cardClass = darkMode ? 'bg-zinc-900 border-zinc-800' : 'bg-white border-slate-200';
  const textClass = darkMode ? 'text-zinc-100' : 'text-slate-900';
  const mutedClass = darkMode ? 'text-zinc-400' : 'text-slate-600';
  const inputClass = darkMode
    ? 'bg-zinc-800 border-zinc-700 text-zinc-100'
    : 'bg-white border-slate-300 text-slate-900';

  useEffect(() => {
    if (user) {
      loadPendingOrders();
    }
  }, [user]);

  const loadPendingOrders = async () => {
    if (!user) return;

    try {
      const ordersRef = collection(db, 'limitOrders');
      const q = query(
        ordersRef,
        where('userId', '==', user.uid),
        where('status', 'in', ['PENDING', 'PARTIALLY_FILLED']),
        orderBy('createdAt', 'desc')
      );

      const snapshot = await getDocs(q);
      const orders = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));

      setPendingOrders(orders);
    } catch (error) {
      console.error('Error loading orders:', error);
    }
  };

  const handleCreateOrder = async () => {
    if (!selectedTicker || !limitPrice || shares < 1) {
      alert('Please fill in all fields');
      return;
    }

    const priceNum = parseFloat(limitPrice);
    if (isNaN(priceNum) || priceNum <= 0) {
      alert('Please enter a valid price');
      return;
    }

    setLoading(true);
    try {
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 30); // 30 day expiration

      await addDoc(collection(db, 'limitOrders'), {
        userId: user.uid,
        ticker: selectedTicker,
        type: orderType,
        shares: parseInt(shares),
        limitPrice: priceNum,
        allowPartialFills,
        status: 'PENDING',
        filledShares: 0,
        createdAt: serverTimestamp(),
        expiresAt: expiresAt.getTime(),
        updatedAt: serverTimestamp()
      });

      alert('Limit order created!');

      // Reset form
      setSelectedTicker('');
      setShares(1);
      setLimitPrice('');
      setAllowPartialFills(false);

      // Reload orders
      await loadPendingOrders();
      setActiveTab('orders');
    } catch (error) {
      console.error('Error creating order:', error);
      alert(`Failed to create order: ${error.message}`);
    }
    setLoading(false);
  };

  const handleCancelOrder = async (orderId) => {
    if (!confirm('Cancel this limit order?')) return;

    setLoading(true);
    try {
      await updateDoc(doc(db, 'limitOrders', orderId), {
        status: 'CANCELED',
        updatedAt: serverTimestamp()
      });

      alert('Order canceled');
      await loadPendingOrders();
    } catch (error) {
      console.error('Error canceling order:', error);
      alert(`Failed to cancel order: ${error.message}`);
    }
    setLoading(false);
  };

  const currentPrice = selectedTicker ? prices[selectedTicker] : 0;
  const character = selectedTicker ? characters.find(c => c.ticker === selectedTicker) : null;

  return (
    <div className={`${cardClass} border rounded-sm p-4`}>
      <div className="flex justify-between items-center mb-4">
        <h2 className={`text-xl font-bold ${textClass}`}>📋 Limit Orders</h2>
        <div className="flex gap-2">
          <button
            onClick={() => setActiveTab('create')}
            className={`px-4 py-2 text-sm font-semibold rounded ${
              activeTab === 'create'
                ? 'bg-blue-600 text-white'
                : darkMode ? 'bg-zinc-800 text-zinc-400' : 'bg-slate-200 text-slate-600'
            }`}
          >
            Create Order
          </button>
          <button
            onClick={() => { setActiveTab('orders'); loadPendingOrders(); }}
            className={`px-4 py-2 text-sm font-semibold rounded ${
              activeTab === 'orders'
                ? 'bg-blue-600 text-white'
                : darkMode ? 'bg-zinc-800 text-zinc-400' : 'bg-slate-200 text-slate-600'
            }`}
          >
            My Orders ({pendingOrders.length})
          </button>
        </div>
      </div>

      {activeTab === 'create' && (
        <div className="space-y-4">
          <p className={`text-sm ${mutedClass}`}>
            Set orders that execute automatically when price conditions are met. Orders expire in 30 days.
          </p>

          {/* Ticker Selection */}
          <div>
            <label className={`block text-sm font-semibold mb-2 ${textClass}`}>Stock</label>
            <select
              value={selectedTicker}
              onChange={e => {
                setSelectedTicker(e.target.value);
                if (prices[e.target.value]) {
                  setLimitPrice(prices[e.target.value].toFixed(2));
                }
              }}
              className={`w-full px-3 py-2 border rounded ${inputClass}`}
            >
              <option value="">Select a stock...</option>
              {characters.map(char => (
                <option key={char.ticker} value={char.ticker}>
                  ${char.ticker} - {char.name} (${prices[char.ticker]?.toFixed(2) || '0.00'})
                </option>
              ))}
            </select>
          </div>

          {/* Order Type */}
          <div>
            <label className={`block text-sm font-semibold mb-2 ${textClass}`}>Order Type</label>
            <div className="flex gap-2">
              <button
                onClick={() => setOrderType('BUY')}
                className={`flex-1 px-4 py-2 font-semibold rounded ${
                  orderType === 'BUY'
                    ? 'bg-green-600 text-white'
                    : darkMode ? 'bg-zinc-800 text-zinc-400' : 'bg-slate-200 text-slate-600'
                }`}
              >
                Buy
              </button>
              <button
                onClick={() => setOrderType('SELL')}
                className={`flex-1 px-4 py-2 font-semibold rounded ${
                  orderType === 'SELL'
                    ? 'bg-red-600 text-white'
                    : darkMode ? 'bg-zinc-800 text-zinc-400' : 'bg-slate-200 text-slate-600'
                }`}
              >
                Sell
              </button>
            </div>
          </div>

          {/* Shares */}
          <div>
            <label className={`block text-sm font-semibold mb-2 ${textClass}`}>Shares</label>
            <input
              type="number"
              min="1"
              value={shares}
              onChange={e => setShares(Math.max(1, parseInt(e.target.value) || 1))}
              className={`w-full px-3 py-2 border rounded ${inputClass}`}
            />
          </div>

          {/* Limit Price */}
          <div>
            <label className={`block text-sm font-semibold mb-2 ${textClass}`}>
              Limit Price
              {currentPrice > 0 && (
                <span className={`ml-2 text-xs ${mutedClass}`}>
                  (Current: ${currentPrice.toFixed(2)})
                </span>
              )}
            </label>
            <input
              type="number"
              step="0.01"
              min="0.01"
              value={limitPrice}
              onChange={e => setLimitPrice(e.target.value)}
              placeholder="0.00"
              className={`w-full px-3 py-2 border rounded ${inputClass}`}
            />
            <p className={`text-xs ${mutedClass} mt-1`}>
              {orderType === 'BUY'
                ? 'Order executes when price drops to or below this price'
                : 'Order executes when price rises to or above this price'}
            </p>
          </div>

          {/* Partial Fills */}
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="partialFills"
              checked={allowPartialFills}
              onChange={e => setAllowPartialFills(e.target.checked)}
              className="w-4 h-4"
            />
            <label htmlFor="partialFills" className={`text-sm ${textClass}`}>
              Allow partial fills
            </label>
          </div>
          <p className={`text-xs ${mutedClass} -mt-2`}>
            If unchecked, order only executes if all shares can be bought/sold
          </p>

          {/* Submit */}
          <button
            onClick={handleCreateOrder}
            disabled={loading || !selectedTicker || !limitPrice || shares < 1}
            className="w-full px-4 py-3 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded disabled:opacity-50"
          >
            {loading ? 'Creating...' : 'Create Limit Order'}
          </button>
        </div>
      )}

      {activeTab === 'orders' && (
        <div className="space-y-4">
          {pendingOrders.length === 0 ? (
            <p className={`text-center py-8 ${mutedClass}`}>
              No pending limit orders
            </p>
          ) : (
            pendingOrders.map(order => {
              const char = characters.find(c => c.ticker === order.ticker);
              const currentPrice = prices[order.ticker] || 0;
              const isClose = Math.abs(currentPrice - order.limitPrice) / order.limitPrice < 0.05; // Within 5%

              return (
                <div
                  key={order.id}
                  className={`p-4 border rounded ${darkMode ? 'bg-zinc-800 border-zinc-700' : 'bg-slate-50 border-slate-300'}`}
                >
                  <div className="flex justify-between items-start mb-2">
                    <div>
                      <div className={`font-bold ${textClass}`}>
                        {order.type} {order.shares} ${order.ticker}
                      </div>
                      <div className={`text-sm ${mutedClass}`}>{char?.name}</div>
                    </div>
                    <button
                      onClick={() => handleCancelOrder(order.id)}
                      disabled={loading}
                      className="px-3 py-1 text-xs bg-red-600 hover:bg-red-700 text-white font-semibold rounded disabled:opacity-50"
                    >
                      Cancel
                    </button>
                  </div>

                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <div>
                      <div className={mutedClass}>Limit Price</div>
                      <div className={`font-bold ${textClass}`}>${order.limitPrice.toFixed(2)}</div>
                    </div>
                    <div>
                      <div className={mutedClass}>Current Price</div>
                      <div className={`font-bold ${isClose ? 'text-orange-500' : textClass}`}>
                        ${currentPrice.toFixed(2)}
                        {isClose && ' ⚠️'}
                      </div>
                    </div>
                    <div>
                      <div className={mutedClass}>Status</div>
                      <div className={`font-semibold ${order.status === 'PARTIALLY_FILLED' ? 'text-yellow-500' : 'text-blue-500'}`}>
                        {order.status}
                        {order.status === 'PARTIALLY_FILLED' && ` (${order.filledShares}/${order.shares})`}
                      </div>
                    </div>
                    <div>
                      <div className={mutedClass}>Partial Fills</div>
                      <div className={textClass}>{order.allowPartialFills ? '✅ Yes' : '❌ No'}</div>
                    </div>
                  </div>

                  <div className={`mt-2 pt-2 border-t ${darkMode ? 'border-zinc-700' : 'border-slate-300'} text-xs ${mutedClass}`}>
                    Created: {order.createdAt?.toDate ? order.createdAt.toDate().toLocaleString() : 'Unknown'}
                    {order.expiresAt && (
                      <> • Expires: {new Date(order.expiresAt).toLocaleDateString()}</>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
};

export default LimitOrders;
