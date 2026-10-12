import { useState, useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useSession } from '../../../context/AppContext';

import { useNewPredictions } from '../../../features/predictions/hooks/useNewPredictions';
import PixelIcon from '../PixelIcon';

const MobileBottomNav = () => {
  const { user } = useSession();
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

  const isActivePage = (path: string) => {
    return location.pathname === path;
  };

  const { newCount: newPredictions } = useNewPredictions();

  const navItems = [
    {
      path: '/',
      icon: <PixelIcon name="stockism" alt="Home" className="w-6 h-6" />,
      label: 'Home',
    },
    { path: '/leaderboard', icon: <PixelIcon name="trophy" className="w-6 h-6" />, label: 'Leaderboard' },
    {
      path: '/predictions',
      icon: <PixelIcon name="crystal" className="w-6 h-6" />,
      label: 'Predict',
      badge: newPredictions,
    },
    { path: '/ladder', icon: <PixelIcon name="ladder" className="w-6 h-6" />, label: 'Ladder' },
    { path: '/achievements', icon: <PixelIcon name="medal" className="w-6 h-6" />, label: 'Achievements' },
    ...(user ? [{ path: '/profile', icon: <PixelIcon name="profile" className="w-6 h-6" />, label: 'Profile' }] : []),
  ];

  return (
    <nav
      className={`md:hidden fixed bottom-0 left-0 right-0 z-40 border-t shadow-lg transition-transform duration-300 ${
        isVisible ? 'translate-y-0' : 'translate-y-full'
      } light:bg-white light:border-amber-200 dark:bg-zinc-900 dark:border-zinc-800`}
    >
      <div className="flex items-center justify-around h-16">
        {navItems.map((item) => (
          <button
            key={item.path}
            onClick={() => navigate(item.path === '/' ? '/' : isActivePage(item.path) ? '/' : item.path)}
            className={`relative flex flex-col items-center justify-center flex-1 h-full transition-colors ${
              isActivePage(item.path) ? 'text-orange-500' : 'light:text-zinc-600 dark:text-zinc-400'
            }`}
          >
            <span className="mb-1 flex h-6 items-center">{item.icon}</span>
            <span className="text-xs font-medium">{item.label}</span>
            {!!item.badge && item.badge > 0 && (
              <span className="absolute top-1.5 right-1/2 translate-x-4 min-w-[18px] h-[18px] px-1 flex items-center justify-center rounded-full bg-red-500 text-white text-[10px] font-bold">
                {item.badge > 9 ? '9+' : item.badge}
              </span>
            )}
          </button>
        ))}
      </div>
    </nav>
  );
};

export default MobileBottomNav;
