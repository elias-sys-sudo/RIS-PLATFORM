import { RisError } from './ris.error';

export interface FieldError {
  field: string;
  message: string;
}

/**
 * Thrown when request input fails Joi validation.
 * Returns 400 with field-level error details.
 */
export class ValidationError extends RisError {
  public readonly fields: FieldError[];

  constructor(message: string, fields: FieldError[] = []) {
    super(message, 400, 'VALIDATION_ERROR');
    this.fields = fields;
  }
}
