import { useEffect, useRef, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuthStore } from '@/store/auth.store';

export type EventType =
  | 'invoice:status_changed'
  | 'approval:new'
  | 'payment:authorized'
  | 'collection:payment_received'
  | 'sla:breach_warning';

export interface SseEvent {
  type: EventType;
  [key: string]: unknown;
}

const EVENT_TO_QUERY_KEYS: Record<EventType, string[][]> = {
  'invoice:status_changed':       [['invoices'], ['dashboard']],
  'approval:new':                 [['approvals'], ['dashboard', 'approval-queue']],
  'payment:authorized':           [['payments'], ['dashboard']],
  'collection:payment_received':  [['collections'], ['dashboard']],
  'sla:breach_warning':           [['dashboard']],
};

const MAX_BACKOFF_MS = 30_000;

export type SseEventCallback = (event: SseEvent) => void;

/**
 * SSE hook for real-time updates.
 * Connects to /api/events and invalidates React Query caches on events.
 * Optionally calls `onEvent` for each received event (e.g. toasts, badge counts).
 * Falls back gracefully if SSE endpoint doesn't exist (no errors shown).
 */
export function useEventStream(
  enabled = true,
  onEvent?: SseEventCallback,
): void {
  const qc = useQueryClient();
  const retriesRef = useRef(0);
  const everConnectedRef = useRef(false);
  const givenUpRef = useRef(false);
  const esRef = useRef<EventSource | null>(null);
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;

  const connect = useCallback(() => {
    if (givenUpRef.current) return;
    const url = '/api/events';
    const es = new EventSource(url);
    esRef.current = es;

    es.onopen = () => {
      retriesRef.current = 0;
      everConnectedRef.current = true;
    };

    es.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data) as SseEvent;
        const keys = EVENT_TO_QUERY_KEYS[data.type];
        if (keys) {
          keys.forEach((key) => void qc.invalidateQueries({ queryKey: key }));
        }
        onEventRef.current?.(data);
      } catch { /* ignore malformed events */ }
    };

    es.onerror = () => {
      es.close();
      esRef.current = null;
      // If we never managed a single successful connection, the endpoint
      // probably doesn't exist (404). Stop retrying instead of hammering it.
      if (!everConnectedRef.current) {
        givenUpRef.current = true;
        return;
      }
      const delay = Math.min(
        1000 * Math.pow(2, retriesRef.current),
        MAX_BACKOFF_MS,
      );
      retriesRef.current++;
      setTimeout(connect, delay);
    };
  }, [qc]);

  useEffect(() => {
    if (!enabled) return;

    const token = useAuthStore.getState().accessToken;
    if (!token) return;

    connect();

    // Pause when tab is hidden
    function handleVisibility(): void {
      if (document.hidden) {
        esRef.current?.close();
        esRef.current = null;
      } else {
        connect();
      }
    }
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibility);
      esRef.current?.close();
      esRef.current = null;
    };
  }, [enabled, connect]);
}
