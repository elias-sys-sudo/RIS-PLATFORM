process.env.ENCRYPTION_KEY = 'aabbccddee11223344556677889900aabbccddee11223344556677889900aabb';

import * as service from '../../../src/services/documents/documents.service';
import * as repo from '../../../src/services/documents/documents.repository';
import type { ExpiringDocumentRecord } from '../../../src/services/documents/documents.types';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------
jest.mock('../../../src/shared/database/pool', () => ({
  beginWithRls: jest.fn().mockResolvedValue(undefined),
  query: jest.fn(),
  pool: { connect: jest.fn() },
}));

jest.mock('../../../src/services/documents/documents.repository');
jest.mock('../../../src/shared/crypto', () => ({
  decrypt: jest.fn((val: string) => `/storage/${val}`),
  encrypt: jest.fn(),
  hashDocument: jest.fn(),
}));
jest.mock('../../../src/shared/logger', () => ({
  logger: {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    audit: jest.fn(),
  },
}));

const mockedRepo = repo as jest.Mocked<typeof repo>;

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
function makeExpiringDoc(overrides: Partial<ExpiringDocumentRecord> = {}): ExpiringDocumentRecord {
  return {
    id: 'doc-exp-1',
    supplier_id: 'sup-1',
    document_type: 'tax_registration',
    expiry_date: '2026-04-15',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------
beforeEach(() => {
  jest.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('checkDocumentExpiry', () => {
  it('returns expiring documents and marks warnings sent', async () => {
    const docs = [
      makeExpiringDoc({ id: 'doc-1' }),
      makeExpiringDoc({ id: 'doc-2', document_type: 'director_id' }),
    ];
    mockedRepo.getDocumentsNearExpiry.mockResolvedValue(docs);
    mockedRepo.markExpiryWarningSent.mockResolvedValue();

    const result = await service.checkDocumentExpiry();

    expect(result).toHaveLength(2);
    expect(mockedRepo.getDocumentsNearExpiry).toHaveBeenCalledWith(30);
    expect(mockedRepo.markExpiryWarningSent).toHaveBeenCalledTimes(2);
    expect(mockedRepo.markExpiryWarningSent).toHaveBeenCalledWith('doc-1');
    expect(mockedRepo.markExpiryWarningSent).toHaveBeenCalledWith('doc-2');
  });

  it('returns empty array when no documents are expiring', async () => {
    mockedRepo.getDocumentsNearExpiry.mockResolvedValue([]);

    const result = await service.checkDocumentExpiry();

    expect(result).toEqual([]);
    expect(mockedRepo.markExpiryWarningSent).not.toHaveBeenCalled();
  });

  it('processes each document individually', async () => {
    const docs = [makeExpiringDoc({ id: 'doc-single' })];
    mockedRepo.getDocumentsNearExpiry.mockResolvedValue(docs);
    mockedRepo.markExpiryWarningSent.mockResolvedValue();

    const result = await service.checkDocumentExpiry();

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('doc-single');
    expect(mockedRepo.markExpiryWarningSent).toHaveBeenCalledWith('doc-single');
  });
});
