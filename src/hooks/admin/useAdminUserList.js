import { useState } from 'react';
import { collection, getDocs, doc, getDoc } from 'firebase/firestore';
import { db } from '../../firebase';

// Containers the user card indexes into directly — UserPositions does
// Object.keys(selectedUser.holdings) with no guard, and there are several more
// like it. A raw user document may be missing any of them: new, reset and
// bankrupt accounts often have no holdings/shorts/bets field at all. Both the
// list rows and the full-document load run through here so neither can hand a
// component an undefined where it expects an object.
const withUserDefaults = (data) => ({
  displayName: data.displayName || 'Unknown',
  cash: data.cash || 0,
  portfolioValue: data.portfolioValue || 0,
  holdings: data.holdings || {},
  shorts: data.shorts || {},
  bets: data.bets || {},
  costBasis: data.costBasis || {},
  transactionLog: data.transactionLog || [],
  ownedCosmetics: data.ownedCosmetics || [],
  activeCosmetics: data.activeCosmetics || {},
  lowestWhileHolding: data.lowestWhileHolding || {},
  peakPortfolioValue: data.peakPortfolioValue || 0,
  totalTrades: data.totalTrades || 0,
  totalCheckins: data.totalCheckins || 0,
  isAdmin: data.isAdmin || false,
  isBankrupt: data.isBankrupt || false,
  marginEnabled: data.marginEnabled || false,
  marginUsed: data.marginUsed || 0,
  activeLoan: data.activeLoan || null,
  crew: data.crew || null,
  discordId: data.discordId || null,
  discordUsername: data.discordUsername || null,
  requiresDiscordLink: data.requiresDiscordLink || false,
});

// Users tab: load/search/sort the user list and selected-user card.
export function useAdminUserList({ showMessage, setLoading, prices }) {
  // User search state
  const [userSearchQuery, setUserSearchQuery] = useState('');
  const [userSearchResults, setUserSearchResults] = useState([]);
  const [selectedUser, setSelectedUser] = useState(null);
  const [allUsers, setAllUsers] = useState([]);
  const [usersPage, setUsersPage] = useState(0);
  const [userSortBy, setUserSortBy] = useState('portfolio-high'); // 'portfolio-high', 'portfolio-low', 'cash-high', 'cash-low'
  const USERS_PER_PAGE = 25;

  // Load all users for search
  const handleLoadAllUsers = async () => {
    setLoading(true);
    try {
      const usersRef = collection(db, 'users');
      const snapshot = await getDocs(usersRef);
      
      // Deliberately trimmed to these fields — this loads the whole collection,
      // so rows stay small. selectUser fetches the full document on click.
      const users = [];
      snapshot.forEach(doc => {
        users.push({ id: doc.id, ...withUserDefaults(doc.data()) });
      });

      setAllUsers(users);
      setUserSearchResults(sortUsers(users));
      showMessage('success', `Loaded ${users.length} users`);
    } catch (err) {
      console.error(err);
      showMessage('error', 'Failed to load users');
    }
    setLoading(false);
  };

  // Open a user's card. handleLoadAllUsers trims every user to the columns the
  // table needs, so the detail panel would otherwise be missing anything not on
  // that list — achievements, crew head status, pins. Show the trimmed row
  // straight away so the card opens instantly, then swap in the real document.
  const selectUser = async (user) => {
    if (!user) {
      setSelectedUser(null);
      return;
    }
    setSelectedUser(user);
    try {
      const snap = await getDoc(doc(db, 'users', user.id));
      // Raw document first so fields the list never loaded (achievements,
      // isCrewHead, pins) come through, then the defaults fill the blanks.
      if (snap.exists()) {
        const data = snap.data();
        setSelectedUser({ ...data, id: snap.id, ...withUserDefaults(data) });
      }
    } catch (err) {
      console.error('Failed to load full user document:', err);
    }
  };

  // Helper: Calculate live portfolio value for a user
  const calculateLivePortfolioValue = (userData) => {
    if (!prices || Object.keys(prices).length === 0) return null;

    const holdings = userData.holdings || {};
    const shorts = userData.shorts || {};
    const cash = userData.cash || 0;

    // Calculate holdings value
    let holdingsValue = 0;
    for (const [ticker, holdingData] of Object.entries(holdings)) {
      const currentPrice = prices[ticker] || 0;
      const shares = typeof holdingData === 'number' ? holdingData : (holdingData?.shares || 0);
      holdingsValue += currentPrice * shares;
    }

    // Calculate shorts value (collateral + P&L)
    let shortsValue = 0;
    for (const [ticker, position] of Object.entries(shorts)) {
      if (!position || typeof position !== 'object') continue;
      const shares = position.shares || 0;
      if (shares <= 0) continue;
      const entryPrice = position.costBasis || position.entryPrice || 0;
      const currentPrice = prices[ticker] || entryPrice;
      const collateral = position.margin || 0;
      if (position.system === 'v2') {
        // v2: margin + unrealized P&L (no proceeds in cash)
        shortsValue += collateral + (entryPrice - currentPrice) * shares;
      } else {
        // Legacy: margin collateral - cost to buy back shares
        shortsValue += collateral - (currentPrice * shares);
      }
    }

    return Math.round((cash + holdingsValue + shortsValue) * 100) / 100;
  };

  // Filter users by search query
  // Apply sorting to users
  const sortUsers = (users) => {
    const sorted = [...users];
    switch (userSortBy) {
      case 'portfolio-high':
        return sorted.sort((a, b) => (b.portfolioValue || 0) - (a.portfolioValue || 0));
      case 'portfolio-low':
        return sorted.sort((a, b) => (a.portfolioValue || 0) - (b.portfolioValue || 0));
      case 'cash-high':
        return sorted.sort((a, b) => (b.cash || 0) - (a.cash || 0));
      case 'cash-low':
        return sorted.sort((a, b) => (a.cash || 0) - (b.cash || 0));
      default:
        return sorted;
    }
  };

  const handleUserSearch = (query) => {
    setUserSearchQuery(query);
    if (!query.trim()) {
      setUserSearchResults(sortUsers(allUsers));
      return;
    }

    const q = query.toLowerCase();
    const filtered = allUsers.filter(u =>
      (u.displayName || '').toLowerCase().includes(q) ||
      u.id.toLowerCase().includes(q) ||
      (u.discordId || '').toLowerCase().includes(q) ||
      (u.discordUsername || '').toLowerCase().includes(q)
    );
    setUserSearchResults(sortUsers(filtered));
  };

  // Handle sort change
  const handleUserSortChange = (newSort) => {
    setUserSortBy(newSort);
    // Re-apply current search with new sort
    handleUserSearch(userSearchQuery);
  };

  return {
    userSearchQuery, handleUserSearch, userSearchResults, setUserSearchResults,
    userSortBy, handleUserSortChange,
    handleLoadAllUsers, allUsers, setAllUsers, usersPage, setUsersPage, USERS_PER_PAGE,
    selectedUser, setSelectedUser, selectUser, calculateLivePortfolioValue,
  };
}
