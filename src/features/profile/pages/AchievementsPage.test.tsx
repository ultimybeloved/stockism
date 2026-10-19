// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import AchievementsPage from './AchievementsPage';

vi.mock('../../../context/AppContext', () => ({
  useSession: () => ({ userData: { achievements: ['SHARK'], displayedAchievementPins: ['SHARK'] } }),
}));

describe('AchievementsPage pin row', () => {
  it('asks before taking a pin off from the top row', () => {
    const onPinAction = vi.fn();
    render(<AchievementsPage onPinAction={onPinAction} />);
    fireEvent.click(screen.getByRole('button', { name: 'Shark' }));
    expect(onPinAction).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Take off Shark?' }));
    expect(onPinAction).toHaveBeenCalledWith('setAchievementPins', [], 0);
  });
});
