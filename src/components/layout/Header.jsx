import React, { useState, useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { signOut } from 'firebase/auth';
import { auth } from '../../firebase';
import { ADMIN_UIDS } from '../../constants';
import { formatCurrency } from '../../utils/formatters';

// Ladder icon component - tan circle with X
const LadderIcon = () => (
  <svg width="20" height="20" viewBox="0 0 20 20" className="inline-block">
    <circle cx="10" cy="10" r="9" fill="#b4ac99" />
    <text
      x="10"
      y="10"
      textAnchor="middle"
      dominantBaseline="central"
      fontSize="14"
      fontWeight="bold"
      fill="#333"
    >
      X
    </text>
  </svg>
);

const Header = ({ darkMode, setDarkMode, user, userData, onShowAdminPanel, isGuest, onShowLogin }) => {
  const location = useLocation();
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const handleScroll = () => {
      setScrolled(window.scrollY > 10);
    };

    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

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
    { path: '/ladder', label: 'Ladder', icon: <LadderIcon /> },
    { path: '/achievements', label: 'Achievements', icon: '🏅' }
  ];

  return (
    <header className={`sticky top-0 z-40 border-b shadow-sm ${
      darkMode
        ? 'bg-zinc-900 border-zinc-800'
        : 'bg-white border-gray-200'
    }`}>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="relative flex items-center justify-between h-16">
          {/* Mobile: Logo on left */}
          <Link to="/" className="flex-shrink-0 md:hidden">
            <img
              src={darkMode ? "/stockism grey splatter.png" : "/stockism logo.png"}
              alt="Stockism"
              className="h-10 w-auto select-none cursor-pointer hover:opacity-90 transition-opacity"
              draggable="false"
              onContextMenu={(e) => e.preventDefault()}
              style={{ userSelect: 'none', WebkitUserSelect: 'none' }}
            />
          </Link>

          {/* Desktop: Nav links on left */}
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

          {/* Desktop: Centered oversized logo */}
          <Link
            to="/"
            className={`hidden md:block absolute left-1/2 -translate-x-1/2 z-50 transition-[transform,top] duration-500 ease-in-out ${
              scrolled ? 'top-1/2 -translate-y-1/2' : 'top-0 translate-y-0'
            }`}
          >
            <img
              src={darkMode ? "/stockism grey splatter.png" : "/stockism logo.png"}
              alt="Stockism"
              className={`w-auto select-none cursor-pointer hover:opacity-90 transition-[height,opacity] duration-500 ease-in-out ${
                scrolled ? 'h-10' : 'h-40'
              }`}
              draggable="false"
              onContextMenu={(e) => e.preventDefault()}
              style={{ userSelect: 'none', WebkitUserSelect: 'none' }}
            />
          </Link>

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
                  className={`flex items-center space-x-2 px-2 py-1 sm:px-3 sm:py-2 rounded-md text-sm font-medium transition-colors ${
                    isActivePage('/profile')
                      ? darkMode
                        ? 'bg-orange-600 text-white'
                        : 'bg-orange-500 text-white'
                      : darkMode
                        ? 'text-zinc-300 hover:bg-zinc-800'
                        : 'text-gray-700 hover:bg-gray-100'
                  }`}
                >
                  <span className="text-base sm:text-lg">👤</span>
                  <div className="text-right">
                    <div className={`text-[10px] sm:text-xs ${
                      isActivePage('/profile')
                        ? 'text-white/70'
                        : darkMode ? 'text-zinc-400' : 'text-gray-500'
                    }`}>
                      {userData?.displayName || user.email?.split('@')[0] || 'Anonymous'}
                    </div>
                    <div className={`text-xs sm:text-sm font-semibold ${
                      isActivePage('/profile')
                        ? 'text-white'
                        : 'text-teal-600'
                    }`}>
                      {formatCurrency(userData?.portfolioValue || 0)}
                    </div>
                  </div>
                </Link>

                <button
                  onClick={handleSignOut}
                  className={`hidden sm:block px-3 py-2 text-sm font-medium rounded-md transition-colors ${
                    darkMode
                      ? 'text-zinc-400 hover:bg-zinc-800'
                      : 'text-gray-600 hover:bg-gray-100'
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
          </div>
        </div>
      </div>
    </header>
  );
};

export default Header;
