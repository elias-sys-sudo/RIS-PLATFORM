process.env.ENCRYPTION_KEY = 'aabbccddee11223344556677889900aabbccddee11223344556677889900aabb';
process.env.JWT_SECRET = 'test-secret-that-is-long-enough-for-256-bits-0123456789abcdef';

import {
  dashboardRouter,
  paymentHistoryRouter,
} from '../../../src/services/dashboard/dashboard.routes';

jest.mock('../../../src/shared/database/pool', () => ({
  beginWithRls: jest.fn().mockResolvedValue(undefined),
  query: jest.fn(),
  pool: { connect: jest.fn() },
}));

describe('dashboard.routes', () => {
  describe('dashboardRouter', () => {
    it('exports a valid Express router', () => {
      expect(dashboardRouter).toBeDefined();
      expect(typeof dashboardRouter).toBe('function');
    });

    it('has GET /summary route', () => {
      const routes =
        (
          dashboardRouter as {
            stack?: { route?: { path: string; methods: Record<string, boolean> } }[];
          }
        ).stack ?? [];
      const summaryRoute = routes.find((r) => r.route?.path === '/summary');
      expect(summaryRoute).toBeDefined();
      expect(summaryRoute?.route?.methods.get).toBe(true);
    });
  });

  describe('paymentHistoryRouter', () => {
    it('exports a valid Express router', () => {
      expect(paymentHistoryRouter).toBeDefined();
      expect(typeof paymentHistoryRouter).toBe('function');
    });

    it('has GET / route', () => {
      const routes =
        (
          paymentHistoryRouter as {
            stack?: { route?: { path: string; methods: Record<string, boolean> } }[];
          }
        ).stack ?? [];
      const historyRoute = routes.find((r) => r.route?.path === '/');
      expect(historyRoute).toBeDefined();
      expect(historyRoute?.route?.methods.get).toBe(true);
    });
  });
});
