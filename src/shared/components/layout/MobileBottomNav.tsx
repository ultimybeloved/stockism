import { useHideOnScroll } from '../../hooks/useHideOnScroll';
import { useLocation, useNavigate } from 'react-router-dom';

import { useNewPredictions } from '../../../features/predictions/hooks/useNewPredictions';
import PixelIcon from '../PixelIcon';

const MobileBottomNav = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const isVisible = useHideOnScroll();

  const isActivePage = (path: string) => {
    return location.pathname === path;
  };

  const { newCount: newPredictions } = useNewPredictions();

  const navItems = [
    {
      path: '/',
      icon: <PixelIcon name="stockism" alt="Home" className="w-7 h-7" />,
      label: 'Home',
    },
    { path: '/leaderboard', icon: <PixelIcon name="trophy" className="w-7 h-7" />, label: 'Leaderboard' },
    {
      path: '/predictions',
      icon: <PixelIcon name="crystal" className="w-7 h-7" />,
      label: 'Predict',
      badge: newPredictions,
    },
    // Ladder lives in the account menu on phones, to make room for Portfolio.
    { path: '/missions', icon: <PixelIcon name="missions" className="w-7 h-7" />, label: 'Missions' },
    {
      path: '/portfolio',
      icon: <PixelIcon name="briefcase" set="discord" className="w-7 h-7" />,
      label: 'Portfolio',
    },
  ];

  return (
    <nav
      className={`md:hidden fixed bottom-0 left-0 right-0 z-40 border-t shadow-lg transition-transform duration-300 ${
        isVisible ? 'translate-y-0' : 'translate-y-full'
      } light:bg-white light:border-amber-200 dark:bg-zinc-900 dark:border-zinc-800`}
    >
      <div className="flex items-center justify-around h-16" data-tour="nav">
        {navItems.map((item) => (
          <button
            key={item.path}
            onClick={() => navigate(item.path === '/' ? '/' : isActivePage(item.path) ? '/' : item.path)}
            className={`relative flex flex-col items-center justify-center flex-1 h-full transition-colors ${
              isActivePage(item.path) ? 'text-orange-500' : 'light:text-zinc-600 dark:text-zinc-400'
            }`}
          >
            <span className="mb-1 flex h-7 items-center">{item.icon}</span>
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
