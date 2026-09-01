process.env.ENCRYPTION_KEY = 'aabbccddee11223344556677889900aabbccddee11223344556677889900aabb';

import fs from 'fs';
import path from 'path';
import * as service from '../../../src/services/documents/documents.service';
import * as repo from '../../../src/services/documents/documents.repository';
import { NotFoundError, ForbiddenError, BusinessRuleError } from '../../../src/shared/errors';
import type { DocumentRecord } from '../../../src/services/documents/documents.types';

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

const mockedRepo = repo as jest.Mocked<typeof repo>;

const TEST_IP = '127.0.0.1';
const TEST_UA = 'jest-test-agent';

function buildDoc(overrides: Partial<DocumentRecord> = {}): DocumentRecord {
  return {
    id: 'doc-1',
    invoice_id: 'inv-1',
    supplier_id: 'sup-1',
    document_type: 'invoice',
    encrypted_path: 'encrypted/path.pdf',
    file_hash: 'abcdef123456',
    file_size_bytes: 1024,
    mime_type: 'application/pdf',
    uploaded_by: 'user-1',
    created_at: '2025-01-01T00:00:00Z',
    expiry_date: null,
    ...overrides,
  };
}

describe('documents.service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('getDocumentForDownload', () => {
    it('returns document and decrypted file path', async () => {
      const doc = buildDoc();
      mockedRepo.getDocumentById.mockResolvedValue(doc);
      mockedRepo.validateDocumentAccess.mockResolvedValue(true);
      mockedRepo.countRecentDownloads.mockResolvedValue(5);
      mockedRepo.logDownload.mockResolvedValue();

      const result = await service.getDocumentForDownload(
        'doc-1',
        'user-1',
        'finance_manager',
        TEST_IP,
        TEST_UA,
      );

      expect(result.doc.id).toBe('doc-1');
      expect(result.filePath).toContain('/storage/');
    });

    it('throws NotFoundError when document does not exist', async () => {
      mockedRepo.getDocumentById.mockResolvedValue(null);

      await expect(
        service.getDocumentForDownload('no-exist', 'user-1', 'supplier', TEST_IP, TEST_UA),
      ).rejects.toThrow(NotFoundError);
    });

    it('throws ForbiddenError when user lacks access', async () => {
      mockedRepo.getDocumentById.mockResolvedValue(buildDoc());
      mockedRepo.validateDocumentAccess.mockResolvedValue(false);

      await expect(
        service.getDocumentForDownload('doc-1', 'user-1', 'supplier', TEST_IP, TEST_UA),
      ).rejects.toThrow(ForbiddenError);
    });

    it('throws BusinessRuleError for unsupported MIME type', async () => {
      mockedRepo.getDocumentById.mockResolvedValue(buildDoc({ mime_type: 'application/zip' }));
      mockedRepo.validateDocumentAccess.mockResolvedValue(true);

      await expect(
        service.getDocumentForDownload('doc-1', 'user-1', 'finance_manager', TEST_IP, TEST_UA),
      ).rejects.toThrow(BusinessRuleError);
    });

    it('throws BusinessRuleError when rate limit exceeded', async () => {
      mockedRepo.getDocumentById.mockResolvedValue(buildDoc());
      mockedRepo.validateDocumentAccess.mockResolvedValue(true);
      mockedRepo.countRecentDownloads.mockResolvedValue(100);

      await expect(
        service.getDocumentForDownload('doc-1', 'user-1', 'finance_manager', TEST_IP, TEST_UA),
      ).rejects.toThrow(BusinessRuleError);
    });

    it('logs download in audit trail', async () => {
      mockedRepo.getDocumentById.mockResolvedValue(buildDoc());
      mockedRepo.validateDocumentAccess.mockResolvedValue(true);
      mockedRepo.countRecentDownloads.mockResolvedValue(0);
      mockedRepo.logDownload.mockResolvedValue();

      await service.getDocumentForDownload('doc-1', 'user-1', 'finance_manager', TEST_IP, TEST_UA);

      expect(mockedRepo.logDownload).toHaveBeenCalledWith('user-1', 'doc-1', TEST_IP, TEST_UA);
    });

    it.each([
      ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'docx'],
      ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'xlsx'],
      ['image/png', 'png'],
      ['image/jpeg', 'jpg'],
    ])('allows download for MIME type %s (%s)', async (mimeType) => {
      mockedRepo.getDocumentById.mockResolvedValue(buildDoc({ mime_type: mimeType }));
      mockedRepo.validateDocumentAccess.mockResolvedValue(true);
      mockedRepo.countRecentDownloads.mockResolvedValue(0);
      mockedRepo.logDownload.mockResolvedValue();

      const result = await service.getDocumentForDownload(
        'doc-1',
        'user-1',
        'finance_manager',
        TEST_IP,
        TEST_UA,
      );

      expect(result.doc.mime_type).toBe(mimeType);
      expect(result.filePath).toContain('/storage/');
    });

    it('succeeds at 99 downloads (boundary below limit)', async () => {
      mockedRepo.getDocumentById.mockResolvedValue(buildDoc());
      mockedRepo.validateDocumentAccess.mockResolvedValue(true);
      mockedRepo.countRecentDownloads.mockResolvedValue(99);
      mockedRepo.logDownload.mockResolvedValue();

      const result = await service.getDocumentForDownload(
        'doc-1',
        'user-1',
        'finance_manager',
        TEST_IP,
        TEST_UA,
      );

      expect(result.doc.id).toBe('doc-1');
    });

    it('fails at exactly 100 downloads (boundary at limit)', async () => {
      mockedRepo.getDocumentById.mockResolvedValue(buildDoc());
      mockedRepo.validateDocumentAccess.mockResolvedValue(true);
      mockedRepo.countRecentDownloads.mockResolvedValue(100);

      await expect(
        service.getDocumentForDownload('doc-1', 'user-1', 'finance_manager', TEST_IP, TEST_UA),
      ).rejects.toThrow(BusinessRuleError);
    });
  });

  describe('createFileStream', () => {
    it('returns null for non-existent file', () => {
      const stream = service.createFileStream('/non/existent/path.pdf');
      expect(stream).toBeNull();
    });

    it('returns a ReadStream for a file that exists', () => {
      const existingFile = path.resolve(__dirname, '../../../package.json');
      const stream = service.createFileStream(existingFile);

      expect(stream).not.toBeNull();
      expect(stream).toBeInstanceOf(fs.ReadStream);
      stream?.destroy();
    });
  });
});
