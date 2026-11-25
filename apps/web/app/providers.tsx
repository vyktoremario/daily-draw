'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useEffect, useState, type ReactNode } from 'react';
import { WagmiProvider, useConnect, useConnection, useConnectors } from 'wagmi';
import { rememberReferrer } from '../lib/referral';
import { wagmiConfig } from '../lib/wagmi';

/** Saves the referrer from a `?ref=` link the first time a player arrives with one. */
function ReferralCapture() {
  useEffect(() => {
    const ref = new URLSearchParams(window.location.search).get('ref');
    rememberReferrer(window.localStorage, ref);
  }, []);
  return null;
}

/** Inside MiniPay (Celo), the wallet is the browser: connect straight away. */
function MiniPayAutoConnect() {
  const { isConnected } = useConnection();
  const connectors = useConnectors();
  const { mutate } = useConnect();
  useEffect(() => {
    const eth = (window as { ethereum?: { isMiniPay?: boolean } }).ethereum;
    const injectedConnector = connectors.find((c) => c.id === 'injected');
    if (eth?.isMiniPay && !isConnected && injectedConnector)
      mutate({ connector: injectedConnector });
  }, [connectors, isConnected, mutate]);
  return null;
}

export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          // Chain state changes with every block: keep reads fresh without a manual refresh.
          queries: { refetchInterval: 6_000, staleTime: 2_000 },
        },
      }),
  );
  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <ReferralCapture />
        <MiniPayAutoConnect />
        {children}
      </QueryClientProvider>
    </WagmiProvider>
  );
}
