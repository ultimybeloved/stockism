import React, { useState, useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

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

const MobileBottomNav = ({ darkMode, user }) => {
  const location = useLocation();
  const navigate = useNavigate();
  const [isVisible, setIsVisible] = useState(true);
  const lastScrollY = useRef(0);
  const isVisibleRef = useRef(true);

  useEffect(() => {
    const handleScroll = () => {
      const currentScrollY = window.scrollY;
      let shouldShow;

      if (currentScrollY < 10) {
        shouldShow = true;
      } else {
        shouldShow = currentScrollY <= lastScrollY.current;
      }

      if (shouldShow !== isVisibleRef.current) {
        isVisibleRef.current = shouldShow;
        setIsVisible(shouldShow);
      }

      lastScrollY.current = currentScrollY;
    };

    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  const isActivePage = (path) => {
    return location.pathname === path;
  };

  const navItems = [
    {
      path: '/',
      icon: <img src="/pins/alpha/stockism_logo.png" alt="Home" className="w-6 h-6" />,
      label: 'Home'
    },
    { path: '/leaderboard', icon: '🏆', label: 'Leaderboard' },
    { path: '/ladder', icon: <LadderIcon />, label: 'Ladder' },
    { path: '/achievements', icon: '🏅', label: 'Achievements' },
    ...(user ? [{ path: '/profile', icon: '👤', label: 'Profile' }] : [])
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
          <button
            key={item.path}
            onClick={() => navigate(
              item.path === '/' ? '/' : (isActivePage(item.path) ? '/' : item.path)
            )}
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
          </button>
        ))}
      </div>
    </nav>
  );
};

export default MobileBottomNav;
