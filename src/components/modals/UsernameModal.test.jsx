// @vitest-environment jsdom
// Covers the live username availability check at signup. The debounce and the
// stale-response guard are both easy to break without anything visibly failing,
// so they're asserted directly here.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react';
import * as matchers from '@testing-library/jest-dom/matchers';

expect.extend(matchers);

const h = vi.hoisted(() => ({
  checkUsername: vi.fn(),
  createUser: vi.fn(),
}));

vi.mock('../../firebase', () => ({
  checkUsernameFunction: h.checkUsername,
  createUserFunction: h.createUser,
}));

import UsernameModal from './UsernameModal';

const DEBOUNCE = 600;
const type = (value) => fireEvent.change(screen.getByPlaceholderText('Enter a username...'), { target: { value } });
const advance = async (ms) => { await act(async () => { vi.advanceTimersByTime(ms); }); };

beforeEach(() => {
  vi.useFakeTimers();
  h.checkUsername.mockReset();
  h.createUser.mockReset();
  h.checkUsername.mockResolvedValue({ data: { available: true } });
  h.createUser.mockResolvedValue({ data: { success: true } });
});

afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('UsernameModal availability check', () => {
  it('does not call the server until typing settles', async () => {
    render(<UsernameModal onComplete={() => {}} darkMode={false} />);

    type('cool');
    type('coolname');
    await advance(DEBOUNCE - 100);
    expect(h.checkUsername).not.toHaveBeenCalled();

    await advance(200);
    expect(h.checkUsername).toHaveBeenCalledTimes(1);
    expect(h.checkUsername).toHaveBeenCalledWith({ displayName: 'coolname' });
  });

  it('reports a free name', async () => {
    render(<UsernameModal onComplete={() => {}} darkMode={false} />);
    type('freename');
    await advance(DEBOUNCE);
    expect(screen.getByText(/that name is free/i)).toBeInTheDocument();
  });

  it('reports a taken name and blocks submit', async () => {
    h.checkUsername.mockResolvedValue({ data: { available: false, reason: 'Username taken' } });
    render(<UsernameModal onComplete={() => {}} darkMode={false} />);

    type('takenname');
    await advance(DEBOUNCE);
    expect(screen.getByText(/that name is taken/i)).toBeInTheDocument();

    const submit = screen.getByRole('button', { name: /start trading/i });
    expect(submit).toBeDisabled();
    fireEvent.click(submit);
    expect(h.createUser).not.toHaveBeenCalled();
  });

  it('never asks the server about a name the local rules already reject', async () => {
    render(<UsernameModal onComplete={() => {}} darkMode={false} />);
    type('ab'); // too short
    await advance(DEBOUNCE * 2);
    expect(h.checkUsername).not.toHaveBeenCalled();
  });

  it('ignores a slow answer for a name the user already changed', async () => {
    // First name resolves only after the second one has been typed. Without the
    // stale guard its "taken" would land on top of the newer name's result.
    let resolveFirst;
    h.checkUsername.mockImplementationOnce(() => new Promise((r) => { resolveFirst = r; }));
    render(<UsernameModal onComplete={() => {}} darkMode={false} />);

    type('firstname');
    await advance(DEBOUNCE);

    type('secondname');
    await advance(DEBOUNCE);

    await act(async () => { resolveFirst({ data: { available: false } }); });

    expect(screen.getByText(/that name is free/i)).toBeInTheDocument();
    expect(screen.queryByText(/that name is taken/i)).not.toBeInTheDocument();
  });

  it('stays silent when the check itself fails', async () => {
    h.checkUsername.mockRejectedValue(new Error('offline'));
    render(<UsernameModal onComplete={() => {}} darkMode={false} />);

    type('somename');
    await advance(DEBOUNCE);

    expect(screen.queryByText(/that name is/i)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /start trading/i })).not.toBeDisabled();
  });
});
