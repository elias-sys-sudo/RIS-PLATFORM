import { logger } from '../../../shared/logger';
import { PaymentProvider } from '../payments.types';
import type { IPaymentProvider, PaymentRecord, PaymentProviderResult } from '../payments.types';

/**
 * Mock payment provider for testing and development.
 * Always returns success unless amount contains specific test values.
 */
export class MockProvider implements IPaymentProvider {
  public readonly name: PaymentProvider;

  constructor(name: PaymentProvider = PaymentProvider.MOCK) {
    this.name = name;
  }

  /**
   * Simulate payment execution.
   * Amount ending in '999' triggers failure for testing.
   */
  // eslint-disable-next-line @typescript-eslint/require-await
  async execute(payment: PaymentRecord, idempotencyKey: string): Promise<PaymentProviderResult> {
    logger.info('Mock provider executing payment', {
      component: 'payments',
      provider: this.name,
      paymentId: payment.id,
    });

    if (payment.amount.endsWith('999')) {
      return {
        success: false,
        transactionReference: idempotencyKey,
        providerReference: '',
        failureReason: 'Mock failure: test amount ends with 999',
      };
    }

    return {
      success: true,
      transactionReference: `MOCK-${idempotencyKey}`,
      providerReference: `MOCK-PROV-${payment.id}`,
    };
  }
}
