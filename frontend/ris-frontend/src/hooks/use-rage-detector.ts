import { useEffect } from 'react';
import { trackEvent } from './use-analytics';

/** Minimum clicks within the time window to count as a rage tap */
const CLICK_THRESHOLD = 3;
/** Time window in milliseconds */
const TIME_WINDOW_MS = 500;

/**
 * Detects rage taps — 3+ clicks within 500ms on the same element.
 * Fires an analytics event with the element selector, page path, and timestamp.
 *
 * Mount once in AppShell as a global listener.
 */
export function useRageDetector(): void {
  useEffect(() => {
    const clicks: { target: EventTarget | null; time: number }[] = [];

    function handleClick(e: MouseEvent): void {
      const now = Date.now();
      clicks.push({ target: e.target, time: now });

      // Remove clicks outside the window
      while (clicks.length > 0 && now - clicks[0].time > TIME_WINDOW_MS) {
        clicks.shift();
      }

      if (clicks.length >= CLICK_THRESHOLD) {
        // Check if all clicks are on the same element or close parent
        const sameTarget = clicks.every((c) => c.target === clicks[0].target);
        if (sameTarget && e.target instanceof HTMLElement) {
          const selector = describeElement(e.target);
          trackEvent('rage_tap', {
            selector,
            path: window.location.pathname,
            click_count: clicks.length,
          });
          // Reset after detection to avoid flooding
          clicks.length = 0;
        }
      }
    }

    document.addEventListener('click', handleClick, { passive: true });
    return () => document.removeEventListener('click', handleClick);
  }, []);
}

/** Build a human-readable selector for the target element */
function describeElement(el: HTMLElement): string {
  const tag = el.tagName.toLowerCase();
  const id = el.id ? `#${el.id}` : '';
  const cls = el.className && typeof el.className === 'string'
    ? '.' + el.className.split(' ').slice(0, 2).join('.')
    : '';
  const text = el.textContent?.trim().slice(0, 30) ?? '';
  return `${tag}${id}${cls}${text ? ` "${text}"` : ''}`;
}
