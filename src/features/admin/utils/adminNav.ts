// Panel-wide navigation: lets any screen open a player's file or jump to a
// section without threading callbacks through every tab. AdminPanel provides
// it; PlayerLink and the screens read it with useAdminNav().
import { createContext, useContext } from 'react';

export interface AdminNav {
  /** Open a player's file (switches to the Players section). */
  openPlayer: (uid: string) => void;
  /** Switch section. */
  goTo: (section: string) => void;
  /** Display name for a uid, from the loaded player list (null if not loaded). */
  nameOf: (uid: string) => string | null;
}

export const AdminNavContext = createContext<AdminNav>({
  openPlayer: () => {},
  goTo: () => {},
  nameOf: () => null,
});

export const useAdminNav = () => useContext(AdminNavContext);
