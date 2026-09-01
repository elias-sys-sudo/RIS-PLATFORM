import { Request, Response, NextFunction } from 'express';
import Joi from 'joi';
import { ValidationError } from '../errors';
import type { FieldError } from '../errors';

interface ValidationSchemas {
  body?: Joi.ObjectSchema;
  params?: Joi.ObjectSchema;
  query?: Joi.ObjectSchema;
}

/**
 * Joi validation middleware factory.
 * Validates req.body, req.params, and req.query against provided schemas.
 * Returns 400 with field-level error details on failure.
 */
export function validate(schemas: ValidationSchemas) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const errors: FieldError[] = [];

    if (schemas.body) {
      const result = schemas.body.validate(req.body, {
        abortEarly: false,
        stripUnknown: true,
      });
      if (result.error) {
        errors.push(
          ...result.error.details.map((d) => ({
            field: d.path.join('.'),
            message: d.message,
          })),
        );
      } else {
        req.body = result.value as Record<string, unknown>;
      }
    }

    if (schemas.params) {
      const result = schemas.params.validate(req.params, {
        abortEarly: false,
      });
      if (result.error) {
        errors.push(
          ...result.error.details.map((d) => ({
            field: `params.${d.path.join('.')}`,
            message: d.message,
          })),
        );
      }
    }

    if (schemas.query) {
      const result = schemas.query.validate(req.query, {
        abortEarly: false,
        stripUnknown: true,
      });
      if (result.error) {
        errors.push(
          ...result.error.details.map((d) => ({
            field: `query.${d.path.join('.')}`,
            message: d.message,
          })),
        );
      } else {
        req.query = result.value as Record<string, string>;
      }
    }

    if (errors.length > 0) {
      throw new ValidationError('Validation failed', errors);
    }

    next();
  };
}
