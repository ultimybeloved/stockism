// Site-wide keyboard shortcuts and the two windows they open: quick search
// (Ctrl+K) and the shortcut list (?). The desktop header's Search button opens
// quick search by sending OPEN_SEARCH_EVENT.
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSession } from '../../../context/AppContext';
import { useShortcuts } from '../../hooks/useShortcuts';
import CommandPalette from './CommandPalette';
import ShortcutHelp from './ShortcutHelp';

export const OPEN_SEARCH_EVENT = 'stockism:open-search';

const GlobalShortcuts = () => {
  const navigate = useNavigate();
  const { user } = useSession();
  const [open, setOpen] = useState<'search' | 'help' | null>(null);

  useEffect(() => {
    const show = () => setOpen('search');
    window.addEventListener(OPEN_SEARCH_EVENT, show);
    return () => window.removeEventListener(OPEN_SEARCH_EVENT, show);
  }, []);

  useShortcuts({
    'mod+k': () => setOpen((o) => (o === 'search' ? null : 'search')),
    '?': () => setOpen('help'),
    p: () => user && navigate('/portfolio'),
    m: () => navigate('/'),
  });

  if (open === 'search') return <CommandPalette onClose={() => setOpen(null)} />;
  if (open === 'help') return <ShortcutHelp onClose={() => setOpen(null)} />;
  return null;
};

export default GlobalShortcuts;
