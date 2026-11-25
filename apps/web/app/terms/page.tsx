import { AppShell } from '../../components/AppShell';
import { Notice } from '../../components/ui';

// PLACEHOLDER (issue #33): the real terms come from the lawyer before mainnet. The 18+
// confirmation on /play links here (lib/consent.ts TERMS_PATH).
export default function TermsPage() {
  return (
    <AppShell title="Terms" back="/" hideNav>
      <Notice tone="warn">These terms are a placeholder and will be replaced before launch.</Notice>
      <ul style={{ margin: 0, paddingLeft: 20, display: 'flex', flexDirection: 'column', gap: 8 }}>
        <li>You must be 18 or older to play.</li>
        <li>Daily Draw is not available in every country.</li>
        <li>
          Tickets are bought and prizes paid by the game contract on-chain. Transactions can&apos;t
          be reversed.
        </li>
      </ul>
    </AppShell>
  );
}
