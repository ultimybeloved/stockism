import React from 'react';
import { Link } from 'react-router-dom';
import Header from './Header';
import MobileBottomNav from './MobileBottomNav';
import Footer from './Footer';
import MarketTicker from '../MarketTicker';

const Layout = ({ children, darkMode, setDarkMode, user, userData, onShowAdminPanel, isGuest, onShowLogin, prices, priceHistory, marketData }) => {
  return (
    <div className={`min-h-screen ${darkMode ? 'bg-zinc-950' : 'bg-gray-50'}`}>
      <Header
        darkMode={darkMode}
        setDarkMode={setDarkMode}
        user={user}
        userData={userData}
        onShowAdminPanel={onShowAdminPanel}
        isGuest={isGuest}
        onShowLogin={onShowLogin}
      />

      <MarketTicker
        prices={prices}
        priceHistory={priceHistory}
        marketData={marketData}
        darkMode={darkMode}
        colorBlindMode={userData?.colorBlindMode || false}
      />

      {/* Desktop Hero Logo - sits below ticker, scrolls away naturally */}
      <div className="hidden md:flex justify-center py-2">
        <Link to="/">
          <img
            src={darkMode ? "/stockism grey splatter.png" : "/stockism logo.png"}
            alt="Stockism"
            className="h-40 w-auto select-none cursor-pointer hover:opacity-90 transition-opacity"
            draggable="false"
            onContextMenu={(e) => e.preventDefault()}
            style={{ userSelect: 'none', WebkitUserSelect: 'none' }}
          />
        </Link>
      </div>

      <main className="pb-20 md:pb-6">
        {children}
      </main>

      <Footer darkMode={darkMode} />
      <MobileBottomNav darkMode={darkMode} user={user} />
    </div>
  );
};

export default Layout;
