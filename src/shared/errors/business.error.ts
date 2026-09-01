import { RisError } from './ris.error';

/**
 * Thrown when a business rule is violated (e.g., credit limit exceeded, tenor out of range).
 * Returns 422 Unprocessable Entity with a specific error code and contextual data.
 */
export class BusinessRuleError extends RisError {
  public readonly data: Record<string, unknown>;

  constructor(errorCode: string, message: string, data: Record<string, unknown> = {}) {
    super(message, 422, errorCode);
    this.data = data;
  }
}
