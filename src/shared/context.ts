// ============================================================
// context.ts — Request-scoped AsyncLocalStorage for tracing
// ============================================================
//
// Carries the request ID (and any future request-scoped fields) through every
// async hop of an HTTP request and into BullMQ worker job processing, so that
// every log line and queued job can be correlated back to the originating
// request without threading it through every function signature.
//
// Mirrors the existing `rlsStore` pattern in `database/pool.ts`. Read/written
// at exactly two boundaries:
//   - Producer: requestIdMiddleware wraps the response chain via runWithRequestContext.
//   - Producer: enqueueWithContext stamps `_meta.requestId` onto outgoing jobs.
//   - Consumer: withJobContext re-enters the store with the job's `_meta.requestId`
//     so the worker's logger emits the same request_id as the originating HTTP call.

import { AsyncLocalStorage } from 'async_hooks';

/** Fields propagated through the async request chain. */
export interface RequestContext {
  requestId: string;
}

export const requestContextStore = new AsyncLocalStorage<RequestContext>();

/**
 * Run `fn` with the given request context active for the duration of every
 * async operation it kicks off. Returns whatever `fn` returns.
 */
export function runWithRequestContext<T>(ctx: RequestContext, fn: () => T): T {
  return requestContextStore.run(ctx, fn);
}

/**
 * Read the current request ID, or undefined when called outside any request
 * scope (e.g. scheduled jobs without a triggering HTTP request, server
 * startup). Callers that want a placeholder use `getRequestId() ?? '-'`.
 */
export function getRequestId(): string | undefined {
  return requestContextStore.getStore()?.requestId;
}
