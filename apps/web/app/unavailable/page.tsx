import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Not available · Daily Draw',
  robots: { index: false },
};

/** Shown by proxy.ts to visitors from blocked countries (lib/geo.ts). No wallet, no game. */
export default function UnavailablePage() {
  return (
    <main
      style={{
        minHeight: '100dvh',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        gap: 12,
        maxWidth: 480,
        margin: '0 auto',
        padding: '0 16px',
      }}
    >
      <h1 className="page-title">Not available in your country</h1>
      <p className="muted" style={{ margin: 0 }}>
        Daily Draw can&apos;t be played from where you are. Sorry about that.
      </p>
    </main>
  );
}
