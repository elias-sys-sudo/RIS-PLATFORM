import { RisError } from './ris.error';

/**
 * Thrown when user is authenticated but lacks permission for the requested action.
 * Returns 403 Forbidden.
 */
export class ForbiddenError extends RisError {
  constructor(message = 'You do not have permission to perform this action') {
    super(message, 403, 'FORBIDDEN');
  }
}
