import React from 'react';
import LadderGame from '../components/LadderGame';

const LadderPage = () => {
  return (
    <div style={{ background: '#d4c4a8', minHeight: 'calc(100vh - 4rem)' }}>
      <LadderGame />
    </div>
  );
};

export default LadderPage;
