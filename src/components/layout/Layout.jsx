import React from 'react';
import { Link } from 'react-router-dom';
import Header from './Header';
import MobileBottomNav from './MobileBottomNav';
import Footer from './Footer';

const Layout = ({ children, darkMode, setDarkMode, user, userData, onShowAdminPanel, isGuest, onShowLogin }) => {
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

      {/* Site Logo - appears on all pages, clickable to go home */}
      <div className="flex justify-center pt-4 pb-2">
        <Link to="/">
          <img
            src={darkMode ? "/stockism grey splatter.png" : "/stockism logo.png"}
            alt="Stockism"
            className="h-[100px] sm:h-[115px] md:h-[200px] w-auto select-none cursor-pointer hover:opacity-90 transition-opacity"
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
      <MobileBottomNav darkMode={darkMode} />
    </div>
  );
};

export default Layout;
