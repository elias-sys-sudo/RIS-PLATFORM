import winston from 'winston';
import path from 'path';
import { getRequestId } from './context';

const isProduction = process.env.NODE_ENV === 'production';

/**
 * Winston format that reads the request_id out of the AsyncLocalStorage
 * request context and attaches it to every log entry's metadata. Runs first
 * in the format chain so downstream formats (json, printf) include it.
 *
 * Outside any request scope (server startup, untracked background jobs)
 * `getRequestId()` is undefined and the field is omitted.
 */
const injectRequestId = winston.format((info) => {
  const requestId = getRequestId();
  if (requestId !== undefined) {
    info.request_id = requestId;
  }
  return info;
})();

const logFormat = winston.format.combine(
  injectRequestId,
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss.SSS' }),
  winston.format.errors({ stack: false }),
  winston.format.json(),
);

const consoleFormat = winston.format.combine(
  injectRequestId,
  winston.format.timestamp({ format: 'HH:mm:ss.SSS' }),
  winston.format.colorize(),
  winston.format.printf(({ timestamp, level, message, ...meta }) => {
    const metaStr = Object.keys(meta).length > 0 ? ` ${JSON.stringify(meta)}` : '';
    return `${String(timestamp)} ${level}: ${String(message)}${metaStr}`;
  }),
);

const transports: winston.transport[] = [];

if (isProduction) {
  transports.push(
    new winston.transports.File({
      filename: path.join('logs', 'app.log'),
      maxsize: 10 * 1024 * 1024,
      maxFiles: 10,
      format: logFormat,
    }),
    new winston.transports.File({
      filename: path.join('logs', 'error.log'),
      level: 'error',
      maxsize: 10 * 1024 * 1024,
      maxFiles: 10,
      format: logFormat,
    }),
  );
} else {
  transports.push(
    new winston.transports.Console({
      format: consoleFormat,
    }),
  );
}

/**
 * Security audit log transport — separate file for audit events.
 * Used by logger.audit() for compliance-critical events.
 */
const securityTransport = new winston.transports.File({
  filename: path.join('logs', 'security.log'),
  maxsize: 10 * 1024 * 1024,
  maxFiles: 20,
  format: logFormat,
});

const securityLogger = winston.createLogger({
  level: 'info',
  transports: [securityTransport],
  defaultMeta: { service: 'ris-platform', logType: 'security' },
});

// ── PII sanitizer — prevents accidental PII leakage in audit logs ────────────

const PII_FIELD_NAMES = new Set([
  'email',
  'phone',
  'name',
  'bankAccount',
  'msisdn',
  'tin',
  'accountNumber',
  'supplierName',
  'buyerName',
  'buyerEmail',
  'phoneNumber',
  'bankAccountNumber',
  'companyName',
  'fullName',
  'contactEmail',
  'contactPhone',
  'idNumber',
  'taxId',
]);

function sanitizeMetadata(meta: Record<string, unknown>): Record<string, unknown> {
  const clean: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(meta)) {
    if (PII_FIELD_NAMES.has(key)) {
      clean[key] = '[REDACTED]';
    } else {
      clean[key] = value;
    }
  }
  return clean;
}

export const logger = winston.createLogger({
  level: isProduction ? 'info' : 'debug',
  transports,
  defaultMeta: { service: 'ris-platform' },
  exitOnError: false,
});

/**
 * Log a security/audit event to the dedicated security log file.
 * Never include PII — log action identifiers and record IDs only.
 */
logger.audit = function auditLog(action: string, metadata: Record<string, unknown>): void {
  const safe = sanitizeMetadata(metadata);
  securityLogger.info(action, { ...safe, action });
  logger.info(`Audit: ${action}`, { ...safe, action, audit: true });
};

declare module 'winston' {
  interface Logger {
    audit: (action: string, metadata: Record<string, unknown>) => void;
  }
}
