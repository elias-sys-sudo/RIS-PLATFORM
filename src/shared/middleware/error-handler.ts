import { Request, Response, NextFunction } from 'express';
import { RisError } from '../errors/ris.error';
import { ValidationError } from '../errors/validation.error';
import { NotFoundError } from '../errors/not-found.error';
import { BusinessRuleError } from '../errors/business.error';
import { PaymentError } from '../errors/payment.error';
import { logger } from '../logger';

interface ErrorResponse {
  error: string;
  message: string;
  fields?: Array<{ field: string; message: string }>;
  data?: Record<string, unknown>;
}

/**
 * Global Express error handler.
 * Catches all RisError subclasses and returns structured JSON.
 * For unknown errors: logs full error internally, returns generic 500.
 * Never exposes stack traces or internal details to the client.
 */
export function globalErrorHandler(
  err: Error,
  _req: Request,
  res: Response,
  // Express requires 4 parameters to identify error-handling middleware
  _next: NextFunction, // eslint-disable-line @typescript-eslint/no-unused-vars
): void {
  if (err instanceof ValidationError) {
    const response: ErrorResponse = {
      error: err.errorCode,
      message: err.message,
      fields: err.fields,
    };
    res.status(err.statusCode).json(response);
    return;
  }

  if (err instanceof NotFoundError) {
    const response: ErrorResponse = {
      error: err.errorCode,
      message: err.message,
    };
    res.status(err.statusCode).json(response);
    return;
  }

  if (err instanceof BusinessRuleError) {
    const response: ErrorResponse = {
      error: err.errorCode,
      message: err.message,
      data: err.data,
    };
    res.status(err.statusCode).json(response);
    return;
  }

  if (err instanceof PaymentError) {
    logger.error('Payment error occurred', {
      component: 'payment',
      errorCode: err.errorCode,
      errorMessage: err.message,
    });
    const response: ErrorResponse = {
      error: 'PAYMENT_ERROR',
      message: 'A payment processing error occurred',
    };
    res.status(500).json(response);
    return;
  }

  if (err instanceof RisError) {
    const response: ErrorResponse = {
      error: err.errorCode,
      message: err.message,
    };
    res.status(err.statusCode).json(response);
    return;
  }

  logger.error('Unhandled error', {
    component: 'error-handler',
    errorMessage: err.message,
    errorName: err.name,
  });

  const response: ErrorResponse = {
    error: 'INTERNAL_ERROR',
    message: 'An unexpected error occurred',
  };
  res.status(500).json(response);
}
