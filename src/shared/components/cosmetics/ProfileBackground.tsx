import type { CSSProperties, ReactNode } from 'react';
import { COSMETIC_MAP } from '../../../constants/cosmetics';
import { DEFAULT_TICKER_COLORS } from '../../../constants/cosmeticsProfile';
import { COSMETIC_COLOR_STYLES, seedHash, type CosmeticStyle } from '../../../rules/cosmetics';

// The page behind a public profile, on a desktop (styles/cosmetics/profileBackgrounds.css).
// `preview` draws it inside its parent instead of behind the whole window,
// for the shop.

export interface ProfileBgData {
  /** Your Chart: the month's line, scaled 0 to 1 (rules/cosmetics chartShape). */
  chart?: number[];
  /** Ticker Wall: the three biggest holdings. */
  tickers?: string[];
}

interface Props {
  id: string | null | undefined;
  /** The wearer's name: seeds the skyline, the crowd and the banknote serial. */
  seedKey: string;
  style?: CosmeticStyle | null;
  data?: ProfileBgData | null;
  preview?: boolean;
}

const SAMPLE_CHART = [0.2, 0.25, 0.18, 0.3, 0.42, 0.38, 0.5, 0.47, 0.6, 0.55, 0.68, 0.72, 0.66, 0.8, 0.86, 0.82, 1];

/** A small seeded random source, so a player's skyline and crowd look the same on every visit. */
const seeded = (key: string) => {
  let s = seedHash(key) % 233280 || 1;
  return () => (s = (s * 9301 + 49297) % 233280) / 233280;
};

const hexMix = (a: string, b: string, t: number) => {
  const pa = parseInt(a.slice(1), 16);
  const pb = parseInt(b.slice(1), 16);
  const ch = (shift: number) => Math.round(((pa >> shift) & 255) * (1 - t) + ((pb >> shift) & 255) * t);
  return `rgb(${ch(16)} ${ch(8)} ${ch(0)})`;
};

const Chart = ({ points }: { points: number[] }) => {
  const line = points.map((v, i) => `${(i / (points.length - 1)) * 1200},${360 - v * 300}`).join(' ');
  return (
    <svg viewBox="0 0 1200 400" preserveAspectRatio="none" aria-hidden="true">
      <defs>
        <linearGradient id="pbg-area" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="#22c55e" stopOpacity=".2" />
          <stop offset="1" stopColor="#22c55e" stopOpacity="0" />
        </linearGradient>
        <filter id="pbg-glow" x="-5%" y="-50%" width="110%" height="200%">
          <feGaussianBlur stdDeviation="4" />
        </filter>
      </defs>
      {[50, 100, 150, 200, 250, 300, 350].map((y) => (
        <line
          key={y}
          x1="0"
          x2="1200"
          y1={y}
          y2={y}
          stroke="#fff"
          strokeOpacity=".04"
          vectorEffect="non-scaling-stroke"
        />
      ))}
      <polygon points={`0,400 ${line} 1200,400`} fill="url(#pbg-area)" />
      <polyline
        points={line}
        fill="none"
        stroke="#22c55e"
        strokeOpacity=".5"
        strokeWidth="2.5"
        vectorEffect="non-scaling-stroke"
      />
      <polyline
        className="pbg-runner"
        pathLength={1000}
        points={line}
        fill="none"
        stroke="#bbf7d0"
        strokeWidth="10"
        filter="url(#pbg-glow)"
        strokeLinecap="round"
      />
      <polyline
        className="pbg-runner"
        pathLength={1000}
        points={line}
        fill="none"
        stroke="#f0fdf4"
        strokeWidth="3"
        strokeLinecap="round"
      />
    </svg>
  );
};

const Tickers = ({ tickers, colors }: { tickers: string[]; colors: string }) => {
  const [top, bottom] = colors.split(',') as [string, string];
  const list = tickers.length ? tickers : ['STOCK'];
  return (
    <>
      {[70, 95, 120, 85, 110, 100].map((speed, i) => {
        const t = list[i % list.length]!;
        const text = Array(10).fill(t).join('   ');
        const ink = `color-mix(in srgb, ${hexMix(top, bottom, i / 5)} ${i % 3 === 0 ? 55 : 30}%, transparent)`;
        return (
          <div
            key={i}
            className={`pbg-trow ${i % 2 ? 'rev' : ''}`}
            style={{ top: `${2 + i * 17}%`, '--sp': `${speed}s`, '--ink': ink } as CSSProperties}
          >
            {text}
            {'   '}
            {text}
            {'   '}
          </div>
        );
      })}
    </>
  );
};

// Buildings as [start, width] fractions of a gutter, height in %, window columns.
const BUILDINGS: [number, number, number, number][] = [
  [0, 0.3, 34, 3],
  [0.3, 0.22, 52, 2],
  [0.52, 0.26, 28, 3],
  [0.78, 0.22, 44, 2],
];

