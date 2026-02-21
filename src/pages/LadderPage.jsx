import React from 'react';
import LadderGame from '../components/LadderGame';
import { useAppContext } from '../context/AppContext';

const LadderPage = () => {
  const { user, userData, darkMode } = useAppContext();

  return (
    <div style={{ background: '#d4c4a8', minHeight: 'calc(100vh - 4rem)' }}>
      <LadderGame
        user={user}
        userData={userData}
        darkMode={darkMode}
      />
    </div>
  );
};

export default LadderPage;
