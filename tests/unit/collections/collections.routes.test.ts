process.env.JWT_SECRET = 'test-jwt-secret-that-is-long-enough-for-256-bits-0123456789abcdef';
process.env.ENCRYPTION_KEY = 'aabbccddee11223344556677889900aabbccddee11223344556677889900aabb';

import { collectionsRouter } from '../../../src/services/collections/collections.routes';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------
jest.mock('../../../src/shared/logger', () => ({
  logger: {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    audit: jest.fn(),
    debug: jest.fn(),
  },
}));

// ===========================================================================
// Router Configuration
// ===========================================================================

describe('collectionsRouter', () => {
  it('is a valid Express router', () => {
    expect(collectionsRouter).toBeDefined();
    expect(typeof collectionsRouter).toBe('function');
  });

  it('has GET /overdue route', () => {
    const routes = (
      collectionsRouter as unknown as {
        stack: Array<{ route?: { path: string; methods: Record<string, boolean> } }>;
      }
    ).stack
      .filter((layer) => layer.route)
      .map((layer) => ({
        path: layer.route!.path,
        methods: layer.route!.methods,
      }));

    const overdueRoute = routes.find((r) => r.path === '/overdue');
    expect(overdueRoute).toBeDefined();
    expect(overdueRoute!.methods.get).toBe(true);
  });

  it('has POST /:id/record-payment route', () => {
    const routes = (
      collectionsRouter as unknown as {
        stack: Array<{ route?: { path: string; methods: Record<string, boolean> } }>;
      }
    ).stack
      .filter((layer) => layer.route)
      .map((layer) => ({
        path: layer.route!.path,
        methods: layer.route!.methods,
      }));

    const paymentRoute = routes.find((r) => r.path === '/:id/record-payment');
    expect(paymentRoute).toBeDefined();
    expect(paymentRoute!.methods.post).toBe(true);
  });

  it('has GET /:invoiceId/penalty route', () => {
    const routes = (
      collectionsRouter as unknown as {
        stack: Array<{ route?: { path: string; methods: Record<string, boolean> } }>;
      }
    ).stack
      .filter((layer) => layer.route)
      .map((layer) => ({
        path: layer.route!.path,
        methods: layer.route!.methods,
      }));

    const penaltyRoute = routes.find((r) => r.path === '/:invoiceId/penalty');
    expect(penaltyRoute).toBeDefined();
    expect(penaltyRoute!.methods.get).toBe(true);
  });
});
