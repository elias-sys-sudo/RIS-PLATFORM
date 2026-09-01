import { useEffect, useRef } from 'react';
import { trackEvent } from './use-analytics';

/**
 * Tracks form abandonment — records which field was last focused
 * before the user navigates away or closes the tab.
 *
 * @param formName  Identifier for the form (e.g., 'invoice-create', 'registration')
 * @param enabled   Only track when true (prevents tracking on read-only pages)
 */
export function useFormAnalytics(formName: string, enabled = true): void {
  const lastFieldRef = useRef<string | null>(null);
  const startTimeRef = useRef<number>(Date.now());

  useEffect(() => {
    if (!enabled) return;

    startTimeRef.current = Date.now();

    function handleFocusIn(e: FocusEvent): void {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) {
        const name = e.target.name || e.target.id || e.target.type;
        lastFieldRef.current = name;
      }
    }

    function handleBeforeUnload(): void {
      if (lastFieldRef.current) {
        trackEvent('form_abandon', {
          form: formName,
          last_field: lastFieldRef.current,
          duration_ms: Date.now() - startTimeRef.current,
        });
      }
    }

    document.addEventListener('focusin', handleFocusIn, { passive: true });
    window.addEventListener('beforeunload', handleBeforeUnload);

    return () => {
      document.removeEventListener('focusin', handleFocusIn);
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, [formName, enabled]);
}

/**
 * Track successful form submission.
 * Call this in the onSubmit success handler.
 */
export function trackFormSubmit(formName: string, fieldCount: number): void {
  trackEvent('form_submit', { form: formName, field_count: fieldCount });
}
