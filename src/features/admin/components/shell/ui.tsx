// Small building blocks for the admin command panel's terminal screens.
import type { ReactNode } from 'react';
import { useAdminNav } from '../../utils/adminNav';
import { t } from './terminal';

/** A bordered panel with an optional uppercase title row. */
export const Panel = ({
  title,
  right,
  children,
  className = '',
  pad = true,
}: {
  title?: ReactNode;
  right?: ReactNode;
  children: ReactNode;
  className?: string;
  pad?: boolean;
}) => (
  <section className={`${t.panel} ${className}`}>
    {(title || right) && (
      <div className="flex items-center justify-between gap-3 px-3 py-2 border-b border-[var(--t-line)]">
        <h3 className={t.head}>{title}</h3>
        {right && <div className="flex items-center gap-2">{right}</div>}
      </div>
    )}
    <div className={pad ? 'p-3' : ''}>{children}</div>
  </section>
);

/** One labelled figure. */
export const Stat = ({
  label,
  value,
  sub,
  tone = t.text,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  tone?: string;
}) => (
  <div className="min-w-0">
    <div className={t.label}>{label}</div>
    <div className={`${t.num} text-lg leading-tight ${tone} truncate`}>{value}</div>
    {sub != null && <div className={`${t.num} text-[11px] ${t.muted} truncate`}>{sub}</div>}
  </div>
);

/** A status light. */
export const Light = ({ tone, live = false }: { tone: 'green' | 'red' | 'amber' | 'dim'; live?: boolean }) => {
  const color = { green: 'var(--t-green)', red: 'var(--t-red)', amber: 'var(--t-amber)', dim: 'var(--t-dim)' }[tone];
  return (
    <span
      aria-hidden="true"
      className={`inline-block w-2 h-2 shrink-0 ${live ? 't-live' : ''}`}
      style={{ background: color, boxShadow: tone === 'dim' ? 'none' : `0 0 6px ${color}` }}
    />
  );
};

/** A small tag, e.g. BANNED, LINKED. */
export const Tag = ({
  children,
  tone = 'dim',
}: {
  children: ReactNode;
  tone?: 'green' | 'red' | 'amber' | 'cyan' | 'violet' | 'dim';
}) => {
  const color = {
    green: 'var(--t-green)',
    red: 'var(--t-red)',
    amber: 'var(--t-amber)',
    cyan: 'var(--t-cyan)',
    violet: 'var(--t-violet)',
    dim: 'var(--t-muted)',
  }[tone];
  return (
    <span
      className="t-mono text-[9px] uppercase tracking-wider px-1 py-px border whitespace-nowrap"
      style={{ color, borderColor: color }}
    >
      {children}
    </span>
  );
};

/** A player's name that opens their file when clicked. */
export const PlayerLink = ({
  uid,
  name,
  className = '',
}: {
  uid?: string | null;
  name?: string | null;
  className?: string;
}) => {
  const nav = useAdminNav();
  if (!uid) return <span className={className}>{name || '-'}</span>;
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        nav.openPlayer(uid);
      }}
      className={`text-left hover:text-[var(--t-green)] hover:underline underline-offset-2 ${className}`}
      title="Open player file"
    >
      {name || nav.nameOf(uid) || uid.slice(0, 8)}
    </button>
  );
};

/** Empty and loading states. */
export const Empty = ({ children }: { children: ReactNode }) => (
  <div className={`t-mono text-xs ${t.dim} py-6 text-center`}>{children}</div>
);

/** A sub-tab strip inside a screen. */
export const SubTabs = ({
  tabs,
  active,
  onChange,
}: {
  tabs: { id: string; label: string; count?: number }[];
  active: string;
  onChange: (id: string) => void;
}) => (
  <div className="flex gap-0 border-b border-[var(--t-line)]">
    {tabs.map((tab) => (
      <button
        key={tab.id}
        type="button"
        onClick={() => onChange(tab.id)}
        className={`t-mono text-[11px] uppercase tracking-wider px-3 py-2 border-b-2 -mb-px ${
          active === tab.id
            ? 'border-[var(--t-green)] text-[var(--t-green)]'
            : 'border-transparent text-[var(--t-muted)] hover:text-[var(--t-text)]'
        }`}
      >
        {tab.label}
        {tab.count != null && <span className="ml-1.5 text-[var(--t-dim)]">{tab.count}</span>}
      </button>
    ))}
  </div>
);
