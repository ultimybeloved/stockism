// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import SiteMessageBar from './SiteMessageBar';

// The bar renders on every page for every visitor, so the branch that matters
// most is the one where it renders nothing at all.
const mockContext = vi.fn();
vi.mock('../context/AppContext', () => ({
  useAppContext: () => mockContext(),
}));

const setup = (siteMessages, darkMode = false) => {
  mockContext.mockReturnValue({ siteMessages, darkMode });
  return render(<SiteMessageBar />);
};

const msg = (over = {}) => ({ id: 'a', text: 'Server maintenance tonight', tone: 'info', active: true, ...over });

describe('SiteMessageBar', () => {
  it('renders nothing when there are no messages', () => {
    const { container } = setup([]);
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing when the field is missing entirely', () => {
    const { container } = setup(undefined);
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing when every message is switched off', () => {
    const { container } = setup([msg({ active: false })]);
    expect(container.firstChild).toBeNull();
  });

  it('ignores an active message with only whitespace in it', () => {
    const { container } = setup([msg({ text: '   ' })]);
    expect(container.firstChild).toBeNull();
  });

  it('shows an active message', () => {
    setup([msg()]);
    expect(screen.getByText('Server maintenance tonight')).toBeTruthy();
  });

  it('leaves a single short message static rather than scrolling it', () => {
    const { container } = setup([msg()]);
    expect(container.querySelector('.site-message-scroll')).toBeNull();
  });

  it('scrolls once there is more than one message', () => {
    setup([msg(), msg({ id: 'b', text: 'Second thing' })]);
    expect(document.querySelector('.site-message-scroll')).not.toBeNull();
    // Twice on purpose: the run is duplicated so the loop has no visible seam.
    expect(screen.getAllByText('Second thing')).toHaveLength(2);
  });

  it('hides the loop duplicate from screen readers', () => {
    const { container } = setup([msg(), msg({ id: 'b', text: 'Second thing' })]);
    const copies = container.querySelectorAll('.site-message-scroll > span');
    expect(copies).toHaveLength(2);
    expect(copies[1].getAttribute('aria-hidden')).toBe('true');
  });

  it('scrolls a single message that is too long to sit still', () => {
    const { container } = setup([msg({ text: 'x'.repeat(120) })]);
    expect(container.querySelector('.site-message-scroll')).not.toBeNull();
  });

  it('renders a link when one is set', () => {
    setup([msg({ link: 'https://example.com' })]);
    const link = screen.getByRole('link', { name: 'Server maintenance tonight' });
    expect(link.getAttribute('href')).toBe('https://example.com');
    // Opens off-site, so it must not hand the opener over.
    expect(link.getAttribute('rel')).toContain('noopener');
  });

  it('takes its tone from the most severe message on screen', () => {
    // One urgent notice must not be softened by sitting beside two ordinary ones.
    const { container } = setup([
      msg({ id: 'a', tone: 'info' }),
      msg({ id: 'b', text: 'Trading suspended', tone: 'alert' }),
    ]);
    expect(container.firstChild.className).toMatch(/red/);
  });

  it('skips inactive messages while showing active ones', () => {
    setup([msg({ id: 'a', text: 'Live one' }), msg({ id: 'b', text: 'Hidden one', active: false })]);
    expect(screen.getByText('Live one')).toBeTruthy();
    expect(screen.queryByText('Hidden one')).toBeNull();
  });
});
