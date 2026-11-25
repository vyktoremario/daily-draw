import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Don't write an AGENTS.md into the app on `next dev`.
  agentRules: false,
};

export default nextConfig;
