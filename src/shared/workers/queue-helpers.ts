// ============================================================
// queue-helpers.ts — BullMQ context propagation helpers
// ============================================================
//
// Two helpers, one for each side of the queue:
//
//   - enqueueWithContext: producer side. Stamps the active request_id onto
//     `data._meta.requestId` before calling `.add(...)`, so the consumer
//     can re-enter the same context.
//
//   - withJobContext: consumer side. Wraps a BullMQ handler so the
//     job's `_meta.requestId` is active inside requestContextStore for the
//     duration of the handler — every log line and every nested .add()
//     inherits the same request_id as the originating HTTP call.

import type { Job, JobsOptions, Queue } from 'bullmq';
import { getRequestId, runWithRequestContext } from '../context';

interface JobMeta {
  requestId: string;
  enqueuedAt: string;
}

/** Subset of payload shape we read from jobs to recover their request context. */
interface JobDataWithMeta {
  _meta?: JobMeta;
}

/**
 * Enqueue `data` onto `queue` and stamp it with the active request_id (if
 * any) so the consumer can re-enter the same context. Outside an HTTP
 * request the requestId field defaults to `'-'`.
 *
 * The job payload type is augmented at runtime with `_meta`; the worker's
 * processor still receives it via `job.data._meta` if it cares.
 */
export async function enqueueWithContext<T extends Record<string, unknown>>(
  queue: Queue,
  name: string,
  data: T,
  opts?: JobsOptions,
): Promise<Job<T>> {
  const meta: JobMeta = {
    requestId: getRequestId() ?? '-',
    enqueuedAt: new Date().toISOString(),
  };
  const enriched = { ...data, _meta: meta };
  // BullMQ types the data parameter as the generic T; we widen at this
  // boundary because _meta is an internal envelope the helper owns.
  return queue.add(name, enriched as unknown as T, opts) as Promise<Job<T>>;
}

/**
 * Wrap a BullMQ job processor so it runs inside `requestContextStore` with
 * the request_id carried in `job.data._meta`. Jobs enqueued via the legacy
 * direct `.add(...)` path will have no `_meta` and default to `'-'`.
 */
export function withJobContext<T>(
  processor: (job: Job<T>) => Promise<void>,
): (job: Job<T>) => Promise<void> {
  return (job) => {
    // Defensive: BullMQ always passes a Job, but some tests (and theoretical
    // edge cases) invoke the processor with undefined. Treat it as missing
    // context rather than crashing the worker.
    const data = (job as Job<T> | undefined)?.data as JobDataWithMeta | null | undefined;
    const requestId = data?._meta?.requestId ?? '-';
    return runWithRequestContext({ requestId }, () => processor(job));
  };
}
