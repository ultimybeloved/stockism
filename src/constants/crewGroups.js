// ============================================
// PORTFOLIO ANALYTICS GROUPINGS
// ============================================
// Display-only groupings for the analytics donut. Split out of
// PortfolioAnalytics.jsx when it hit its 400-line limit.
//
// ⚠️ THIS IS NOT THE CREW ROSTER. `src/crews.js` is the source of truth for
// which characters are in which crew, and this map does not match it:
//   - it invents groups that are not crews at all (First Gen, Kitae Alliance,
//     Jake Alliance, J High are ETF groupings, not CREWS entries)
//   - it is missing every character added since roughly early 2026, so they
//     silently fall through to 'Other'
//
// Deriving it from CREWS would fix the drift but would visibly regroup existing
// players' charts (Gun Park would move from "First Gen" to "Yamazaki", and
// James Lee would land in "Other"), so it is left alone until that call is made.
// Anything that needs real crew membership must read src/crews.js instead.

export const CREW_TICKER_MAP = {
  // Allied
  BDNL: 'Allied', LDNL: 'Allied', VSCO: 'Allied', ZACK: 'Allied',
  JAY: 'Allied', VIN: 'Allied', AHN: 'Allied',
  // Big Deal
  JAKE: 'Big Deal', SWRD: 'Big Deal', JSN: 'Big Deal', BRAD: 'Big Deal',
  LINE: 'Big Deal', SINU: 'Big Deal', LUAH: 'Big Deal',
  // First Gen
  DG: 'First Gen', JIN: 'First Gen', SHNG: 'First Gen', GAP: 'First Gen',
  GUN: 'First Gen', GOO: 'First Gen',
  // Workers
  WRKR: 'Workers', BANG: 'Workers', CAPG: 'Workers', NOMN: 'Workers',
  NEKO: 'Workers', DOOR: 'Workers', JINJ: 'Workers', DRMA: 'Workers',
  HYOT: 'Workers', OLDF: 'Workers', DOC: 'Workers', NO1: 'Workers',
  // Hostel
  ELI: 'Hostel', SLLY: 'Hostel', CHAE: 'Hostel', MAX: 'Hostel',
  DJO: 'Hostel', ZAMI: 'Hostel', RYAN: 'Hostel',
  // Secret Friends
  LOGN: 'Secret Friends', SAM: 'Secret Friends', ALEX: 'Secret Friends',
  SHMN: 'Secret Friends',
  // Yamazaki
  SHRO: 'Yamazaki', SHKO: 'Yamazaki', HIKO: 'Yamazaki', SOMI: 'Yamazaki',
  // WTJC
  SRMK: 'WTJC', SGUI: 'WTJC', YCHL: 'WTJC', SERA: 'WTJC',
  // Fist Gang (Charles Choi)
  ELIT: 'Fist Gang', JYNG: 'Fist Gang', TOM: 'Fist Gang', KWON: 'Fist Gang',
  DNCE: 'Fist Gang', GNTL: 'Fist Gang', MMA: 'Fist Gang', LIAR: 'Fist Gang', NOH: 'Fist Gang',
  // Kitae Alliance
  KTAE: 'Kitae Alliance', SAMC: 'Kitae Alliance', YONG: 'Kitae Alliance',
  PAJU: 'Kitae Alliance', PHNG: 'Kitae Alliance', CROW: 'Kitae Alliance', COP: 'Kitae Alliance',
  // Jake Alliance
  TM: 'Jake Alliance', GONG: 'Jake Alliance', SEOK: 'Jake Alliance',
  WOLF: 'Jake Alliance', JAEG: 'Jake Alliance', YEUL: 'Jake Alliance',
  BUCH: 'Jake Alliance', UJBU: 'Jake Alliance', DAEJ: 'Jake Alliance',
  // J High School
  CRYS: 'J High', DUKE: 'J High', DOO: 'J High', JACE: 'J High',
  MIRA: 'J High', ZOE: 'J High', JOY: 'J High', JIHO: 'J High', '2SEC': 'J High',
  // Solo / Other
  SOPH: 'Other', GDOG: 'Other', CROC: 'Other', YUJA: 'Other',
  '6KNG': 'Other', XIAO: 'Other', SNEK: 'Other', OLLY: 'Other',
  MOM: 'Other', HACK: 'Other', INCH: 'Other', MISS: 'Other',
  PYNG: 'Other', SNAM: 'Other', SHRK: 'Other', BUS3: 'Other',
  BEAD: 'Other', TWHK: 'Other', JMAL: 'Other', CLUB: 'Other',
  SUJN: 'Other', LAW: 'Other', CHCH: 'Other', BEOM: 'Other',
  MUAY: 'Other', RYU: 'Other',
};

export const CREW_COLORS = {
  'Allied': '#f97316',
  'Big Deal': '#3b82f6',
  'First Gen': '#eab308',
  'Workers': '#8b5cf6',
  'Hostel': '#ec4899',
  'Secret Friends': '#14b8a6',
  'Yamazaki': '#ef4444',
  'WTJC': '#6366f1',
  'Fist Gang': '#84cc16',
  'Kitae Alliance': '#f59e0b',
  'Jake Alliance': '#06b6d4',
  'J High': '#a855f7',
  'Other': '#6b7280',
  'ETF': '#d946ef',
};
