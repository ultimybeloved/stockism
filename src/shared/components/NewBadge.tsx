// A small tilted NEW! sticker on the corner of a button. The button needs
// `relative`. Purely decoration: the button's own label says what it is.
const NewBadge = ({ className = '-top-2 -right-2' }: { className?: string }) => (
  <span
    aria-hidden="true"
    className={`new-badge absolute ${className} z-10 px-1 py-px text-[9px] font-black leading-none tracking-wide text-white bg-orange-500 border border-orange-300 rounded-sm shadow-md pointer-events-none`}
  >
    NEW!
  </span>
);

export default NewBadge;
