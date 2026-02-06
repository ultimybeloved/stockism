# Navigation Restructure - Final Steps

## What's Done
- ✅ All page components created (Leaderboard, Achievements, Ladder, Profile)
- ✅ Layout components created (Header, MobileBottomNav, Layout)
- ✅ AppContext created for shared state
- ✅ react-router-dom installed
- ✅ BrowserRouter added to main.jsx
- ✅ All imports added to App.jsx

## What Remains

### In App.jsx - Add Routing Structure

The App.jsx needs to be wrapped with AppProvider and Routes. Here's the approach:

1. **Wrap the return statement** with AppProvider at the top level
2. **Replace old navigation** (lines 9622-9711 approx) with Layout component
3. **Add Routes** for different pages
4. **Remove old modal state** for showLeaderboard, showAchievements, showProfile, showLadderGame
5. **Update button handlers** to use navigate() instead of setState

### Manual Steps Required

Due to App.jsx being 10,500+ lines, the final integration requires:

1. Find the main `return (` statement around line 9607
2. Wrap entire return with:
```jsx
const contextValue = {
  darkMode,
  user,
  userData,
  prices,
  priceHistory,
  predictions,
  holdings: userData?.holdings || {},
  shorts: userData?.shorts || {},
  costBasis: userData?.costBasis || {},
  marketData,
  getColorBlindColors,
  showNotification
};

return (
  <AppProvider value={contextValue}>
    <Layout
      darkMode={darkMode}
      setDarkMode={setDarkMode}
      user={user}
      userData={userData}
      onShowAdminPanel={() => setShowAdmin(true)}
    >
      <Routes>
        <Route path="/" element={/* existing dashboard JSX */} />
        <Route path="/leaderboard" element={<LeaderboardPage />} />
        <Route path="/achievements" element={<AchievementsPage />} />
        <Route path="/ladder" element={<LadderPage />} />
        <Route path="/profile" element={
          <ProfilePage
            onOpenCrewSelection={() => setShowCrewSelection(true)}
            onDeleteAccount={handleDeleteAccount}
          />
        } />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Layout>
  </AppProvider>
);
```

3. Remove old navbar (delete lines 9622-9711)
4. Remove old modal render calls for:
   - `{showLeaderboard && <LeaderboardModal ... />}`
   - `{showAchievements && <AchievementsModal ... />}`
   - `{showProfile && <ProfileModal ... />}`
   - `{showLadderGame && <LadderGame ... />}`

5. Remove state declarations:
   - `const [showLeaderboard, setShowLeaderboard] = useState(false);`
   - `const [showAchievements, setShowAchievements] = useState(false);`
   - `const [showProfile, setShowProfile] = useState(false);`
   - `const [showLadderGame, setShowLadderGame] = useState(false);`

## Testing Checklist

After completing:
- [ ] `npm run dev` starts without errors
- [ ] Navigate to `/` shows main dashboard
- [ ] Navigate to `/leaderboard` shows leaderboard page
- [ ] Navigate to `/achievements` shows achievements page
- [ ] Navigate to `/ladder` shows ladder game
- [ ] Navigate to `/profile` shows profile page
- [ ] Header navigation works on all pages
- [ ] Mobile bottom nav appears on small screens
- [ ] Dark mode works on all pages
- [ ] Browser back/forward buttons work
- [ ] Deep links work (open `/leaderboard` directly in new tab)
