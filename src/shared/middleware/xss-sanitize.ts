import type { Request, Response, NextFunction } from 'express';

// =============================================================================
// XSS Sanitization Middleware
// =============================================================================
// Strategy: Server-side input sanitisation for all POST/PUT/PATCH request bodies.
// This is a backend JSON API — no legitimate field should contain HTML tags.
// We strip HTML angle brackets and common XSS vectors from all string values.
//
// Whitelist: Fields listed in RICH_TEXT_FIELDS may contain angle brackets
// (e.g., for rich text notes) and are sanitised with a lighter touch.
// =============================================================================

/** Fields that may contain limited markup — sanitised less aggressively. */
const RICH_TEXT_FIELDS = new Set<string>(['notes', 'description']);

/**
 * Strip dangerous HTML/script patterns from a string.
 * Removes <script>, <img onerror=>, javascript: URIs, and event handlers.
 */
function sanitizeString(value: string): string {
  return value
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, '')
    .replace(/javascript\s*:/gi, '')
    .replace(/on\w+\s*=/gi, '')
    .replace(/<[^>]*>/g, '');
}

/**
 * Light sanitisation for rich text fields — only remove script/iframe tags.
 */
function sanitizeRichText(value: string): string {
  return value
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, '')
    .replace(/javascript\s*:/gi, '')
    .replace(/on\w+\s*=/gi, '');
}

/**
 * Recursively sanitise all string values in an object or array.
 */
function sanitizeValue(value: unknown, fieldName?: string): unknown {
  if (typeof value === 'string') {
    if (fieldName !== undefined && fieldName !== '' && RICH_TEXT_FIELDS.has(fieldName)) {
      return sanitizeRichText(value);
    }
    return sanitizeString(value);
  }

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeValue(item, fieldName));
  }

  if (value !== null && typeof value === 'object') {
    const sanitised: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      sanitised[key] = sanitizeValue(val, key);
    }
    return sanitised;
  }

  return value;
}

/**
 * Express middleware: sanitises all string fields in req.body
 * for POST, PUT, and PATCH requests.
 */
export function xssSanitizeMiddleware(req: Request, _res: Response, next: NextFunction): void {
  if (
    ['POST', 'PUT', 'PATCH'].includes(req.method) &&
    req.body !== undefined &&
    req.body !== null
  ) {
    req.body = sanitizeValue(req.body) as Record<string, unknown>;
  }
  next();
}
