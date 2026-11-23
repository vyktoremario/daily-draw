import { colors } from '@daily-draw/ui';

const sections = [
  ['Dashboard', "Today's sales, pool, entries per number, wallet totals (N-50)"],
  ['Withdrawals', 'Review queue for first and large withdrawals (N-51)'],
  ['Players', 'Lookup, freeze, dispute notes (N-52)'],
  ['Settings', 'Game rule changes for future draws, two-person approval (N-53)'],
  ['Reports', 'Regulator exports (N-54)'],
] as const;

export default function AdminHome() {
  return (
    <main style={{ maxWidth: 960, margin: '0 auto', padding: 32 }}>
      <h1 style={{ marginTop: 0 }}>Daily Draw — Admin</h1>
      <p style={{ color: colors.inkMuted }}>
        Scaffold. Every action here will be written to the audit log.
      </p>
      <ul style={{ display: 'grid', gap: 12, padding: 0, listStyle: 'none' }}>
        {sections.map(([name, detail]) => (
          <li
            key={name}
            style={{
              background: colors.surface,
              border: `1px solid ${colors.border}`,
              borderRadius: 12,
              padding: 16,
            }}
          >
            <strong>{name}</strong>
            <div style={{ color: colors.inkMuted, fontSize: 14, marginTop: 4 }}>{detail}</div>
          </li>
        ))}
      </ul>
    </main>
  );
}
