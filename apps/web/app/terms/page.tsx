import { AppShell } from '../../components/AppShell';
import { Notice } from '../../components/ui';

// About this demo and its terms. The 18+ confirmation on /play links here (lib/consent.ts
// TERMS_PATH), and so does the demo notice on every page (components/DemoBanner.tsx).
export default function TermsPage() {
  return (
    <AppShell title="About this demo" back="/" hideNav>
      <Notice>
        <strong>Daily Draw is a portfolio project, not an operating lottery.</strong> It runs on a
        public test network with test USDC, which has no value. It takes no real money and pays no
        real prizes.
      </Notice>
      <ul style={{ margin: 0, paddingLeft: 20, display: 'flex', flexDirection: 'column', gap: 8 }}>
        <li>
          Everything works as it would for real: tickets, the daily draw with Chainlink VRF
          randomness, payouts, referrals. Only the money is pretend. Test USDC comes free from the
          faucet on the Wallet screen.
        </li>
        <li>You must be 18 or older to play, even with test money.</li>
        <li>The demo is not available in every country.</li>
        <li>
          Tickets are bought and prizes paid by the game contract on the test network. Transactions
          can&apos;t be reversed.
        </li>
        <li>
          The demo may be paused, reset or taken down at any time. Never send real funds or mainnet
          tokens to any address shown here.
        </li>
      </ul>
    </AppShell>
  );
}
