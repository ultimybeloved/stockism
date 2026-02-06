import React, { useState, useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';

// Ladder icon component - tan circle with X
const LadderIcon = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" className="inline-block">
    <circle cx="12" cy="12" r="11" fill="#b4ac99" />
    <text
      x="12"
      y="12"
      textAnchor="middle"
      dominantBaseline="central"
      fontSize="16"
      fontWeight="bold"
      fill="#333"
    >
      X
    </text>
  </svg>
);

const MobileBottomNav = ({ darkMode }) => {
  const location = useLocation();
  const [isVisible, setIsVisible] = useState(true);
  const [lastScrollY, setLastScrollY] = useState(0);

  useEffect(() => {
    const handleScroll = () => {
      const currentScrollY = window.scrollY;

      // Show if at top of page
      if (currentScrollY < 10) {
        setIsVisible(true);
      }
      // Hide when scrolling down, show when scrolling up
      else if (currentScrollY > lastScrollY) {
        setIsVisible(false);
      } else {
        setIsVisible(true);
      }

      setLastScrollY(currentScrollY);
    };

    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, [lastScrollY]);

  const isActivePage = (path) => {
    return location.pathname === path;
  };

  const navItems = [
    {
      path: '/',
      icon: <img src="/pins/stockism_logo.png" alt="Home" className="w-6 h-6" />,
      label: 'Home'
    },
    { path: '/leaderboard', icon: '🏆', label: 'Leaderboard' },
    { path: '/ladder', icon: <LadderIcon />, label: 'Ladder' },
    { path: '/achievements', icon: '🏅', label: 'Achievements' },
    { path: '/profile', icon: '👤', label: 'Profile' }
  ];

  return (
    <nav
      className={`md:hidden fixed bottom-0 left-0 right-0 z-40 border-t shadow-lg transition-transform duration-300 ${
        isVisible ? 'translate-y-0' : 'translate-y-full'
      } ${
        darkMode
          ? 'bg-zinc-900 border-zinc-800'
          : 'bg-white border-gray-200'
      }`}
    >
      <div className="flex items-center justify-around h-16">
        {navItems.map(item => (
          <Link
            key={item.path}
            to={item.path}
            className={`flex flex-col items-center justify-center flex-1 h-full transition-colors ${
              isActivePage(item.path)
                ? darkMode
                  ? 'text-orange-400'
                  : 'text-orange-600'
                : darkMode
                  ? 'text-zinc-400'
                  : 'text-gray-600'
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
