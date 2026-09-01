import { Worker, type Job } from 'bullmq';
import { logger } from '../logger';
import * as facilitiesRepo from '../../services/facilities/facilities.repository';
import * as facilitiesService from '../../services/facilities/facilities.service';
import { withJobContext } from './queue-helpers';

// =========================================================================
// Facility repayment job payload
// =========================================================================

interface FacilityRepaymentPayload {
  invoiceId: string;
}

// =========================================================================
// Job handler
// =========================================================================

/**
 * Find the active drawdown for the given invoice and
 * process the repayment atomically.
 */
async function handleRepaymentJob(invoiceId: string): Promise<void> {
  const drawdown = await facilitiesRepo.getDrawdownByInvoiceId(invoiceId);

  if (!drawdown) {
    logger.info('No active drawdown for invoice — skipping', {
      component: 'facility-repayment',
      invoiceId,
    });
    return;
  }

  await facilitiesService.processRepayment(
    drawdown.facility_id,
    drawdown.id,
    'SYSTEM',
    'system',
    'bull-worker',
  );

  logger.info('Facility repayment processed', {
    component: 'facility-repayment',
    invoiceId,
    drawdownId: drawdown.id,
    facilityId: drawdown.facility_id,
  });
}

// =========================================================================
// Worker factory
// =========================================================================

/**
 * Create a BullMQ Worker for the 'facility-repayment' queue.
 * Triggered when collections records a buyer payment.
 * Call once during server startup; close on shutdown.
 */
export function createFacilityRepaymentWorker(redisUrl: string): Worker<FacilityRepaymentPayload> {
  const worker = new Worker<FacilityRepaymentPayload>(
    'facility-repayment',
    withJobContext<FacilityRepaymentPayload>(async (job: Job<FacilityRepaymentPayload>) => {
      await handleRepaymentJob(job.data.invoiceId);
    }),
    {
      connection: { url: redisUrl },
      concurrency: 1,
    },
  );

  worker.on('completed', (job: Job<FacilityRepaymentPayload>) => {
    logger.info('Facility repayment job completed', {
      component: 'facility-repayment',
      jobId: job.id,
      invoiceId: job.data.invoiceId,
    });
  });

  worker.on('failed', (job: Job<FacilityRepaymentPayload> | undefined, err: Error) => {
    logger.error('Facility repayment job failed', {
      component: 'facility-repayment',
      jobId: job?.id,
      invoiceId: job?.data?.invoiceId,
      errorMessage: err.message,
    });
  });

  return worker;
}
