import React, { useState, useEffect, useRef, useCallback } from 'react';
import { collection, query, where, orderBy, limit, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase';

const ICONS = {
  trade: '📈',
  achievement: '🏆',
  mission: '📋',
};

function timeAgo(timestamp) {
  if (!timestamp) return '';
  const now = Date.now();
  const time = timestamp?.toMillis?.() ?? timestamp?.seconds * 1000 ?? timestamp;
  const diff = now - time;
  if (diff < 60000) return 'just now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  const d = new Date(time);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export default function TradeFeed({ darkMode, user, userCrew }) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState('crew'); // 'crew' | 'global'
  const [crewItems, setCrewItems] = useState([]);
  const [globalItems, setGlobalItems] = useState([]);
  const [unread, setUnread] = useState(0);
  const lastSeenRef = useRef(Date.now());

  // Track unread when collapsed
  const handleToggle = useCallback(() => {
    setOpen((prev) => {
      if (!prev) {
        setUnread(0);
        lastSeenRef.current = Date.now();
      }
      return !prev;
    });
  }, []);

  // Real-time listener for crew feed
  useEffect(() => {
    if (!userCrew) return;
    const q = query(
      collection(db, 'feed'),
      where('crew', '==', userCrew),
      orderBy('createdAt', 'desc'),
      limit(50)
    );
    const unsub = onSnapshot(q, (snap) => {
      const items = snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
      setCrewItems(items);
      if (!open) {
        const newCount = items.filter((item) => {
          const t = item.createdAt?.toMillis?.() ?? item.createdAt?.seconds * 1000 ?? 0;
          return t > lastSeenRef.current;
        }).length;
        setUnread((prev) => Math.max(prev, newCount));
      }
    });
    return unsub;
  }, [userCrew, open]);

  // Real-time listener for global feed
  useEffect(() => {
    const q = query(
      collection(db, 'feed'),
      orderBy('createdAt', 'desc'),
      limit(50)
    );
    const unsub = onSnapshot(q, (snap) => {
      const items = snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
      setGlobalItems(items);
      if (!open) {
        const newCount = items.filter((item) => {
          const t = item.createdAt?.toMillis?.() ?? item.createdAt?.seconds * 1000 ?? 0;
          return t > lastSeenRef.current;
        }).length;
        setUnread((prev) => Math.max(prev, newCount));
      }
    });
    return unsub;
  }, [open]);

  const items = tab === 'crew' ? crewItems : globalItems;

  return (
    <div className="fixed bottom-4 right-4 z-40">
      {/* Toggle button */}
      {!open && (
        <button
          onClick={handleToggle}
          className={`relative px-4 py-2 rounded-xl shadow-lg font-semibold text-sm transition-all
            ${darkMode
              ? 'bg-zinc-900/95 border border-zinc-700 text-zinc-100 hover:bg-zinc-800'
              : 'bg-white/95 border border-amber-200 text-slate-900 hover:bg-amber-50'
            }`}
        >
          📜 Trade Feed
          {unread > 0 && (
            <span className="absolute -top-2 -right-2 bg-orange-500 text-white text-xs font-bold rounded-full w-5 h-5 flex items-center justify-center">
              {unread > 9 ? '9+' : unread}
            </span>
          )}
        </button>
      )}

      {/* Feed panel */}
      {open && (
        <div
          className={`w-80 rounded-xl shadow-2xl border overflow-hidden flex flex-col
            ${darkMode
              ? 'bg-zinc-900/95 border-zinc-700 text-zinc-100'
              : 'bg-white/95 border-amber-200 text-slate-900'
            }`}
          style={{ maxHeight: '420px' }}
        >
          {/* Header */}
          <div className={`flex items-center justify-between px-3 py-2 border-b ${darkMode ? 'border-zinc-700' : 'border-amber-200'}`}>
            <span className="font-semibold text-sm">📜 Trade Feed</span>
            <button
              onClick={handleToggle}
              className={`text-xs px-2 py-0.5 rounded hover:opacity-80 ${darkMode ? 'text-zinc-400' : 'text-zinc-500'}`}
            >
              ✕
            </button>
          </div>

          {/* Tabs */}
          <div className={`flex border-b ${darkMode ? 'border-zinc-700' : 'border-amber-200'}`}>
            <button
              onClick={() => setTab('crew')}
              className={`flex-1 text-xs font-semibold py-1.5 transition-colors
                ${tab === 'crew'
                  ? 'text-orange-500 border-b-2 border-orange-500'
                  : darkMode ? 'text-zinc-400 hover:text-zinc-200' : 'text-zinc-500 hover:text-slate-700'
                }`}
            >
              My Crew
            </button>
            <button
              onClick={() => setTab('global')}
              className={`flex-1 text-xs font-semibold py-1.5 transition-colors
                ${tab === 'global'
                  ? 'text-orange-500 border-b-2 border-orange-500'
                  : darkMode ? 'text-zinc-400 hover:text-zinc-200' : 'text-zinc-500 hover:text-slate-700'
                }`}
            >
              Global
            </button>
          </div>

          {/* Feed list */}
          <div className="flex-1 overflow-y-auto px-2 py-1" style={{ maxHeight: '320px' }}>
            {items.length === 0 && (
              <p className={`text-xs text-center py-6 ${darkMode ? 'text-zinc-400' : 'text-zinc-500'}`}>
                {tab === 'crew' && !userCrew ? 'Join a crew to see crew activity.' : 'No activity yet.'}
              </p>
            )}
            {items.map((item) => (
              <div
                key={item.id}
                className={`flex items-start gap-2 py-2 border-b last:border-0 ${darkMode ? 'border-zinc-800' : 'border-amber-100'}`}
              >
                <span className="text-sm mt-0.5">{ICONS[item.type] || '📈'}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-xs leading-snug">
                    <span className="font-bold">{item.displayName || 'Someone'}</span>{' '}
                    <span className={darkMode ? 'text-zinc-400' : 'text-zinc-500'}>{item.message}</span>
                  </p>
                  <p className={`text-[10px] mt-0.5 ${darkMode ? 'text-zinc-500' : 'text-zinc-400'}`}>
                    {timeAgo(item.createdAt)}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
