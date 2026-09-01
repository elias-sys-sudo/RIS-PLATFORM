import { Worker, type Job } from 'bullmq';
import { logger } from '../logger';
import * as collectionsService from '../../services/collections/collections.service';
import { enqueueWithContext, withJobContext } from './queue-helpers';

// =========================================================================
// Collection monitoring job payload
// =========================================================================

/**
 * Payload for starting collection monitoring after an invoice is funded.
 * ID-only — no PII.
 */
export interface CollectionMonitoringPayload {
  invoiceId: string;
  paymentId: string;
}

// =========================================================================
// Worker factory
// =========================================================================

/**
 * Create a BullMQ Worker for the 'collection-monitoring' queue.
 * Triggered by the payments service when an invoice transitions to funded.
 * The worker delegates to collectionsService.startCollectionMonitoring,
 * which is idempotent — duplicate jobs are no-ops.
 */
export function createCollectionMonitoringWorker(
  redisUrl: string,
): Worker<CollectionMonitoringPayload> {
  const worker = new Worker<CollectionMonitoringPayload>(
    'collection-monitoring',
    withJobContext<CollectionMonitoringPayload>(async (job: Job<CollectionMonitoringPayload>) => {
      await collectionsService.startCollectionMonitoring(job.data.invoiceId, job.data.paymentId);
    }),
    {
      connection: { url: redisUrl },
      concurrency: 1,
    },
  );

  attachListeners(worker);
  return worker;
}

/** Attach completion + failure listeners with no-PII logging. */
function attachListeners(worker: Worker<CollectionMonitoringPayload>): void {
  worker.on('completed', (job: Job<CollectionMonitoringPayload>) => {
    logger.info('Collection monitoring job completed', {
      component: 'collection-monitoring',
      jobId: job.id,
      invoiceId: job.data.invoiceId,
    });
  });

  worker.on('failed', (job: Job<CollectionMonitoringPayload> | undefined, err: Error) => {
    logger.error('Collection monitoring job failed', {
      component: 'collection-monitoring',
      jobId: job?.id,
      invoiceId: job?.data?.invoiceId,
      attemptsMade: job?.attemptsMade,
      errorMessage: err.message,
    });

    // Final failure — notify finance_manager via the collections notification queue
    if (job && job.attemptsMade >= (job.opts?.attempts ?? 3)) {
      const notifQueue = collectionsService.getNotificationQueueRef();
      if (notifQueue) {
        void enqueueWithContext(
          notifQueue,
          'collection-monitoring-failure',
          {
            jobId: job.id,
            invoiceId: job.data.invoiceId,
            errorMessage: err.message,
            notifyRole: 'finance_manager',
          },
          { attempts: 3, backoff: { type: 'exponential', delay: 30_000 } },
        );
      }
    }
  });
}
