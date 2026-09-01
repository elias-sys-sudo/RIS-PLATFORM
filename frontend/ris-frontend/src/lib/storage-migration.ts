/**
 * One-time storage key migration: `mms-*` → `ris-*`.
 *
 * Background
 * ----------
 * Before the MMS → RIS rebrand, the frontend persisted state under keys
 * prefixed `mms-` (Zustand stores, i18n language pref, step-up auth expiry,
 * form drafts, notification badge counts). Renaming the keys in code on its
 * own would orphan every existing user's persisted state on first load after
 * deploy — they would lose their language preference, dark-mode toggle, any
 * saved form drafts, and (depending on tab state) be silently logged out.
 *
 * This shim runs once on app boot, BEFORE any Zustand store initialises, and
 * copies any `mms-*` value over to its `ris-*` equivalent (only if the new
 * key is not already populated, to avoid clobbering fresh state). The legacy
 * `mms-*` key is then removed so the migration is one-way and idempotent.
 *
 * A sentinel `ris-storage-migrated-v1` marks completion so subsequent boots
 * short-circuit immediately.
 *
 * The shim is deliberately resilient: any storage access throws (e.g. private
 * mode, quota errors) are caught and ignored — losing migrated state is
 * preferable to crashing the boot path.
 *
 * NOTE: covers BOTH localStorage (auth, ui, lang) and sessionStorage
 * (step-up auth expiry, notification counts, form-* drafts).
 */

const SENTINEL_KEY = 'ris-storage-migrated-v1';

/** Exact-match keys to migrate from localStorage. */
const LOCAL_KEYS: readonly string[] = [
  'mms-auth',
  'mms-ui',
  'mms-lang',
];

/** Exact-match keys to migrate from sessionStorage. */
const SESSION_EXACT_KEYS: readonly string[] = [
  'mms-step-up-expiry',
  'mms-notification-counts',
];

/** Prefix for sessionStorage form-draft keys (e.g. `mms-form-invoice-create`). */
const SESSION_PREFIX_KEYS: readonly string[] = [
  'mms-form-',
];

/**
 * Migrate a single key from `mms-*` to `ris-*` in the given Storage.
 * Idempotent: if the new key already exists, the legacy key is still
 * removed (we trust the existing new value).
 */
function migrateOne(storage: Storage, oldKey: string): void {
  try {
    const value = storage.getItem(oldKey);
    if (value === null) return;
    const newKey = oldKey.replace(/^mms-/, 'ris-');
    if (storage.getItem(newKey) === null) {
      storage.setItem(newKey, value);
    }
    storage.removeItem(oldKey);
  } catch {
    // Storage access failed — ignore and continue.
  }
}

/**
 * Run the one-time storage migration. Safe to call on every boot — exits
 * immediately once the sentinel is set.
 *
 * Call this BEFORE any Zustand store hydration so persisted stores read
 * from the new `ris-*` keys on their first load.
 */
export function runStorageMigration(): void {
  try {
    if (typeof window === 'undefined') return;
    if (window.localStorage.getItem(SENTINEL_KEY) === 'true') return;

    // localStorage: exact keys
    for (const key of LOCAL_KEYS) {
      migrateOne(window.localStorage, key);
    }

    // sessionStorage: exact keys
    for (const key of SESSION_EXACT_KEYS) {
      migrateOne(window.sessionStorage, key);
    }

    // sessionStorage: prefix-matched form-draft keys
    // Snapshot the key list first because we mutate sessionStorage in the loop.
    const sessionKeys: string[] = [];
    for (let i = 0; i < window.sessionStorage.length; i += 1) {
      const k = window.sessionStorage.key(i);
      if (k !== null) sessionKeys.push(k);
    }
    for (const key of sessionKeys) {
      if (SESSION_PREFIX_KEYS.some((p) => key.startsWith(p))) {
        migrateOne(window.sessionStorage, key);
      }
    }

    window.localStorage.setItem(SENTINEL_KEY, 'true');
  } catch {
    // If localStorage is entirely unavailable we cannot persist the sentinel,
    // but that is acceptable: subsequent boots will simply re-run the no-op
    // migration loop, and there is no harm in that.
  }
}
