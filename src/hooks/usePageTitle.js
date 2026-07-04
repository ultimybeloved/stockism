import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';

const BASE_TITLE = 'Stockism - Lookism Character Exchange';

const PAGE_NAMES = {
  '/leaderboard': 'Leaderboard',
  '/predictions': 'Predictions',
  '/ladder': 'Ladder',
  '/achievements': 'Achievements',
  '/profile': 'Profile',
};

// Sets the browser-tab title per route so bookmarks, history, and search
// results say which page they point at instead of one generic title.
export function usePageTitle() {
  const { pathname } = useLocation();

  useEffect(() => {
    let page = '';
    if (pathname.startsWith('/stock/')) {
      const ticker = pathname.split('/')[2];
      if (ticker) page = '$' + ticker.toUpperCase();
    } else if (pathname.startsWith('/u/')) {
      page = decodeURIComponent(pathname.split('/')[2] || '');
    } else {
      page = PAGE_NAMES[pathname] || '';
    }
    document.title = page ? `${page} · Stockism` : BASE_TITLE;
  }, [pathname]);
}
