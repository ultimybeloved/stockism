import PixelIcon from '../../../shared/components/PixelIcon';

// Which folder under public/pins each admin icon lives in: the site's own set
// (ui), the bot's (discord), the admin set drawn by scripts/pixel-admin.cjs,
// or the crew-head mark (crests).
const SETS = {
  announce: 'ui',
  book: 'ui',
  cash: 'ui',
  crews: 'ui',
  error: 'ui',
  hourglass: 'ui',
  lock: 'ui',
  missions: 'ui',
  pause: 'ui',
  pencil: 'ui',
  profile: 'ui',
  reroll: 'ui',
  rocket: 'ui',
  season: 'ui',
  success: 'ui',
  trade: 'ui',
  trophy: 'ui',
  warning: 'ui',
  bolt: 'discord',
  chart: 'discord',
  chart_down: 'discord',
  dice: 'discord',
  dot_red: 'discord',
  dot_yellow: 'discord',
  fire: 'discord',
  gift: 'discord',
  hammer: 'discord',
  inspect: 'discord',
  link: 'discord',
  todo: 'discord',
  bankrupt: 'admin',
  blocked: 'admin',
  broom: 'admin',
  bulb: 'admin',
  chat: 'admin',
  eye: 'admin',
  gear: 'admin',
  globe: 'admin',
  mappin: 'admin',
  nametag: 'admin',
  plus: 'admin',
  robot: 'admin',
  save: 'admin',
  scissors: 'admin',
  trash: 'admin',
  crew_head: 'crests',
} as const;

export type AdminIconName = keyof typeof SETS;

// A pixel icon in admin headings, buttons and lists, where the panel used to
// show an emoji. Sized and spaced to sit before a line of text.
const AdminIcon = ({
  name,
  className = 'w-4 h-4 mr-1.5 align-[-3px]',
}: {
  name: AdminIconName;
  className?: string;
}) => <PixelIcon name={name} set={SETS[name]} className={className} />;

export default AdminIcon;
