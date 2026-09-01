import { RisError } from './ris.error';

/**
 * Thrown when a payment operation fails.
 * Returns 500 with transaction context for internal investigation.
 * The strictest error class — payment failures require immediate attention.
 */
export class PaymentError extends RisError {
  public readonly transactionContext: Record<string, unknown>;

  constructor(message: string, transactionContext: Record<string, unknown> = {}) {
    super(message, 500, 'PAYMENT_ERROR', true);
    this.transactionContext = transactionContext;
  }
}
