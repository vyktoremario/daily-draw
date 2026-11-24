import { ONCHAIN_RULES, formatAmount, ticketCost } from '@daily-draw/shared';
import { colors, fonts, minTouch, radii } from '@daily-draw/ui';

// Scaffold home screen for the on-chain game (R1). The real screens follow design/mockups (#12).
export default function Home() {
  const rules = ONCHAIN_RULES;
  const price = formatAmount(rules.ticketPrice, rules);
  const withFee = formatAmount(ticketCost(rules, 1).total, rules);
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
          Pick {rules.numberRange === 100 ? '00–99' : '000–999'} · Sales close {rules.cutoffTime}{' '}
          WAT · Draw {rules.drawTime} WAT · Winners share 65% of the pool
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
          Play for {withFee}
        </a>
      </section>
      <p style={{ color: colors.inkMuted, fontSize: 13, textAlign: 'center', margin: 0 }}>
        Testnet prototype: test USDC only. Play for fun, not for income.
      </p>
    </main>
  );
}
