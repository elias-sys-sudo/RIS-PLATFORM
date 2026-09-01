process.env.ENCRYPTION_KEY = 'aabbccddee11223344556677889900aabbccddee11223344556677889900aabb';

jest.mock('../../../src/shared/database/pool', () => ({
  beginWithRls: jest.fn().mockResolvedValue(undefined),
  query: jest.fn(),
  pool: { connect: jest.fn() },
}));

jest.mock('../../../src/services/documents/documents.service');

import type { Request, Response, NextFunction } from 'express';
import { Readable } from 'stream';
import { downloadHandler } from '../../../src/services/documents/documents.controller';
import * as service from '../../../src/services/documents/documents.service';
import { NotFoundError, ForbiddenError, BusinessRuleError } from '../../../src/shared/errors';
import type { DocumentRecord } from '../../../src/services/documents/documents.types';

const mockedService = service as jest.Mocked<typeof service>;

function buildDoc(overrides: Partial<DocumentRecord> = {}): DocumentRecord {
  return {
    id: 'doc-1',
    invoice_id: 'inv-1',
    supplier_id: 'sup-1',
    document_type: 'invoice',
    encrypted_path: 'encrypted/path.pdf',
    file_hash: 'abcdef123456',
    file_size_bytes: 2048,
    mime_type: 'application/pdf',
    uploaded_by: 'user-1',
    created_at: '2025-01-01T00:00:00Z',
    expiry_date: null,
    ...overrides,
  };
}

interface MockRes {
  status: jest.Mock;
  json: jest.Mock;
  setHeader: jest.Mock;
  headersSent: boolean;
}

function buildMocks(): {
  req: Request;
  res: Response;
  next: NextFunction;
  rawRes: MockRes;
} {
  const rawRes: MockRes = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn(),
    setHeader: jest.fn(),
    headersSent: false,
  };

  const req = {
    params: { document_id: 'doc-1' },
    user: { userId: 'u-1', role: 'management', sessionId: 's-1' },
    ip: '127.0.0.1',
    get: jest.fn().mockReturnValue('test-agent'),
  } as unknown as Request;

  const res = rawRes as unknown as Response;
  const next = jest.fn() as NextFunction;

  return { req, res, next, rawRes };
}

function buildMockStream(): Readable {
  const stream = new Readable({
    read() {
      this.push(null);
    },
  });
  stream.pipe = jest.fn().mockReturnValue(stream);
  stream.on = jest.fn().mockReturnValue(stream);
  return stream;
}

