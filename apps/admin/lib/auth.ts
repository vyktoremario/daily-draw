// HTTP basic auth for the dashboard (R1). SSO and 2FA replace it in R3.

export interface Credentials {
  user: string;
  password: string;
}

/** ADMIN_USER / ADMIN_PASSWORD, or null when either is missing. */
export function credentialsFromEnv(env: Partial<Record<string, string | undefined>>) {
  const user = env.ADMIN_USER;
  const password = env.ADMIN_PASSWORD;
  return user && password ? { user, password } : null;
}

/** Decodes an `Authorization: Basic …` header; null if absent or malformed. */
export function parseBasicAuth(header: string | null): Credentials | null {
  const match = header && /^Basic\s+([A-Za-z0-9+/=]+)\s*$/i.exec(header);
  if (!match) return null;
  let decoded: string;
  try {
    decoded = new TextDecoder().decode(Uint8Array.from(atob(match[1]!), (c) => c.charCodeAt(0)));
  } catch {
    return null;
  }
  const colon = decoded.indexOf(':');
  if (colon < 0) return null;
  return { user: decoded.slice(0, colon), password: decoded.slice(colon + 1) };
}

/** Compares without stopping at the first difference, so timing doesn't leak the secret. */
export function safeEqual(a: string, b: string): boolean {
  const x = new TextEncoder().encode(a);
  const y = new TextEncoder().encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

export type AuthDecision = 'allow' | 'challenge' | 'unconfigured';

/**
 * Whether a request may see the dashboard. Without configured credentials the dashboard is
 * closed, except in local development (`next dev`).
 */
export function authorize(
  header: string | null,
  expected: Credentials | null,
  development: boolean,
): AuthDecision {
  if (!expected) return development ? 'allow' : 'unconfigured';
  const given = parseBasicAuth(header);
  if (!given) return 'challenge';
  // Evaluate both so a wrong user takes as long as a wrong password.
  const userOk = safeEqual(given.user, expected.user);
  const passwordOk = safeEqual(given.password, expected.password);
  return userOk && passwordOk ? 'allow' : 'challenge';
}
