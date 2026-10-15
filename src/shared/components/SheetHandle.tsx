// The grab bar at the top of a bottom sheet. Phones only; drag down to close.
const SheetHandle = () => (
  <div className="md:hidden flex justify-center -mt-2 mb-2" aria-hidden="true">
    <span className="w-10 h-1 rounded-full light:bg-zinc-300 dark:bg-zinc-600" />
  </div>
);

export default SheetHandle;
