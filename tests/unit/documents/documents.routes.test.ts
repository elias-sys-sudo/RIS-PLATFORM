process.env.ENCRYPTION_KEY = 'aabbccddee11223344556677889900aabbccddee11223344556677889900aabb';
process.env.JWT_SECRET = 'test-secret-that-is-long-enough-for-256-bits-0123456789abcdef';

import { documentsRouter } from '../../../src/services/documents/documents.routes';

jest.mock('../../../src/shared/database/pool', () => ({
  beginWithRls: jest.fn().mockResolvedValue(undefined),
  query: jest.fn(),
  pool: { connect: jest.fn() },
}));

describe('documents.routes', () => {
  it('exports a valid Express router', () => {
    expect(documentsRouter).toBeDefined();
    expect(typeof documentsRouter).toBe('function');
  });

  it('has GET /:document_id/download route', () => {
    const routes =
      (
        documentsRouter as {
          stack?: { route?: { path: string; methods: Record<string, boolean> } }[];
        }
      ).stack ?? [];
    const downloadRoute = routes.find((r) => r.route?.path === '/:document_id/download');
    expect(downloadRoute).toBeDefined();
    expect(downloadRoute?.route?.methods.get).toBe(true);
  });
});
