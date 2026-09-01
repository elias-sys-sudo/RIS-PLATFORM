process.env.ENCRYPTION_KEY = 'aabbccddee11223344556677889900aabbccddee11223344556677889900aabb';

import {
  requestContextStore,
  runWithRequestContext,
  getRequestId,
} from '../../../src/shared/context';
import { enqueueWithContext, withJobContext } from '../../../src/shared/workers/queue-helpers';
import type { Job, Queue } from 'bullmq';

// =========================================================================
// AsyncLocalStorage primitives
// =========================================================================
describe('requestContextStore', () => {
  it('makes the requestId available inside runWithRequestContext', () => {
    runWithRequestContext({ requestId: 'req-1' }, () => {
      expect(getRequestId()).toBe('req-1');
    });
  });

  it('returns undefined outside any active context', () => {
    expect(getRequestId()).toBeUndefined();
  });

  it('propagates the context across async hops', async () => {
    await runWithRequestContext({ requestId: 'req-2' }, async () => {
      await new Promise((resolve) => setImmediate(resolve));
      expect(getRequestId()).toBe('req-2');
    });
  });

  it('does not leak the context outside the run() callback', () => {
    runWithRequestContext({ requestId: 'req-3' }, () => {
      expect(getRequestId()).toBe('req-3');
    });
    expect(getRequestId()).toBeUndefined();
  });

  it('isolates nested contexts — inner overrides outer for the duration of its callback', () => {
    runWithRequestContext({ requestId: 'outer' }, () => {
      expect(getRequestId()).toBe('outer');
      runWithRequestContext({ requestId: 'inner' }, () => {
        expect(getRequestId()).toBe('inner');
      });
      expect(getRequestId()).toBe('outer');
    });
  });
});

// =========================================================================
// enqueueWithContext — producer side
// =========================================================================
describe('enqueueWithContext', () => {
  it('stamps the active requestId onto _meta when enqueued inside a context', async () => {
    const add = jest.fn().mockResolvedValue({ id: 'job-1' });
    const queue = { add } as unknown as Queue;

    await runWithRequestContext({ requestId: 'req-4' }, async () => {
      await enqueueWithContext(queue, 'demo', { payload: 'x' });
    });

    expect(add).toHaveBeenCalledTimes(1);
    const [name, data] = add.mock.calls[0] as [
      string,
      { payload: string; _meta: { requestId: string; enqueuedAt: string } },
    ];
    expect(name).toBe('demo');
    expect(data.payload).toBe('x');
    expect(data._meta.requestId).toBe('req-4');
    expect(data._meta.enqueuedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("defaults the requestId to '-' when enqueued outside any context", async () => {
    const add = jest.fn().mockResolvedValue({ id: 'job-2' });
    const queue = { add } as unknown as Queue;

    await enqueueWithContext(queue, 'demo', { payload: 'y' });

    const callArgs = add.mock.calls[0] as [string, { _meta: { requestId: string } }, unknown?];
    expect(callArgs[1]._meta.requestId).toBe('-');
  });
});

// =========================================================================
// withJobContext — consumer side
// =========================================================================
describe('withJobContext', () => {
  it('runs the processor inside the requestId carried by job._meta', async () => {
    let observed: string | undefined;
    const wrapped = withJobContext<Record<string, unknown>>(() => {
      observed = getRequestId();
      return Promise.resolve();
    });

    const job = {
      data: { _meta: { requestId: 'req-5', enqueuedAt: 'now' } },
    } as unknown as Job<Record<string, unknown>>;

    await wrapped(job);

    expect(observed).toBe('req-5');
  });

  it("defaults the requestId to '-' when the job has no _meta", async () => {
    let observed: string | undefined;
    const wrapped = withJobContext<Record<string, unknown>>(() => {
      observed = getRequestId();
      return Promise.resolve();
    });

    const job = { data: { unrelated: 'field' } } as unknown as Job<Record<string, unknown>>;

    await wrapped(job);

    expect(observed).toBe('-');
  });

  it('passes the job argument through to the inner processor', async () => {
    let received: Job<Record<string, unknown>> | undefined;
    const wrapped = withJobContext<Record<string, unknown>>((job) => {
      received = job;
      return Promise.resolve();
    });

    const job = { id: 'job-3', data: {} } as unknown as Job<Record<string, unknown>>;
    await wrapped(job);

    expect(received?.id).toBe('job-3');
  });

  it('propagates errors thrown inside the processor', async () => {
    const wrapped = withJobContext<Record<string, unknown>>(() =>
      Promise.reject(new Error('processor failed')),
    );

    const job = { data: {} } as unknown as Job<Record<string, unknown>>;
    await expect(wrapped(job)).rejects.toThrow('processor failed');
  });
});

// Reference store directly so the import is not flagged as unused even when
// all consumers go through the helpers.
void requestContextStore;
