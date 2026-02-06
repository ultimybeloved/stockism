import React, { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { signOut } from 'firebase/auth';
import { auth } from '../../firebase';
import { ADMIN_UIDS } from '../../constants';
import { formatCurrency } from '../../utils/formatters';

const Header = ({ darkMode, setDarkMode, user, userData, onShowAdminPanel, isGuest, onShowLogin }) => {
  const location = useLocation();
  const [showMobileMenu, setShowMobileMenu] = useState(false);

  const isAdmin = user && ADMIN_UIDS.includes(user.uid);

  const handleSignOut = async () => {
    try {
      await signOut(auth);
    } catch (error) {
      console.error('Error signing out:', error);
    }
  };

  const isActivePage = (path) => {
    return location.pathname === path;
  };

  const navLinks = [
    { path: '/leaderboard', label: 'Leaderboard', icon: '🏆' },
    { path: '/ladder', label: 'Ladder', icon: '🎰' },
    { path: '/achievements', label: 'Achievements', icon: '🏅' }
  ];

  return (
    <header className={`sticky top-0 z-40 border-b shadow-sm ${
      darkMode
        ? 'bg-zinc-900 border-zinc-800'
        : 'bg-white border-gray-200'
    }`}>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          {/* Desktop Navigation */}
          <nav className="hidden md:flex items-center space-x-1">
            {navLinks.map(link => (
              <Link
                key={link.path}
                to={link.path}
                className={`px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                  isActivePage(link.path)
                    ? darkMode
                      ? 'bg-orange-600 text-white'
                      : 'bg-orange-500 text-white'
                    : darkMode
                      ? 'text-zinc-300 hover:bg-zinc-800'
                      : 'text-gray-700 hover:bg-gray-100'
                }`}
              >
                <span className="mr-1">{link.icon}</span>
                {link.label}
              </Link>
            ))}
          </nav>

          {/* User Info & Controls */}
          <div className="flex items-center space-x-2 sm:space-x-4">
            {/* Dark Mode Toggle */}
            <button
              onClick={() => setDarkMode(!darkMode)}
              className={`p-2 rounded-md transition-colors ${
                darkMode ? 'hover:bg-zinc-800' : 'hover:bg-gray-100'
              }`}
              aria-label="Toggle dark mode"
            >
              {darkMode ? '☀️' : '🌙'}
            </button>

            {/* Admin Panel (Admin Only) */}
            {isAdmin && (
              <button
                onClick={onShowAdminPanel}
                className={`p-2 rounded-md transition-colors ${
                  darkMode
                    ? 'hover:bg-zinc-800 text-red-400'
                    : 'hover:bg-gray-100 text-red-600'
                }`}
                aria-label="Admin Panel"
                title="Admin Panel"
              >
                ⚙️
              </button>
            )}

            {/* User Info */}
            {user ? (
              <div className="flex items-center space-x-2">
                <Link
                  to="/profile"
                  className={`hidden sm:flex items-center space-x-2 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                    isActivePage('/profile')
                      ? darkMode
                        ? 'bg-orange-600 text-white'
                        : 'bg-orange-500 text-white'
                      : darkMode
                        ? 'text-zinc-300 hover:bg-zinc-800'
                        : 'text-gray-700 hover:bg-gray-100'
                  }`}
                >
                  <span>{userData?.photoURL ? '👤' : '😎'}</span>
                  <div className="text-right">
                    <div className={`text-xs ${
                      isActivePage('/profile')
                        ? 'text-white/70'
                        : darkMode ? 'text-zinc-400' : 'text-gray-500'
                    }`}>
                      {userData?.displayName || user.email?.split('@')[0] || 'Anonymous'}
                    </div>
                    <div className={`font-semibold ${
                      isActivePage('/profile')
                        ? 'text-white'
                        : 'text-green-600'
                    }`}>
                      {formatCurrency(userData?.cash || 0)}
                    </div>
                  </div>
                </Link>

                <button
                  onClick={handleSignOut}
                  className={`px-3 py-2 text-sm font-medium rounded-md transition-colors ${
                    darkMode
                      ? 'text-red-400 hover:bg-red-900/20'
                      : 'text-red-600 hover:bg-red-50'
                  }`}
                >
                  Sign Out
                </button>
              </div>
            ) : (
              <div className={`text-sm ${darkMode ? 'text-zinc-300' : 'text-gray-700'}`}>
                Sign in to trade
              </div>
            )}

            {/* Mobile Menu Toggle */}
            <button
              onClick={() => setShowMobileMenu(!showMobileMenu)}
              className={`md:hidden p-2 rounded-md transition-colors ${
                darkMode ? 'hover:bg-zinc-800' : 'hover:bg-gray-100'
              }`}
              aria-label="Toggle menu"
            >
              {showMobileMenu ? '✕' : '☰'}
            </button>
          </div>
        </div>

        {/* Mobile Menu */}
        {showMobileMenu && (
          <div className={`md:hidden py-3 border-t ${
            darkMode ? 'border-zinc-800' : 'border-gray-200'
          }`}>
            <nav className="flex flex-col space-y-1">
              {navLinks.map(link => (
                <Link
                  key={link.path}
                  to={link.path}
                  onClick={() => setShowMobileMenu(false)}
                  className={`px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                    isActivePage(link.path)
                      ? darkMode
                        ? 'bg-orange-600 text-white'
                        : 'bg-orange-500 text-white'
                      : darkMode
                        ? 'text-zinc-300 hover:bg-zinc-800'
                        : 'text-gray-700 hover:bg-gray-100'
                  }`}
                >
                  <span className="mr-2">{link.icon}</span>
                  {link.label}
                </Link>
              ))}
              {user && (
                <Link
                  to="/profile"
                  onClick={() => setShowMobileMenu(false)}
                  className={`px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                    isActivePage('/profile')
                      ? darkMode
                        ? 'bg-orange-600 text-white'
                        : 'bg-orange-500 text-white'
                      : darkMode
                        ? 'text-zinc-300 hover:bg-zinc-800'
                        : 'text-gray-700 hover:bg-gray-100'
                  }`}
                >
                  <span className="mr-2">👤</span>
                  Profile
                </Link>
              )}
            </nav>
          </div>
        )}
      </div>
    </header>
  );
};

export default Header;
