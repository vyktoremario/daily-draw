import { DEFAULT_RULES, formatNaira } from '@daily-draw/shared';
import { colors, fonts, minTouch, radii } from '@daily-draw/ui';

// Scaffold home screen. The real screens follow design/mockups (Home, Pick, Confirm, Results, Verify, Wallet).
export default function Home() {
  const price = formatNaira(DEFAULT_RULES.ticketPriceKobo);
  return (
    <main
      style={{
        maxWidth: 480,
        margin: '0 auto',
        padding: 20,
        display: 'flex',
        flexDirection: 'column',
        gap: 16,
      }}
    >
      <h1 style={{ fontFamily: fonts.display, fontSize: 24, margin: 0 }}>
        Daily<span style={{ color: colors.brand }}>Draw</span>
      </h1>
      <section
        style={{
          background: colors.night,
          color: '#FFFFFF',
          borderRadius: radii.xl,
          padding: 20,
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
        }}
      >
        <span style={{ color: colors.nightText, fontSize: 14 }}>Tonight&apos;s draw</span>
        <span style={{ fontFamily: fonts.display, fontSize: 40, fontWeight: 700 }}>
          {price} a ticket
        </span>
        <span style={{ color: colors.nightText, fontSize: 14 }}>
          Pick {DEFAULT_RULES.numberRange === 100 ? '00–99' : '000–999'} · Sales close{' '}
          {DEFAULT_RULES.cutoffTime} · Draw {DEFAULT_RULES.drawTime}
        </span>
        <a
          href="#play"
          style={{
            minHeight: minTouch + 12,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: radii.md,
            background: colors.gold,
            color: colors.ink,
            fontWeight: 700,
            textDecoration: 'none',
          }}
        >
          Play for {price}
        </a>
      </section>
      <p style={{ color: colors.inkMuted, fontSize: 13, textAlign: 'center', margin: 0 }}>
        Prototype — play money only. Play for fun, not for income.
      </p>
    </main>
  );
}
