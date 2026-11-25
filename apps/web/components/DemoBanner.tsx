import Link from 'next/link';
import { appConfig } from '../lib/config';

/**
 * Daily Draw is a portfolio project, not an operating lottery: say so on every page (rendered
 * once, by the root layout). The network name is dropped on narrow screens to keep one line.
 */
export function DemoBanner() {
  const network = appConfig.chainKey === 'anvil' ? 'local chain' : appConfig.chain.name;
  return (
    <div className="demo-banner" role="note" aria-label="Demo notice">
      <span>
        <strong>Portfolio demo</strong>
        <span className="demo-banner-network"> · {network}</span> · test money only ·{' '}
        <Link href="/terms">About</Link>
      </span>
    </div>
  );
}
