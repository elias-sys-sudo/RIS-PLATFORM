import { logger } from '../../../shared/logger';
import { PaymentProvider } from '../payments.types';
import type { IPaymentProvider, PaymentRecord, PaymentProviderResult } from '../payments.types';

/**
 * Uganda ACH / EFT bank transfer provider.
 * Generates a Uganda-format ACH instruction for batch processing.
 * EFT payments are confirmed asynchronously via bank reconciliation.
 */
export class BankEftProvider implements IPaymentProvider {
  public readonly name = PaymentProvider.EFT;

  /**
   * Generate Uganda ACH format payment instruction.
   */
  // eslint-disable-next-line @typescript-eslint/require-await
  async execute(payment: PaymentRecord, idempotencyKey: string): Promise<PaymentProviderResult> {
    logger.info('EFT payment instruction generated', {
      component: 'payments',
      provider: this.name,
      paymentId: payment.id,
    });

    try {
      const achRecord = this.generateAchRecord(payment, idempotencyKey);

      logger.info('Uganda ACH record created', {
        component: 'payments',
        paymentId: payment.id,
        achLength: achRecord.length,
      });

      return {
        success: true,
        transactionReference: idempotencyKey,
        providerReference: `EFT-${idempotencyKey.slice(0, 8)}`,
        pendingConfirmation: true,
      };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      logger.error('EFT payment instruction failed', {
        component: 'payments',
        paymentId: payment.id,
        errorMessage: message,
      });
      return {
        success: false,
        transactionReference: idempotencyKey,
        providerReference: '',
        failureReason: `EFT error: ${message}`,
      };
    }
  }

  /**
   * Generate a Uganda ACH format fixed-width record.
   * Format: [TxnType(2)][Amount(15)][Currency(3)][Reference(36)][Date(8)]
   */
  private generateAchRecord(payment: PaymentRecord, idempotencyKey: string): string {
    const txnType = 'CR';
    const amount = payment.amount.padStart(15, '0');
    const currency = 'UGX';
    const reference = idempotencyKey.padEnd(36, ' ');
    const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');

    return `${txnType}${amount}${currency}${reference}${date}`;
  }
}
