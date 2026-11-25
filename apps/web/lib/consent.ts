// One-time 18+ and terms confirmation before the first ticket (R-02), remembered per browser.

/** Bump the version (e.g. when the terms change) to ask everyone again. */
export const CONSENT_STORAGE_KEY = 'daily-draw:consent';
export const CONSENT_VERSION = 1;

/** Placeholder until the terms page is written (issue #33). */
export const TERMS_PATH = '/terms';

interface StoredConsent {
  version: number;
  at: number;
}

/** Whether a stored value is a confirmation of the current version. */
export function hasConsent(stored: string | null): boolean {
  if (!stored) return false;
  try {
    const value = JSON.parse(stored) as Partial<StoredConsent> | null;
    return value?.version === CONSENT_VERSION;
  } catch {
    return false;
  }
}

export function consentRecord(now: number = Date.now()): string {
  return JSON.stringify({ version: CONSENT_VERSION, at: now } satisfies StoredConsent);
}

/** Reads the browser's confirmation; false if storage is unavailable (private mode). */
export function readConsent(storage: Pick<Storage, 'getItem'> | undefined): boolean {
  try {
    return hasConsent(storage?.getItem(CONSENT_STORAGE_KEY) ?? null);
  } catch {
    return false;
  }
}

/** Saves the confirmation; ignored if storage is unavailable (asked again next visit). */
export function saveConsent(storage: Pick<Storage, 'setItem'> | undefined): void {
  try {
    storage?.setItem(CONSENT_STORAGE_KEY, consentRecord());
  } catch {
    // Private mode or storage full: the player is asked again next time.
  }
}
