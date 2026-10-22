// Moves Date by EMULATOR_CLOCK_SHIFT_MS. Loaded by the suites and preloaded
// into the seed script so both keep the same clock. See leaveWeeklyHalt in
// harness.ts.
const shift = Number(process.env.EMULATOR_CLOCK_SHIFT_MS) || 0;
if (shift) {
  const RealDate = Date;
  const realNow = RealDate.now.bind(RealDate);
  globalThis.Date = class extends RealDate {
    constructor(...args) {
      if (args.length) super(...args);
      else super(realNow() + shift);
    }
    static now() {
      return realNow() + shift;
    }
  };
}
