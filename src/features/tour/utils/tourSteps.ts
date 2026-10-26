// The guided tour's boxes, in order. `target` is the `data-tour` value of the
// part of the page each box lights up; a step without one shows its box in
// the middle of the screen. Phones and computers can mark different elements
// with the same value (the phone summary bar and the desktop card, say): the
// tour lights up whichever one is on screen.
import { marketTimes } from '../../../utils/localTime';

/** The stock the tour opens to show a stock page: the main character. */
export const TOUR_TICKER = 'BDNL';

export interface TourStep {
  id: string;
  /** The page the step is on. */
  route: string;
  target?: string;
  /** Left out when its target isn't on the page (cards that only show sometimes). */
  optional?: boolean;
  icon: string;
  title: string;
  body: () => string;
}

export const TOUR_STEPS: TourStep[] = [
  {
    id: 'welcome',
    route: '/',
    icon: 'stockism',
    title: 'Welcome to Stockism',
    body: () =>
      'Trade Lookism characters like stocks. Prices move when players buy and sell. This tour shows you around and takes about a minute.',
  },
  {
    id: 'money',
    route: '/',
    target: 'money',
    icon: 'cash',
    title: 'Your money',
    body: () =>
      "Portfolio value is everything you own. Cash is what you can spend right now. You start with $1,000, and it goes up to $3,000 when you link Discord. It's all fake money.",
  },
  {
    id: 'checkin',
    route: '/',
    target: 'checkin',
    optional: true,
    icon: 'success',
    title: 'Daily check-in',
    body: () => 'Check in once a day for free cash. Come back the next day to build a streak and earn more.',
  },
  {
    id: 'welcome-week',
    route: '/',
    target: 'welcome-week',
    optional: true,
    icon: 'announce',
    title: 'Welcome week',
    body: () => 'Run /welcome in the Stockism Discord once a day for a week to collect $7,000 more.',
  },
  {
    id: 'card',
    route: '/',
    target: 'card',
    icon: 'trade',
    title: 'Every character is a stock',
    body: () =>
      "A card shows a character's price and how it moved today. Open a card to see its page, or trade straight from the card.",
  },
  {
    id: 'browse',
    route: '/',
    target: 'browse',
    icon: 'book',
    title: 'Find a stock',
    body: () =>
      'Switch between characters, ETFs, and your watchlist. An ETF holds a whole crew in one stock. Filters and sorting help you find what you want.',
  },
  {
    id: 'chart',
    route: `/stock/${TOUR_TICKER}`,
    target: 'chart',
    icon: 'trade',
    title: "A stock's page",
    body: () =>
      'This is Big Daniel. The chart shows his price over time. Pick a time range above the chart to zoom in or out.',
  },
  {
    id: 'trade',
    route: `/stock/${TOUR_TICKER}`,
    target: 'trade',
    icon: 'cash',
    title: 'Buy and sell',
    body: () =>
      'Buy if you think the price will go up, then sell to take your profit. Short if you think it will drop. Bigger orders move the price more.',
  },
  {
    id: 'dividends',
    route: `/stock/${TOUR_TICKER}`,
    target: 'stock-stats',
    icon: 'dividend',
    title: 'Dividends',
    body: () =>
      'Many stocks pay you a dividend every week just for holding them. The longer you hold, the more they pay.',
  },
  {
    id: 'missions',
    route: '/missions',
    target: 'week',
    icon: 'missions',
    title: 'Missions',
    body: () => 'You get three new missions every day, plus weekly ones. They all pay cash.',
  },
  {
    id: 'rivalry',
    route: '/missions',
    target: 'rivalry',
    icon: 'crews',
    title: 'Crew rivalry',
    body: () =>
      'Join a crew and face another one every week. Members who finish 5 missions get paid, and more if the crew wins. Smaller crews earn bigger rewards.',
  },
  {
    id: 'portfolio',
    route: '/portfolio',
    target: 'portfolio',
    icon: 'cash',
    title: 'Your portfolio',
    body: () =>
      'Everything you own is here, with what you paid and your profit or loss. Your trade history is here too.',
  },
  {
    id: 'halt',
    route: '/',
    target: 'ticker',
    icon: 'pause',
    title: 'Thursday halt',
    body: () => {
      const t = marketTimes();
      return `Every week the market closes (${t.halt}) while the new chapter gets priced in. Near the end (${t.preMarket}) you can queue orders. They all fill together when the market reopens.`;
    },
  },
  {
    id: 'nav',
    route: '/',
    target: 'nav',
    icon: 'trophy',
    title: 'More to play',
    body: () => 'Climb the Leaderboard, bet on the story in Predictions, and try your luck in the Ladder game.',
  },
  {
    id: 'account',
    route: '/',
    target: 'account',
    icon: 'profile',
    title: 'Your account',
    body: () => 'Your profile, achievements, and crew are in this menu. You can replay this tour from here any time.',
  },
  {
    id: 'done',
    route: '/',
    icon: 'rocket',
    title: "You're ready",
    body: () => 'Pick a character you believe in and make your first trade. Good luck out there.',
  },
];
