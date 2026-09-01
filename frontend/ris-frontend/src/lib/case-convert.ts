/**
 * Utilities for recursively converting object keys between snake_case and camelCase.
 *
 * These are wired into the Axios interceptors so that:
 *   - All API responses have their keys converted to camelCase before reaching components.
 *   - All outgoing request bodies have their keys converted to snake_case before hitting the backend.
 *
 * Skipped without modification: Date, FormData, null, undefined, and primitives.
 */

/** Converts a single snake_case string to camelCase.
 *  Strips the leading underscore before letters AND digits so trailing
 *  numeric suffixes round-trip via deepCamelCase — e.g. the backend's
 *  `dual_auth_user_1` arrives as `dualAuthUser1`, not `dualAuthUser_1`.
 */
function snakeToCamel(str: string): string {
  return str.replace(/_([a-z0-9])/g, (_match, c: string) => c.toUpperCase());
}

/** Converts a single camelCase string to snake_case.
 *  Note: digit-suffix camel keys (e.g. `dualAuthUser1`) are NOT explicitly
 *  re-underscored back to `dual_auth_user_1` — they would become
 *  `dual_auth_user1`. The asymmetry is intentional: outgoing request
 *  bodies in this codebase never contain digit-suffix camel keys (those
 *  are read-only fields returned by the backend), and the alternative
 *  rule that would handle them also corrupts identifiers where the digit
 *  is part of a word (`tier3Escalations` would lose its `tier3` token).
 */
function camelToSnake(str: string): string {
  return str.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
}

/**
 * Recursively converts all object keys from snake_case to camelCase.
 *
 * - Arrays: each element is converted recursively.
 * - Date / FormData: returned as-is (never modified).
 * - null / undefined: returned as-is.
 * - Primitives (string, number, boolean): returned as-is.
 */
export function deepCamelCase(obj: unknown): unknown {
  if (obj === null || obj === undefined) return obj;
  if (obj instanceof Date) return obj;
  if (obj instanceof FormData) return obj;
  if (Array.isArray(obj)) return obj.map(deepCamelCase);
  if (typeof obj === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      result[snakeToCamel(key)] = deepCamelCase(value);
    }
    return result;
  }
  return obj;
}

/**
 * Recursively converts all object keys from camelCase to snake_case.
 *
 * - Arrays: each element is converted recursively.
 * - Date / FormData: returned as-is (never modified).
 * - null / undefined: returned as-is.
 * - Primitives (string, number, boolean): returned as-is.
 */
export function deepSnakeCase(obj: unknown): unknown {
  if (obj === null || obj === undefined) return obj;
  if (obj instanceof Date) return obj;
  if (obj instanceof FormData) return obj;
  if (Array.isArray(obj)) return obj.map(deepSnakeCase);
  if (typeof obj === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      result[camelToSnake(key)] = deepSnakeCase(value);
    }
    return result;
  }
  return obj;
}
