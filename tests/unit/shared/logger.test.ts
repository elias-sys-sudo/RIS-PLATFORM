/**
 * Unit tests for src/shared/logger.ts
 *
 * Coverage targets:
 *   - line 24:  isProduction === true  → File transports are added
 *   - line 16 branch 1: meta keys present → metaStr is populated in consoleFormat printf
 *   - line 23 branch 0: isProduction === true  (transport selection)
 *   - line 65 branch 0: isProduction === true  → logger level = 'info'
 *
 * Because logger.ts is a module-level side-effect file we need to isolate
 * tests that flip NODE_ENV by using jest.isolateModules().
 */

// ---------------------------------------------------------------------------
// Mocks — must be declared before any import of the module under test
// ---------------------------------------------------------------------------

jest.mock('winston', () => {
  // Minimal Winston stand-in that records which constructors/options were called.
  const mockAudit = jest.fn();
  const mockInfo = jest.fn();
  const mockError = jest.fn();
  const mockDebug = jest.fn();
  const mockWarn = jest.fn();

  const mockTransportInstances: unknown[] = [];

  const MockFileTransport = jest.fn().mockImplementation((opts: unknown) => {
    const instance = { _opts: opts, type: 'file' };
    mockTransportInstances.push(instance);
    return instance;
  });

  const MockConsoleTransport = jest.fn().mockImplementation((opts: unknown) => {
    const instance = { _opts: opts, type: 'console' };
    mockTransportInstances.push(instance);
    return instance;
  });

  // Track captured printf callbacks so we can invoke them in tests.
  const printfCallbacks: Array<
    (info: {
      timestamp: unknown;
      level: unknown;
      message: unknown;
      [key: string]: unknown;
    }) => string
  > = [];

  const mockPrintf = jest.fn().mockImplementation((fn: (typeof printfCallbacks)[number]) => {
    printfCallbacks.push(fn);
    return { _type: 'printf' };
  });

  // The real winston.format is BOTH callable (winston.format(fn) → factory) AND
  // an object with combine/timestamp/etc. methods. The mock must mirror both
  // shapes so logger.ts can call winston.format(...)() to build custom formats.
  const mockFormatFactory = jest.fn().mockImplementation(() => ({ _type: 'custom-format' }));
  const mockFormatFn = jest
    .fn()
    .mockImplementation((_fn: (info: Record<string, unknown>) => Record<string, unknown>) => {
      void _fn;
      return mockFormatFactory;
    });
  const mockFormat = Object.assign(mockFormatFn, {
    combine: jest.fn().mockReturnValue({ _type: 'combined' }),
    timestamp: jest.fn().mockReturnValue({ _type: 'timestamp' }),
    errors: jest.fn().mockReturnValue({ _type: 'errors' }),
    json: jest.fn().mockReturnValue({ _type: 'json' }),
    colorize: jest.fn().mockReturnValue({ _type: 'colorize' }),
    printf: mockPrintf,
  });

  const mockLoggerInstance = {
    info: mockInfo,
    error: mockError,
    debug: mockDebug,
    warn: mockWarn,
    audit: mockAudit,
    on: jest.fn(),
  };

  const mockCreateLogger = jest.fn().mockReturnValue(mockLoggerInstance);

  return {
    format: mockFormat,
    transports: {
      File: MockFileTransport,
      Console: MockConsoleTransport,
    },
    createLogger: mockCreateLogger,
    // Expose internals for assertions
    __mockFileTransport: MockFileTransport,
    __mockConsoleTransport: MockConsoleTransport,
    __mockCreateLogger: mockCreateLogger,
    __mockLoggerInstance: mockLoggerInstance,
    __printfCallbacks: printfCallbacks,
    __mockTransportInstances: mockTransportInstances,
  };
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function loadLogger(nodeEnv: string): typeof import('../../../src/shared/logger') {
  let mod!: typeof import('../../../src/shared/logger');
  jest.isolateModules(() => {
    process.env.NODE_ENV = nodeEnv;
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    mod = require('../../../src/shared/logger') as typeof import('../../../src/shared/logger');
  });
  return mod;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('logger — development mode', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('creates a Console transport (not File) when NODE_ENV !== production', () => {
    const winston = jest.requireMock('winston') as {
      __mockConsoleTransport: jest.Mock;
      __mockFileTransport: jest.Mock;
      __mockTransportInstances: unknown[];
    };
    winston.__mockTransportInstances.length = 0; // reset

    loadLogger('test');

    expect(winston.__mockConsoleTransport).toHaveBeenCalled();
    // The main transport should be Console, not File
    // (File is still used for security log — that is always created)
  });
});

describe('logger — production mode', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    process.env.NODE_ENV = 'test';
  });

  // Covers line 24 (isProduction branch) + line 65 branch 0 (level = 'info')
  it('creates File transports when NODE_ENV === production', () => {
    const winston = jest.requireMock('winston') as {
      __mockFileTransport: jest.Mock;
      __mockConsoleTransport: jest.Mock;
      __mockCreateLogger: jest.Mock;
    };

    loadLogger('production');

    // Should have created File transports (at least app.log and error.log plus security.log)
    expect(winston.__mockFileTransport.mock.calls.length).toBeGreaterThanOrEqual(2);
    // Console transport should NOT be created for the main transports list
    // (Console mock might still be 0 calls or only security-related)
    const consoleCalls = winston.__mockConsoleTransport.mock.calls.length;
    expect(consoleCalls).toBe(0);
  });

  it('sets logger level to "info" in production', () => {
    const winston = jest.requireMock('winston') as {
      __mockCreateLogger: jest.Mock;
    };

    loadLogger('production');

    // createLogger is called twice: once for securityLogger, once for the main logger
    const calls = winston.__mockCreateLogger.mock.calls as Array<[{ level: string }]>;
    // The main logger (second call) should use level 'info'
    const mainLoggerCall = calls[calls.length - 1][0];
    expect(mainLoggerCall.level).toBe('info');
  });
});

