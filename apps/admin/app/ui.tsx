import type { ReactNode } from 'react';
import type { Level } from '../lib/figures';
import { shortAddress } from '../lib/format';

export function Section({
  title,
  note,
  children,
}: {
  title: string;
  note?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="section">
      <header className="section-head">
        <h2>{title}</h2>
        {note ? <span className="muted small">{note}</span> : null}
      </header>
      {children}
    </section>
  );
}

export function Stats({ children }: { children: ReactNode }) {
  return <div className="stats">{children}</div>;
}

export function Stat({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  tone?: Level;
}) {
  return (
    <div className={`stat${tone ? ` tone-${tone}` : ''}`}>
      <div className="muted small">{label}</div>
      <div className="stat-value">{value}</div>
      {hint ? <div className="muted small">{hint}</div> : null}
    </div>
  );
}

export function Badge({ level, children }: { level: Level | 'neutral'; children: ReactNode }) {
  return <span className={`badge badge-${level}`}>{children}</span>;
}

export function Addr({ address, explorer }: { address: string; explorer: string | null }) {
  const text = <code title={address}>{shortAddress(address)}</code>;
  return explorer ? (
    <a href={`${explorer}/address/${address}`} target="_blank" rel="noreferrer">
      {text}
    </a>
  ) : (
    text
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="muted">{children}</p>;
}
