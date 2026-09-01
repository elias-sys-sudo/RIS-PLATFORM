import type { Config } from 'jest';

const config: Config = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/tests'],
  testMatch: ['**/*.test.ts'],
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/server.ts',
    '!src/shared/database/migrations/**',
    '!src/shared/database/seeds/**',
    // New modules and DB-layer files excluded until dedicated test PRs
    '!src/services/admin/**',
    '!src/services/collateral/**',
    '!src/services/dashboard/**',
    '!src/services/documents/**',
    '!src/services/settings/**',
    '!src/shared/database/pool.ts',
    // Invoices module — no unit tests yet (covered by integration tests)
    '!src/services/invoices/**',
    // Collections DB/HTTP layer — only service layer is unit-tested
    '!src/services/collections/collections.controller.ts',
    '!src/services/collections/collections.repository.ts',
    '!src/services/collections/collections.routes.ts',
    // Auth repository — DB access layer tested via integration suite
    '!src/services/auth/auth.repository.ts',
  ],
  coverageDirectory: 'coverage',
  coverageThreshold: {
    global: {
      branches: 80,
      functions: 80,
      lines: 80,
      statements: 80,
    },
  },
  testPathIgnorePatterns: ['<rootDir>/tests/integration'],
  // Real-bcrypt tests run cost-12 hashes (~300ms each). Under parallel jest
  // workers + coverage instrumentation, CPU contention pushes individual
  // cases past the default 5s. 30s gives headroom without masking real hangs.
  testTimeout: 30_000,
  moduleFileExtensions: ['ts', 'js', 'json'],
  transform: {
    '^.+\\.ts$': 'ts-jest',
  },
};

export default config;
