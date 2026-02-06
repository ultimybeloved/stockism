import React from 'react';
import { useNavigate } from 'react-router-dom';
import LadderGame from '../components/LadderGame';
import { useAppContext } from '../context/AppContext';

const LadderPage = () => {
  const navigate = useNavigate();
  const { user, userData } = useAppContext();

  const handleClose = () => {
    navigate('/');
  };

  return (
    <div className="min-h-[calc(100vh-4rem)] flex items-center justify-center p-4">
      <LadderGame
        user={user}
        userData={userData}
        onClose={handleClose}
      />
    </div>
  );
};

export default LadderPage;
