import { useEffect, useRef, useCallback, useState } from 'react';

const ACTIVITY_EVENTS: (keyof WindowEventMap)[] = [
  'mousemove',
  'mousedown',
  'keydown',
  'touchstart',
  'scroll',
  'wheel',
];

/** Default: 5 minutes per DESIGN.md (financial apps: 5 min idle, warn at 4) */
const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;
/** Warn 60 seconds before logout */
const DEFAULT_WARN_BEFORE_MS = 60 * 1000;

interface UseIdleTimeoutOptions {
  onIdle: () => void;
  onWarn?: () => void;
  timeoutMs?: number;
  warnBeforeMs?: number;
  enabled?: boolean;
}

/**
 * Calls `onWarn` at `warnBeforeMs` before the idle threshold, then `onIdle`
 * when the full `timeoutMs` of inactivity is reached. The timer resets on
 * any tracked user activity.
 *
 * Also exposes `secondsRemaining` for countdown display and `resetTimer` to
 * allow extending the session from a warning dialog.
 */
export function useIdleTimeout({
  onIdle,
  onWarn,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  warnBeforeMs = DEFAULT_WARN_BEFORE_MS,
  enabled = true,
}: UseIdleTimeoutOptions): {
  secondsRemaining: number;
  isWarning: boolean;
  resetTimer: () => void;
} {
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const warnTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const onIdleRef = useRef(onIdle);
  onIdleRef.current = onIdle;
  const onWarnRef = useRef(onWarn);
  onWarnRef.current = onWarn;

  const [secondsRemaining, setSecondsRemaining] = useState(
    Math.floor(timeoutMs / 1000),
  );
  const [isWarning, setIsWarning] = useState(false);

  const clearAllTimers = useCallback(() => {
    if (idleTimerRef.current !== null) clearTimeout(idleTimerRef.current);
    if (warnTimerRef.current !== null) clearTimeout(warnTimerRef.current);
    if (countdownRef.current !== null) clearInterval(countdownRef.current);
  }, []);

  const resetTimer = useCallback(() => {
    clearAllTimers();
    setIsWarning(false);
    setSecondsRemaining(Math.floor(timeoutMs / 1000));

    const warnDelay = timeoutMs - warnBeforeMs;

    // Set warn timer
    warnTimerRef.current = setTimeout(() => {
      setIsWarning(true);
      onWarnRef.current?.();

      // Start countdown
      const deadline = Date.now() + warnBeforeMs;
      countdownRef.current = setInterval(() => {
        const remaining = Math.max(
          0,
          Math.ceil((deadline - Date.now()) / 1000),
        );
        setSecondsRemaining(remaining);
        if (remaining <= 0) {
          if (countdownRef.current !== null)
            clearInterval(countdownRef.current);
        }
      }, 1000);
    }, warnDelay);

    // Set idle timer (full timeout)
    idleTimerRef.current = setTimeout(() => {
      clearAllTimers();
      onIdleRef.current();
    }, timeoutMs);
  }, [timeoutMs, warnBeforeMs, clearAllTimers]);

  useEffect(() => {
    if (!enabled) return;

    resetTimer();

    ACTIVITY_EVENTS.forEach((evt) =>
      window.addEventListener(evt, resetTimer, { passive: true }),
    );

    return () => {
      clearAllTimers();
      ACTIVITY_EVENTS.forEach((evt) =>
        window.removeEventListener(evt, resetTimer),
      );
    };
  }, [enabled, resetTimer, clearAllTimers]);

  return { secondsRemaining, isWarning, resetTimer };
}