const Skyline = ({ seedKey }: { seedKey: string }) => {
  const r = seeded(seedKey);
  const stars = Array.from({ length: 46 }, (_, k) => (
    <i
      key={k}
      className="pbg-star"
      style={
        {
          left: `${(r() * 100).toFixed(1)}%`,
          top: `${(r() * 48).toFixed(1)}%`,
          '--t': `${(5 + r() * 6).toFixed(1)}s`,
          '--d': `${(-r() * 8).toFixed(1)}s`,
          '--o': (0.3 + r() * 0.6).toFixed(2),
        } as CSSProperties
      }
    />
  ));
  const side = (right: boolean) =>
    BUILDINGS.map(([start, width, height, cols], b) => {
      const rows = Math.floor(height / 4.2);
      const left = right ? `calc(100cqw - var(--gut) * ${1 - start})` : `calc(var(--gut) * ${start})`;
      return (
        <div
          key={`${right}-${b}`}
          className="pbg-bld"
          style={{ left, width: `calc(var(--gut) * ${width})`, height: `${height}%`, '--cols': cols } as CSSProperties}
        >
          {Array.from({ length: rows * cols }, (_, k) => {
            const v = r();
            if (v < 0.35) return <i key={k} className="pbg-lit on" />;
            if (v < 0.5)
              return (
                <i
                  key={k}
                  className="pbg-lit blink"
                  style={
                    { '--t': `${(8 + r() * 10).toFixed(1)}s`, '--d': `${(-r() * 12).toFixed(1)}s` } as CSSProperties
                  }
                />
              );
            return <i key={k} className="pbg-lit" />;
          })}
        </div>
      );
    });
  return (
    <>
      <i className="pbg-moon" style={{ transform: 'translateX(-50%)' }} />
      {stars}
      {side(false)}
      {side(true)}
    </>
  );
};

const Banknote = ({ seedKey }: { seedKey: string }) => {
  const h = seedHash(seedKey);
  const serial = `SK ${String(h % 10000).padStart(4, '0')} ${String((h >>> 14) % 10000).padStart(4, '0')} ${'ABCDEFGHJK'[h % 10]}`;
  const micro = 'STOCKISM RESERVE NOTE '.repeat(6);
  return (
    <>
      <i className="waves" />
      <i className="frame" style={{ left: 'calc(var(--gut) / 2)' }} />
      <i className="frame" style={{ left: 'calc(100cqw - var(--gut) / 2)' }} />
      <i className="thread" />
      <i className="ros gl" />
      <i className="seal gr" />
      <i className="holo" />
      <span className="denom" style={{ left: 'calc(var(--gut) * 0.16)', top: '10%' }}>
        100
      </span>
      <span className="denom" style={{ right: 'calc(var(--gut) * 0.2)', bottom: '10%' }}>
        100
      </span>
      <span className="serial" style={{ left: 'calc(var(--gut) * 0.18)', bottom: '11%' }}>
        {serial}
      </span>
      <span className="serial" style={{ right: 'calc(var(--gut) * 0.2)', top: '11%' }}>
        {serial}
      </span>
      <span className="micro" style={{ left: 'calc(var(--gut) * 0.09)', top: '2.5%' }}>
        {micro}
      </span>
      <span className="micro" style={{ right: 'calc(var(--gut) * 0.2)', bottom: '2.5%' }}>
        {micro}
      </span>
    </>
  );
};

const Fight = ({ seedKey }: { seedKey: string }) => {
  const r = seeded(seedKey);
  return (
    <>
      <i className="haze" />
      <i className="beam b1" />
      <i className="beam b2" />
      <i className="post" style={{ left: 'calc(var(--gut) * 0.12)' }} />
      <i className="post" style={{ left: 'calc(100cqw - var(--gut) * 0.12)' }} />
      <i className="rope r1" />
      <i className="rope r2" />
      <i className="rope r3" />
      {Array.from({ length: 8 }, (_, k) => {
        const f = 0.1 + r() * 0.8;
        const left = k % 2 ? `calc(100cqw - var(--gut) * ${f})` : `calc(var(--gut) * ${f})`;
        return (
          <i
            key={k}
            className="flash"
            style={
              {
                left,
                top: `${(84 + r() * 12).toFixed(1)}%`,
                '--t': `${(5 + r() * 6).toFixed(1)}s`,
                '--d': `${(-r() * 9).toFixed(1)}s`,
              } as CSSProperties
            }
          />
        );
      })}
    </>
  );
};

const ProfileBackground = ({ id, seedKey, style, data, preview = false }: Props) => {
  const c = id ? COSMETIC_MAP[id] : undefined;
  if (!c || c.type !== 'profileBg') return null;
  const tickerColors =
    style?.tickerColors && COSMETIC_COLOR_STYLES.tickerColors.test(style.tickerColors)
      ? style.tickerColors
      : DEFAULT_TICKER_COLORS;

  let kind: string;
  let art: ReactNode = null;
  let vars: CSSProperties | undefined;
  if (c.variantOf === 'bg_wash') {
    kind = 'wash';
    vars = { '--w1': c.colors?.[0], '--w2': c.colors?.[1] } as CSSProperties;
  } else if (c.id === 'bg_chart') {
    kind = 'chart';
    art = <Chart points={data?.chart?.length ? data.chart : SAMPLE_CHART} />;
  } else if (c.id === 'bg_tickers') {
    kind = 'tickers';
    art = <Tickers tickers={data?.tickers || []} colors={tickerColors} />;
  } else if (c.id === 'bg_skyline') {
    kind = 'skyline';
    art = <Skyline seedKey={seedKey} />;
  } else if (c.id === 'bg_banknote') {
    kind = 'note';
    art = <Banknote seedKey={seedKey} />;
  } else if (c.id === 'bg_fight') {
    kind = 'fight';
    art = <Fight seedKey={seedKey} />;
  } else return null;

  return (
    <div className={`pbg pbg-${kind}${preview ? ' pbg-preview' : ''}`} style={vars} aria-hidden="true">
      <div className="pbg-in">{art}</div>
    </div>
  );
};

export default ProfileBackground;
