import React from 'react';
import { Link, useLocation } from 'react-router-dom';

const MobileBottomNav = () => {
  const location = useLocation();

  const isActivePage = (path) => {
    return location.pathname === path;
  };

  const navItems = [
    { path: '/', icon: '🏠', label: 'Home' },
    { path: '/leaderboard', icon: '🏆', label: 'Leaderboard' },
    { path: '/ladder', icon: '🎰', label: 'Ladder' },
    { path: '/achievements', icon: '🏅', label: 'Achievements' },
    { path: '/profile', icon: '👤', label: 'Profile' }
  ];

  return (
    <nav className="md:hidden fixed bottom-0 left-0 right-0 z-40 bg-white dark:bg-gray-800 border-t border-gray-200 dark:border-gray-700 shadow-lg">
      <div className="flex items-center justify-around h-16">
        {navItems.map(item => (
          <Link
            key={item.path}
            to={item.path}
            className={`flex flex-col items-center justify-center flex-1 h-full transition-colors ${
              isActivePage(item.path)
                ? 'text-indigo-600 dark:text-indigo-400'
                : 'text-gray-600 dark:text-gray-400'
            }`}
          >
            <span className="text-2xl mb-1">{item.icon}</span>
            <span className="text-xs font-medium">{item.label}</span>
          </Link>
        ))}
      </div>
    </nav>
  );
};

export default MobileBottomNav;