describe('documents.controller — downloadHandler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns 404 when createFileStream returns null', async () => {
    const { req, res, next } = buildMocks();
    const doc = buildDoc();
    mockedService.getDocumentForDownload.mockResolvedValue({
      doc,
      filePath: '/storage/path.pdf',
    });
    mockedService.createFileStream.mockReturnValue(null);

    await downloadHandler(req, res, next);

    expect((res as unknown as MockRes).status).toHaveBeenCalledWith(404);
    expect((res as unknown as MockRes).json).toHaveBeenCalledWith({
      error: 'File not found on storage',
    });
  });

  it('sets Content-Type header from doc.mime_type', async () => {
    const { req, res, next } = buildMocks();
    const doc = buildDoc({ mime_type: 'image/png' });
    const mockStream = buildMockStream();

    mockedService.getDocumentForDownload.mockResolvedValue({
      doc,
      filePath: '/storage/photo.png',
    });
    mockedService.createFileStream.mockReturnValue(
      mockStream as unknown as ReturnType<typeof service.createFileStream>,
    );

    await downloadHandler(req, res, next);

    expect((res as unknown as MockRes).setHeader).toHaveBeenCalledWith('Content-Type', 'image/png');
  });

  it('sets Content-Disposition with correct filename', async () => {
    const { req, res, next } = buildMocks();
    const doc = buildDoc({ document_type: 'purchase_order' });
    const mockStream = buildMockStream();

    mockedService.getDocumentForDownload.mockResolvedValue({
      doc,
      filePath: '/storage/file.pdf',
    });
    mockedService.createFileStream.mockReturnValue(
      mockStream as unknown as ReturnType<typeof service.createFileStream>,
    );

    await downloadHandler(req, res, next);

    expect((res as unknown as MockRes).setHeader).toHaveBeenCalledWith(
      'Content-Disposition',
      'attachment; filename="purchase_order.pdf"',
    );
  });

  it('sets Content-Length header from doc.file_size_bytes', async () => {
    const { req, res, next } = buildMocks();
    const doc = buildDoc({ file_size_bytes: 9999 });
    const mockStream = buildMockStream();

    mockedService.getDocumentForDownload.mockResolvedValue({
      doc,
      filePath: '/storage/file.pdf',
    });
    mockedService.createFileStream.mockReturnValue(
      mockStream as unknown as ReturnType<typeof service.createFileStream>,
    );

    await downloadHandler(req, res, next);

    expect((res as unknown as MockRes).setHeader).toHaveBeenCalledWith('Content-Length', '9999');
  });

  it('pipes stream to response', async () => {
    const { req, res, next } = buildMocks();
    const doc = buildDoc();
    const mockStream = buildMockStream();

    mockedService.getDocumentForDownload.mockResolvedValue({
      doc,
      filePath: '/storage/file.pdf',
    });
    mockedService.createFileStream.mockReturnValue(
      mockStream as unknown as ReturnType<typeof service.createFileStream>,
    );

    await downloadHandler(req, res, next);

    expect(mockStream.pipe).toHaveBeenCalledWith(res);
  });

  it('registers error handler on stream', async () => {
    const { req, res, next } = buildMocks();
    const doc = buildDoc();
    const mockStream = buildMockStream();

    mockedService.getDocumentForDownload.mockResolvedValue({
      doc,
      filePath: '/storage/file.pdf',
    });
    mockedService.createFileStream.mockReturnValue(
      mockStream as unknown as ReturnType<typeof service.createFileStream>,
    );

    await downloadHandler(req, res, next);

    expect(mockStream.on).toHaveBeenCalledWith('error', expect.any(Function));
  });

  it('stream error calls next when headers not sent', async () => {
    const { req, res, next, rawRes } = buildMocks();
    const doc = buildDoc();
    const mockStream = buildMockStream();

    // Capture the error handler
    let errorHandler: ((err: Error) => void) | undefined;
    mockStream.on = jest.fn().mockImplementation((event: string, handler: (err: Error) => void) => {
      if (event === 'error') {
        errorHandler = handler;
      }
      return mockStream;
    });

    mockedService.getDocumentForDownload.mockResolvedValue({
      doc,
      filePath: '/storage/file.pdf',
    });
    mockedService.createFileStream.mockReturnValue(
      mockStream as unknown as ReturnType<typeof service.createFileStream>,
    );

    await downloadHandler(req, res, next);

    rawRes.headersSent = false;
    const streamErr = new Error('stream broke');
    errorHandler!(streamErr);

    expect(next).toHaveBeenCalledWith(streamErr);
  });

  it('stream error does not call next when headers already sent', async () => {
    const { req, res, next, rawRes } = buildMocks();
    const doc = buildDoc();
    const mockStream = buildMockStream();

    let errorHandler: ((err: Error) => void) | undefined;
    mockStream.on = jest.fn().mockImplementation((event: string, handler: (err: Error) => void) => {
      if (event === 'error') {
        errorHandler = handler;
      }
      return mockStream;
    });

    mockedService.getDocumentForDownload.mockResolvedValue({
      doc,
      filePath: '/storage/file.pdf',
    });
    mockedService.createFileStream.mockReturnValue(
      mockStream as unknown as ReturnType<typeof service.createFileStream>,
    );

    await downloadHandler(req, res, next);

    rawRes.headersSent = true;
    errorHandler!(new Error('stream broke'));

    // next should not be called since headers were already sent
    expect(next).not.toHaveBeenCalled();
  });

  it('forwards NotFoundError from service to next', async () => {
    const { req, res, next } = buildMocks();
    const err = new NotFoundError('Document', 'doc-1');
    mockedService.getDocumentForDownload.mockRejectedValue(err);

    await downloadHandler(req, res, next);

    expect(next).toHaveBeenCalledWith(err);
  });

  it('forwards ForbiddenError from service to next', async () => {
    const { req, res, next } = buildMocks();
    const err = new ForbiddenError('Access denied to this document');
    mockedService.getDocumentForDownload.mockRejectedValue(err);

    await downloadHandler(req, res, next);

    expect(next).toHaveBeenCalledWith(err);
  });

  it('forwards BusinessRuleError from service to next', async () => {
    const { req, res, next } = buildMocks();
    const err = new BusinessRuleError('RATE_LIMIT_EXCEEDED', 'Download rate limit exceeded');
    mockedService.getDocumentForDownload.mockRejectedValue(err);

    await downloadHandler(req, res, next);

    expect(next).toHaveBeenCalledWith(err);
  });

  it('uses empty userId/role when req.user is undefined', async () => {
    const { res, next } = buildMocks();
    const reqNoUser = {
      params: { document_id: 'doc-1' },
      user: undefined,
      ip: '127.0.0.1',
      get: jest.fn().mockReturnValue('test-agent'),
    } as unknown as Request;

    const doc = buildDoc();
    const mockStream = buildMockStream();

    mockedService.getDocumentForDownload.mockResolvedValue({
      doc,
      filePath: '/storage/file.pdf',
    });
    mockedService.createFileStream.mockReturnValue(
      mockStream as unknown as ReturnType<typeof service.createFileStream>,
    );

    await downloadHandler(reqNoUser, res, next);

    expect(mockedService.getDocumentForDownload).toHaveBeenCalledWith(
      'doc-1',
      '',
      '',
      '127.0.0.1',
      'test-agent',
    );
  });

  it('uses "unknown" when req.ip is undefined', async () => {
    const { res, next } = buildMocks();
    const reqNoIp = {
      params: { document_id: 'doc-1' },
      user: { userId: 'u-1', role: 'management', sessionId: 's-1' },
      ip: undefined,
      get: jest.fn().mockReturnValue('test-agent'),
    } as unknown as Request;

    const doc = buildDoc();
    const mockStream = buildMockStream();

    mockedService.getDocumentForDownload.mockResolvedValue({
      doc,
      filePath: '/storage/file.pdf',
    });
    mockedService.createFileStream.mockReturnValue(
      mockStream as unknown as ReturnType<typeof service.createFileStream>,
    );

    await downloadHandler(reqNoIp, res, next);

    expect(mockedService.getDocumentForDownload).toHaveBeenCalledWith(
      'doc-1',
      'u-1',
      'management',
      'unknown',
      'test-agent',
    );
  });

  it('uses "unknown" when req.get("user-agent") returns undefined', async () => {
    const { res, next } = buildMocks();
    const reqNoUa = {
      params: { document_id: 'doc-1' },
      user: { userId: 'u-1', role: 'management', sessionId: 's-1' },
      ip: '10.0.0.1',
      get: jest.fn().mockReturnValue(undefined),
    } as unknown as Request;

    const doc = buildDoc();
    const mockStream = buildMockStream();

    mockedService.getDocumentForDownload.mockResolvedValue({
      doc,
      filePath: '/storage/file.pdf',
    });
    mockedService.createFileStream.mockReturnValue(
      mockStream as unknown as ReturnType<typeof service.createFileStream>,
    );

    await downloadHandler(reqNoUa, res, next);

    expect(mockedService.getDocumentForDownload).toHaveBeenCalledWith(
      'doc-1',
      'u-1',
      'management',
      '10.0.0.1',
      'unknown',
    );
  });

  it('uses fallback .bin extension when filePath has no extension', async () => {
    const { req, res, next } = buildMocks();
    const doc = buildDoc({ document_type: 'receipt' });
    const mockStream = buildMockStream();

    mockedService.getDocumentForDownload.mockResolvedValue({
      doc,
      filePath: '/storage/noext',
    });
    mockedService.createFileStream.mockReturnValue(
      mockStream as unknown as ReturnType<typeof service.createFileStream>,
    );

    await downloadHandler(req, res, next);

    expect((res as unknown as MockRes).setHeader).toHaveBeenCalledWith(
      'Content-Disposition',
      'attachment; filename="receipt.bin"',
    );
  });
});
