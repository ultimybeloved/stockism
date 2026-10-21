// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import * as matchers from '@testing-library/jest-dom/matchers';
import CrewPage from './CrewPage';
expect.extend(matchers);

vi.mock('../../../context/AppContext', () => ({
  useTheme: () => ({ darkMode: false }),
  useSession: () => ({ user: { uid: 'me' }, userData: { crew: 'ALLIED' } }),
  useMarket: () => ({
    prices: { ALLY: 80, BDNL: 120 },
    priceHistory: {},
    crewStats: {
      heads: { ALLIED: { uid: 'h1', displayName: 'Boss', portfolioValue: 9000, weeks: 3 } },
      memberCounts: { ALLIED: 42 },
      activeCounts: { ALLIED: 17 },
    },
  }),
}));

vi.mock('../hooks/useCrewPlayers', () => ({
  useCrewPlayers: () => ({
    loading: false,
    failed: false,
    players: [
      { id: 'h1', userId: 'h1', rank: 1, crewRank: 1, displayName: 'Boss', portfolioValue: 9000, crew: 'ALLIED' },
    ],
  }),
}));

const renderAt = (path: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/crew/:crewId" element={<CrewPage />} />
        <Route path="/leaderboard" element={<p>leaderboard</p>} />
      </Routes>
    </MemoryRouter>,
  );

describe('CrewPage', () => {
  afterEach(cleanup);

  it('shows the crew, its head and reign, players, and fund', () => {
    renderAt('/crew/ALLIED');
    expect(screen.getByRole('heading', { name: 'Allied' })).toBeInTheDocument();
    expect(screen.getByText('Your crew')).toBeInTheDocument();
    expect(screen.getByText(/42 players/)).toBeInTheDocument();
    expect(screen.getByText(/3 weeks running/)).toBeInTheDocument();
    expect(screen.getAllByText('Boss').length).toBeGreaterThan(0);
    expect(screen.getByText('Crew fund')).toBeInTheDocument();
    expect(screen.getByText('$ALLY')).toBeInTheDocument();
  });

  it('sends an unknown crew to the leaderboard', () => {
    renderAt('/crew/NOPE');
    expect(screen.getByText('leaderboard')).toBeInTheDocument();
  });
});
