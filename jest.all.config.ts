import type { Config } from 'jest';

/**
 * Combined Jest config — runs BOTH unit and integration tests with merged coverage.
 * Uses the integration test's globalSetup/teardown for DB lifecycle.
 * Unit tests are unaffected (they mock the DB).
 */
const config: Config = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/tests'],
  testMatch: ['**/*.test.ts'],
  globalSetup: '<rootDir>/tests/integration/global-setup.ts',
  globalTeardown: '<rootDir>/tests/integration/global-teardown.ts',
  setupFiles: ['<rootDir>/tests/integration/env-setup.ts'],
  testTimeout: 30000,
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/server.ts',
    '!src/shared/database/migrations/**',
    '!src/shared/database/seeds/**',
  ],
  coverageDirectory: 'coverage-all',
  moduleFileExtensions: ['ts', 'js', 'json'],
  transform: {
    '^.+\\.ts$': 'ts-jest',
  },
};

export default config;
