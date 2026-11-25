// Country blocking (R-01 / C-11). Vercel tells us where a visitor is with the
// `x-vercel-ip-country` header (ISO 3166-1 alpha-2, e.g. "NG") and, for regions,
// `x-vercel-ip-country-region` (ISO 3166-2 subdivision without the country, e.g. "43").
// The decision is here; apps/web/proxy.ts only reads the headers and shows /unavailable.

/**
 * PLACEHOLDER blocked list, used when BLOCKED_COUNTRIES is not set.
 *
 * The real list comes from the lawyer (issue #33) and goes into BLOCKED_COUNTRIES in Vercel;
 * update this default to match once it is agreed. Until then it holds the countries and regions
 * under comprehensive US (OFAC) sanctions:
 *   CU Cuba, IR Iran, KP North Korea, SY Syria,
 *   UA-43 Crimea, UA-14 Donetsk, UA-09 Luhansk.
 * Entries are a country code ("IR") or a country-region code ("UA-43").
 */
export const DEFAULT_BLOCKED_COUNTRIES: readonly string[] = [
  'CU',
  'IR',
  'KP',
  'SY',
  'UA-43',
  'UA-14',
  'UA-09',
];

/**
 * `BLOCKED_COUNTRIES` as a list: comma or space separated, case-insensitive
 * ("US, IR ua-43" -> ["US", "IR", "UA-43"]). Unset or blank -> the placeholder default;
 * "none" -> block nobody. Entries that aren't a country or country-region code are dropped.
 */
export function blockedCountriesFromEnv(
  env: Partial<Record<string, string | undefined>>,
): readonly string[] {
  const raw = env.BLOCKED_COUNTRIES?.trim();
  if (!raw) return DEFAULT_BLOCKED_COUNTRIES;
  if (raw.toLowerCase() === 'none') return [];
  return raw
    .split(/[\s,]+/)
    .map((code) => code.toUpperCase())
    .filter((code) => /^[A-Z]{2}(-[A-Z0-9]{1,3})?$/.test(code));
}

/**
 * Whether a visitor from `country` (and `region`) may not use the app. No country header
 * (local dev, or Vercel couldn't tell) means allowed.
 */
export function isBlocked(
  country: string | null | undefined,
  region: string | null | undefined,
  blocked: readonly string[],
): boolean {
  const cc = country?.trim().toUpperCase();
  if (!cc) return false;
  if (blocked.includes(cc)) return true;
  const rr = region?.trim().toUpperCase();
  return !!rr && blocked.includes(`${cc}-${rr}`);
}
