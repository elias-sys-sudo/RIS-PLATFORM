import { RisError } from './ris.error';

/**
 * Thrown when authentication fails (invalid credentials, expired token, etc.).
 * Returns 401 Unauthorized.
 */
export class AuthError extends RisError {
  constructor(message = 'Authentication required') {
    super(message, 401, 'AUTH_ERROR');
  }
}
