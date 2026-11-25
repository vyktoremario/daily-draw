import { createConfig, http, injected, mock, type CreateConnectorFn } from 'wagmi';
import { walletConnect } from 'wagmi/connectors';
import { ANVIL_ACCOUNTS, appConfig } from './config';

const DEV_WALLET_KEY = 'dailydraw.devWallet';

/**
 * An Anvil account as a wallet: wagmi's mock connector sends transactions to Anvil, which signs
 * for its unlocked test accounts. Remembers the choice so a page reload stays connected.
 */
function devWallet(account: (typeof ANVIL_ACCOUNTS)[number], index: number): CreateConnectorFn {
  const id = `dev-wallet-${index + 1}`;
  const wasConnected =
    typeof window !== 'undefined' && window.localStorage.getItem(DEV_WALLET_KEY) === id;
  const create = mock({
    accounts: [account],
    features: { reconnect: true, defaultConnected: wasConnected },
  });
  return (config) => {
    const connector = create(config);
    return {
      ...connector,
      id,
      name: `Dev wallet ${index + 1} (Anvil)`,
      async connect(params) {
        const result = await connector.connect(params);
        window.localStorage.setItem(DEV_WALLET_KEY, id);
        return result;
      },
      async disconnect() {
        window.localStorage.removeItem(DEV_WALLET_KEY);
        return connector.disconnect();
      },
    } as typeof connector;
  };
}

const connectors: CreateConnectorFn[] = [injected({ shimDisconnect: true })];
if (appConfig.walletConnectProjectId) {
  connectors.push(
    walletConnect({
      projectId: appConfig.walletConnectProjectId,
      metadata: {
        name: 'Daily Draw',
        description: 'A $1 daily number draw you can check yourself.',
        url: 'https://dailydraw.app',
        icons: [],
      },
    }),
  );
}
if (appConfig.devWallets) connectors.push(...ANVIL_ACCOUNTS.map(devWallet));

export const wagmiConfig = createConfig({
  chains: [appConfig.chain],
  connectors,
  transports: { [appConfig.chain.id]: http(appConfig.rpcUrl) },
  ssr: true,
});

declare module 'wagmi' {
  interface Register {
    config: typeof wagmiConfig;
  }
}
