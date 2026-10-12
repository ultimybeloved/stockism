// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/react';
import { useState } from 'react';
import { useModalFocus } from './useModalFocus';

// jsdom has no layout, so every element reports no client rects; treat all as visible.
Object.defineProperty(HTMLElement.prototype, 'getClientRects', {
  configurable: true,
  value: () => [{}],
});

const Modal = ({ onClose }: { onClose: () => void }) => {
  const ref = useModalFocus();
  return (
    <div ref={ref} data-testid="dialog">
      <h2>Buy shares</h2>
      <button>First</button>
      <button onClick={onClose}>Last</button>
    </div>
  );
};

const Page = () => {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)}>Open</button>
      {open && <Modal onClose={() => setOpen(false)} />}
    </>
  );
};

describe('useModalFocus', () => {
  afterEach(cleanup);

  it('announces a named dialog and moves focus into it', () => {
    const { getByText, getByTestId } = render(<Page />);
    getByText('Open').focus();
    fireEvent.click(getByText('Open'));
    const dialog = getByTestId('dialog');
    expect(dialog.getAttribute('role')).toBe('dialog');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(document.getElementById(dialog.getAttribute('aria-labelledby')!)?.textContent).toBe('Buy shares');
    expect(document.activeElement).toBe(dialog);
  });

  it('keeps Tab inside the dialog, both ways', () => {
    const { getByText } = render(<Page />);
    fireEvent.click(getByText('Open'));
    getByText('Last').focus();
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(document.activeElement).toBe(getByText('First'));
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(getByText('Last'));
  });

  it('gives focus back to the button that opened it', () => {
    const { getByText } = render(<Page />);
    const opener = getByText('Open');
    opener.focus();
    fireEvent.click(opener);
    fireEvent.click(getByText('Last'));
    expect(document.activeElement).toBe(opener);
  });
});
