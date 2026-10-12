import { useCallback, useRef } from 'react';

// Keyboard and screen-reader basics for a modal. Attach the returned ref to the
// modal's box (the element inside the dark overlay):
//
//   const dialogRef = useModalFocus();
//   <div ref={dialogRef} className={modalShellClass}>
//
// While it is open:
// - it is announced as a dialog, named by its first heading;
// - focus moves into it, and Tab / Shift+Tab cycle inside it rather than
//   wandering into the page behind;
// - when it closes, focus goes back to whatever opened it.
//
// A callback ref rather than an effect, so it also works for modals that stay
// mounted and only render their box while open. Nested modals stack: only the
// top one traps Tab, the same way useEscapeKey only closes the top one.
// Escape is NOT handled here; modals keep calling useEscapeKey.

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

const stack: HTMLElement[] = [];
let nextId = 0;

const focusables = (root: HTMLElement) =>
  [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.getClientRects().length > 0);

const onKeyDown = (e: KeyboardEvent) => {
  if (e.key !== 'Tab' || stack.length === 0) return;
  const dialog = stack[stack.length - 1]!;
  const items = focusables(dialog);
  const active = document.activeElement as HTMLElement | null;
  if (items.length === 0) {
    e.preventDefault();
    dialog.focus();
    return;
  }
  const first = items[0]!;
  const last = items[items.length - 1]!;
  if (!active || !dialog.contains(active)) {
    e.preventDefault();
    (e.shiftKey ? last : first).focus();
  } else if (e.shiftKey && (active === first || active === dialog)) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && active === last) {
    e.preventDefault();
    first.focus();
  }
};

export function useModalFocus<T extends HTMLElement = HTMLDivElement>() {
  const cleanup = useRef<(() => void) | null>(null);

  return useCallback((el: T | null) => {
    cleanup.current?.();
    cleanup.current = null;
    if (!el) return;

    const opener = document.activeElement as HTMLElement | null;
    if (!el.getAttribute('role')) el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'true');
    if (!el.hasAttribute('aria-label') && !el.hasAttribute('aria-labelledby')) {
      const heading = el.querySelector<HTMLElement>('h1, h2, h3');
      if (heading) {
        if (!heading.id) heading.id = `dialog-title-${++nextId}`;
        el.setAttribute('aria-labelledby', heading.id);
      }
    }
    // The box itself takes focus (not the first field), so opening a modal on
    // a phone never pops the keyboard up uninvited.
    if (!el.hasAttribute('tabindex')) el.tabIndex = -1;
    if (!el.contains(document.activeElement)) el.focus({ preventScroll: true });

    if (stack.length === 0) document.addEventListener('keydown', onKeyDown);
    stack.push(el);

    cleanup.current = () => {
      const i = stack.lastIndexOf(el);
      if (i !== -1) stack.splice(i, 1);
      if (stack.length === 0) document.removeEventListener('keydown', onKeyDown);
      if (opener && opener !== document.body && document.contains(opener)) opener.focus({ preventScroll: true });
    };
  }, []);
}
