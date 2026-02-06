import React from 'react';
import Header from './Header';
import MobileBottomNav from './MobileBottomNav';

const Layout = ({ children, darkMode, setDarkMode, user, userData, onShowAdminPanel, isGuest, onShowLogin }) => {
  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
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
      <MobileBottomNav />
    </div>
  );
};

export default Layout;
