// @vitest-environment jsdom
// The board sends nameChangedAt: null for anyone who never renamed. A
// `typeof x === 'object'` check alone treats null as an object, and that
// crashed the whole leaderboard page on 2026-10-08.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import * as matchers from '@testing-library/jest-dom/matchers';
import { createRef } from 'react';
import LeaderboardRow from './LeaderboardRow';
import type { RankedLeader } from '../../hooks/useLeaderboard';
expect.extend(matchers);

vi.mock('../../context/AppContext', () => ({
  useAppContext: () => ({ darkMode: false, userData: null }),
}));

const DAY = 24 * 60 * 60 * 1000;
const leader = (extra: Partial<RankedLeader>) =>
  ({
    id: 'u1',
    userId: 'u1',
    rank: 7,
    crewRank: 1,
    displayName: 'Tester',
    portfolioValue: 1234,
    holdingsCount: 3,
    crew: null,
    ...extra,
  }) as RankedLeader;

const renderRow = (l: RankedLeader) =>
  render(
    <MemoryRouter>
      <LeaderboardRow
        leader={l}
        displayRank={7}
        isCurrentUser={false}
        userCrewColor={undefined}
        userRowRef={createRef<HTMLDivElement>()}
        sortBy="value"
      />
    </MemoryRouter>,
  );

describe('LeaderboardRow', () => {
  afterEach(cleanup);

  it('renders a player who never renamed (nameChangedAt null)', () => {
    renderRow(leader({ nameChangedAt: null, previousDisplayName: null }));
    expect(screen.getByText('Tester')).toBeInTheDocument();
  });

  it('shows "formerly" for a recent rename stored as a Timestamp', () => {
    const seconds = Math.floor((Date.now() - 2 * DAY) / 1000);
    renderRow(leader({ nameChangedAt: { _seconds: seconds }, previousDisplayName: 'OldName' }));
    expect(screen.getByText('formerly OldName')).toBeInTheDocument();
  });

  it('drops "formerly" once the rename is over 30 days old', () => {
    renderRow(leader({ nameChangedAt: Date.now() - 40 * DAY, previousDisplayName: 'OldName' }));
    expect(screen.queryByText('formerly OldName')).not.toBeInTheDocument();
  });
});
