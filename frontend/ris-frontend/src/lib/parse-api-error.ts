import axios from 'axios';

/**
 * Extracts a human-readable error message from any thrown value.
 *
 * Priority order:
 *  1. Server-supplied `message` field in the JSON body
 *  2. Network-level failure text (no HTTP response received)
 *  3. Canonical HTTP-status message
 *  4. Generic fallback
 */
export function parseApiError(error: unknown): string {
  if (axios.isAxiosError(error)) {
    // Server returned a structured error body
    const serverMessage = error.response?.data?.message;
    if (typeof serverMessage === 'string' && serverMessage.trim()) {
      return serverMessage.trim();
    }

    // Network-level failure — no HTTP response received at all
    if (!error.response) {
      if (error.code === 'ECONNABORTED' || error.code === 'ERR_CANCELED') {
        return 'Request timed out — please try again.';
      }
      return 'Connection lost — please check your network and retry.';
    }

    // Fall back to status-derived messages
    switch (error.response.status) {
      case 400: return 'Invalid request — please check your input.';
      case 401: return 'Invalid email or password.';
      case 403: return 'You do not have permission to perform this action.';
      case 404: return 'Resource not found. It may have been moved or deleted. Try refreshing the page.';
      case 409: return 'This operation conflicts with existing data. Refresh and try again.';
      case 422: return 'Some fields are invalid. Please review your input and try again.';
      case 429: return 'Too many requests. Please wait a moment and try again.';
      case 500: return 'Server error. Try refreshing the page. If the problem persists, contact support.';
      case 502:
      case 503:
      case 504: return 'Service temporarily unavailable. Please try again in a few seconds.';
      default:  return `Request failed (HTTP ${error.response.status}).`;
    }
  }

  if (error instanceof Error) return 'Something went wrong. Please try again.';
  return 'Something went wrong. Please try again.';
}

/** Returns true when the error is a network-level failure (no HTTP response). */
export function isNetworkError(error: unknown): boolean {
  return axios.isAxiosError(error) && !error.response;
}

/** Returns the HTTP status code from an error, or undefined if not an HTTP error. */
export function getErrorStatus(error: unknown): number | undefined {
  if (axios.isAxiosError(error)) return error.response?.status;
  return undefined;
}

/** Field-level error shape used by the backend validation middleware. */
export interface ApiFieldError {
  field: string;
  message: string;
}

/**
 * Extract field-level errors from a backend ValidationError response.
 * The backend's `shared/middleware/validate.ts` ships `{ fields: [{field, message}] }`
 * — this used to be silently dropped by `parseApiError` which only read `.message`,
 * giving users a useless "Validation failed" toast. Forms should call this and
 * surface field errors inline.
 *
 * Returns an empty array when the error is not a structured validation error.
 */
export function getApiFieldErrors(error: unknown): ApiFieldError[] {
  if (!axios.isAxiosError(error)) return [];
  const fields = error.response?.data?.fields;
  if (!Array.isArray(fields)) return [];
  return fields
    .filter(
      (f): f is ApiFieldError =>
        typeof f === 'object' &&
        f !== null &&
        typeof (f as { field?: unknown }).field === 'string' &&
        typeof (f as { message?: unknown }).message === 'string',
    )
    .map((f) => ({ field: f.field, message: f.message }));
}

/**
 * Convert a backend snake_case field name to camelCase so it matches the
 * Zod/React-Hook-Form field names on the frontend. Best-effort — unmapped
 * fields are surfaced as form `root` errors via `applyFieldErrorsToForm`.
 */
function snakeToCamel(s: string): string {
  return s.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
}

/**
 * Field-error setter — a thin abstraction over react-hook-form's setError so
 * this file does not need a hard RHF dependency. Callers pass a closure that
 * calls `form.setError(name as keyof Form, ...)` to satisfy RHF's stricter
 * typed signature.
 */
type FieldErrorSetter = (name: string, message: string) => void;

/**
 * Apply backend field errors to a react-hook-form form. Fields that match
 * one of `knownFormFields` (camelCase) get set as a per-field error and
 * appear under that input via <FormMessage />. Fields that don't match get
 * folded into the form-level `root` message so the user still sees what
 * went wrong (e.g. `eligibility_session_token` → no matching form input,
 * shown as a root error).
 *
 * Aliases map backend names that don't snake→camel cleanly to the actual
 * form field, e.g. backend `email` → frontend `contactEmail` on the
 * supplier registration form. Pass {} when no aliasing is needed.
 *
 * Returns true when at least one field error was applied.
 */
export function applyFieldErrorsToForm(
  setError: FieldErrorSetter,
  fieldErrors: ApiFieldError[],
  knownFormFields: ReadonlyArray<string>,
  aliases: Record<string, string> = {},
): boolean {
  if (fieldErrors.length === 0) return false;
  const known = new Set(knownFormFields);
  const rootMessages: string[] = [];

  for (const err of fieldErrors) {
    const aliased = aliases[err.field];
    const camel = aliased ?? snakeToCamel(err.field);
    if (known.has(camel)) {
      setError(camel, err.message);
    } else {
      rootMessages.push(`${err.field}: ${err.message}`);
    }
  }

  if (rootMessages.length > 0) {
    setError('root', rootMessages.join('; '));
  }
  return true;
}
