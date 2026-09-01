import { useEffect, useCallback } from 'react';

/**
 * Persist form values to sessionStorage so they survive session expiry redirects.
 * On remount, the hook returns the saved values (if any) and clears storage.
 *
 * @param key - Unique key for this form (e.g., 'invoice-create')
 * @param values - Current form values object
 * @param dirty - Whether the form has been touched
 */
export function useFormPersist<T extends Record<string, unknown>>(
  key: string,
  values: T,
  dirty: boolean,
): T | null {
  const storageKey = `ris-form-${key}`;

  // Save on change (debounced via effect)
  useEffect(() => {
    if (dirty) {
      sessionStorage.setItem(storageKey, JSON.stringify(values));
    }
  }, [storageKey, values, dirty]);

  // Clear on unmount if form was submitted (not dirty)
  useEffect(() => {
    return () => {
      if (!dirty) {
        sessionStorage.removeItem(storageKey);
      }
    };
  }, [storageKey, dirty]);

  // Retrieve saved values (called once on mount)
  const getSaved = useCallback((): T | null => {
    try {
      const raw = sessionStorage.getItem(storageKey);
      if (!raw) return null;
      sessionStorage.removeItem(storageKey);
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  }, [storageKey]);

  // Only return on first render
  const [saved] = [getSaved()];
  return saved;
}
