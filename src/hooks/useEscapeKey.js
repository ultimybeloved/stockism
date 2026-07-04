import { useEffect, useRef } from 'react';

// Global Escape handling for modals. Registrations form a stack in mount
// order, and Escape closes only the top-most open modal — so pressing Escape
// with Trade History open over the Portfolio modal closes Trade History,
// not both. One document listener total.
const stack = [];

const onKeyDown = (e) => {
  if (e.key !== 'Escape' || stack.length === 0) return;
  stack[stack.length - 1]();
};

export function useEscapeKey(onClose, enabled = true) {
  // Stable wrapper so re-renders don't reorder the stack; the ref keeps the
  // latest callback without re-registering.
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    if (!enabled) return undefined;
    const handler = () => closeRef.current?.();
    if (stack.length === 0) document.addEventListener('keydown', onKeyDown);
    stack.push(handler);
    return () => {
      const i = stack.lastIndexOf(handler);
      if (i !== -1) stack.splice(i, 1);
      if (stack.length === 0) document.removeEventListener('keydown', onKeyDown);
    };
  }, [enabled]);
}