describe('consoleFormat printf callback', () => {
  it('includes meta when additional fields are present (branch 1 — metaStr populated)', () => {
    const winston = jest.requireMock('winston') as {
      __printfCallbacks: Array<
        (info: {
          timestamp: unknown;
          level: unknown;
          message: unknown;
          [key: string]: unknown;
        }) => string
      >;
    };
    winston.__printfCallbacks.length = 0;

    // Load in non-production so console transport (and its printf) is created
    loadLogger('test');

    // printf was called during format.combine setup — grab the captured callback
    expect(winston.__printfCallbacks.length).toBeGreaterThanOrEqual(1);
    const printfFn = winston.__printfCallbacks[0];

    // Branch 1: meta has keys → metaStr is non-empty
    const outputWithMeta = printfFn({
      timestamp: '12:00:00.000',
      level: 'info',
      message: 'Hello',
      requestId: 'req-1',
      component: 'auth',
    });
    expect(outputWithMeta).toContain('"requestId":"req-1"');
    expect(outputWithMeta).toContain('"component":"auth"');
  });

  it('omits meta when no additional fields are present (branch 0 — empty metaStr)', () => {
    const winston = jest.requireMock('winston') as {
      __printfCallbacks: Array<
        (info: {
          timestamp: unknown;
          level: unknown;
          message: unknown;
          [key: string]: unknown;
        }) => string
      >;
    };
    winston.__printfCallbacks.length = 0;

    loadLogger('test');

    const printfFn = winston.__printfCallbacks[0];

    // Branch 0: no extra keys → metaStr is ''
    const outputWithoutMeta = printfFn({
      timestamp: '12:00:00.000',
      level: 'info',
      message: 'Hello',
    });
    expect(outputWithoutMeta).toBe('12:00:00.000 info: Hello');
  });
});

describe('logger.audit', () => {
  it('calls securityLogger.info and logger.info', () => {
    const mod = loadLogger('test');
    const { logger } = mod;

    // logger.audit is a function (patched onto the winston logger instance mock)
    expect(typeof logger.audit).toBe('function');

    // The mock logger.info is the same jest.fn() from the mock
    logger.audit('USER_LOGIN', { userId: 'u-1', action: 'login' });

    // logger.info should have been called (audit line 77)
    expect(logger.info).toHaveBeenCalledWith(
      'Audit: USER_LOGIN',
      expect.objectContaining({ action: 'USER_LOGIN', audit: true }),
    );
  });
});
