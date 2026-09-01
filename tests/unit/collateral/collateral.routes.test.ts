process.env.ENCRYPTION_KEY = 'aabbccddee11223344556677889900aabbccddee11223344556677889900aabb';
process.env.JWT_SECRET = 'test-secret-that-is-long-enough-for-256-bits-0123456789abcdef';

import { collateralRouter } from '../../../src/services/collateral/collateral.routes';

jest.mock('../../../src/shared/database/pool', () => ({
  beginWithRls: jest.fn().mockResolvedValue(undefined),
  query: jest.fn(),
  pool: { connect: jest.fn() },
}));

describe('collateral.routes', () => {
  it('exports a valid Express router', () => {
    expect(collateralRouter).toBeDefined();
    expect(typeof collateralRouter).toBe('function');
  });

  it('has all CRUD routes', () => {
    const routes =
      (
        collateralRouter as {
          stack?: { route?: { path: string; methods: Record<string, boolean> } }[];
        }
      ).stack ?? [];
    const paths = routes.map((r) => ({
      path: r.route?.path,
      methods: r.route?.methods,
    }));

    // POST /
    expect(paths.find((p) => p.path === '/' && p.methods?.post === true)).toBeDefined();
    // GET /
    expect(paths.find((p) => p.path === '/' && p.methods?.get === true)).toBeDefined();
    // GET /:id
    expect(paths.find((p) => p.path === '/:id' && p.methods?.get === true)).toBeDefined();
    // PUT /:id
    expect(paths.find((p) => p.path === '/:id' && p.methods?.put === true)).toBeDefined();
    // DELETE /:id
    expect(paths.find((p) => p.path === '/:id' && p.methods?.delete === true)).toBeDefined();
  });
});
