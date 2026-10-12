// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import ErrorBoundary from './ErrorBoundary';

vi.mock('@sentry/react', () => ({ captureException: vi.fn() }));

let failWith: Error | null = null;
const Page = () => {
  if (failWith) throw failWith;
  return <p>page content</p>;
};

describe('ErrorBoundary', () => {
  afterEach(cleanup);
  beforeEach(() => {
    failWith = null;
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('shows the crash screen without the raw error, and Try again recovers', () => {
    failWith = new Error('Cannot read properties of undefined');
    render(
      <ErrorBoundary resetKey="/a">
        <Page />
      </ErrorBoundary>,
    );
    expect(screen.getByText('Something went wrong')).toBeTruthy();
    expect(screen.queryByText(/Cannot read properties/)).toBeNull();
    failWith = null;
    fireEvent.click(screen.getByText('Try again'));
    expect(screen.getByText('page content')).toBeTruthy();
  });

  it('clears the crash when the player moves to another page', () => {
    failWith = new Error('boom');
    const { rerender } = render(
      <ErrorBoundary resetKey="/a">
        <Page />
      </ErrorBoundary>,
    );
    failWith = null;
    rerender(
      <ErrorBoundary resetKey="/b">
        <Page />
      </ErrorBoundary>,
    );
    expect(screen.getByText('page content')).toBeTruthy();
  });

  it('tells a player on an old build to reload, with no Try again', () => {
    failWith = new TypeError('Failed to fetch dynamically imported module: /assets/StockPage-abc.js');
    render(
      <ErrorBoundary>
        <Page />
      </ErrorBoundary>,
    );
    expect(screen.getByText('Stockism was just updated')).toBeTruthy();
    expect(screen.getByText('Reload page')).toBeTruthy();
    expect(screen.queryByText('Try again')).toBeNull();
  });
});
