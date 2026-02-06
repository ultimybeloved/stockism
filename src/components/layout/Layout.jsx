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

      <main className="pb-20 md:pb-6">
        {children}
      </main>

      <Footer darkMode={darkMode} />
      <MobileBottomNav darkMode={darkMode} />
    </div>
  );
};

export default Layout;
