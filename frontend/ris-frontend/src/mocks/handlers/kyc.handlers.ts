import { http, HttpResponse, delay } from 'msw';

// ── Types ──────────────────────────────────────────────────────────────────

type KycDocType =
  | 'certificate_of_incorporation'
  | 'directors_shareholders'
  | 'tax_registration'
  | 'bank_account_details'
  | 'supplier_agreement'
  | 'board_resolution'
  | 'id_document'
  | 'additional';

interface KycDocument {
  id: string;
  type: KycDocType;
  fileName: string;
  uploadedAt: string;
  status: 'pending' | 'approved' | 'rejected';
  reviewerComments: string | null;
}

interface KycStatus {
  supplierId: string;
  overallStatus: 'pending' | 'in_progress' | 'approved' | 'rejected';
  documents: KycDocument[];
}

// Required types count (excluding 'additional') for overall status calc
const REQUIRED_TYPE_COUNT = 7;

// ── Mutable seed data (per supplierId) ─────────────────────────────────────

const kycStore: Record<string, KycStatus> = {
  usr_002: {
    supplierId: 'usr_002',
    overallStatus: 'in_progress',
    documents: [
      {
        id: 'kyc_doc_001',
        type: 'certificate_of_incorporation',
        fileName: 'KampalaTraders_CoI_2024.pdf',
        uploadedAt: '2026-02-15T10:30:00.000Z',
        status: 'approved',
        reviewerComments: null,
      },
      {
        id: 'kyc_doc_002',
        type: 'directors_shareholders',
        fileName: 'Directors_Shareholders_List.pdf',
        uploadedAt: '2026-02-15T10:32:00.000Z',
        status: 'approved',
        reviewerComments: null,
      },
      {
        id: 'kyc_doc_003',
        type: 'tax_registration',
        fileName: 'TIN_Certificate_KT.pdf',
        uploadedAt: '2026-02-15T10:35:00.000Z',
        status: 'approved',
        reviewerComments: null,
      },
      {
        id: 'kyc_doc_004',
        type: 'bank_account_details',
        fileName: 'Stanbic_Account_Confirmation.pdf',
        uploadedAt: '2026-02-15T11:00:00.000Z',
        status: 'approved',
        reviewerComments: null,
      },
      {
        id: 'kyc_doc_005',
        type: 'supplier_agreement',
        fileName: 'RIS_Supplier_Agreement_Signed.pdf',
        uploadedAt: '2026-02-16T08:30:00.000Z',
        status: 'pending',
        reviewerComments: null,
      },
      {
        id: 'kyc_doc_006',
        type: 'board_resolution',
        fileName: 'Board_Resolution_InvoiceDiscounting.pdf',
        uploadedAt: '2026-02-16T09:00:00.000Z',
        status: 'pending',
        reviewerComments: null,
      },
      {
        id: 'kyc_doc_007',
        type: 'id_document',
        fileName: 'Director_NationalID.jpg',
        uploadedAt: '2026-02-16T09:15:00.000Z',
        status: 'approved',
        reviewerComments: null,
      },
    ],
  },

  // ── Staff-view seeds (sup_* IDs from suppliers.handlers.ts) ─────────────
  // These make the "Review KYC" button on each supplier detail page land on
  // a populated review screen instead of an empty "no documents" state.

  sup_001: {
    supplierId: 'sup_001',
    overallStatus: 'approved',
    documents: [
      { id: 'kyc_sup001_001', type: 'certificate_of_incorporation', fileName: 'KMS_CoI_2019.pdf',            uploadedAt: '2025-08-04T09:10:00.000Z', status: 'approved', reviewerComments: null },
      { id: 'kyc_sup001_002', type: 'directors_shareholders',       fileName: 'KMS_Directors_List.pdf',      uploadedAt: '2025-08-04T09:15:00.000Z', status: 'approved', reviewerComments: null },
      { id: 'kyc_sup001_003', type: 'tax_registration',             fileName: 'KMS_TIN.pdf',                 uploadedAt: '2025-08-04T09:18:00.000Z', status: 'approved', reviewerComments: null },
      { id: 'kyc_sup001_004', type: 'bank_account_details',         fileName: 'KMS_Stanbic_Bank.pdf',        uploadedAt: '2025-08-04T09:22:00.000Z', status: 'approved', reviewerComments: null },
      { id: 'kyc_sup001_005', type: 'supplier_agreement',           fileName: 'KMS_RIS_Agreement.pdf',       uploadedAt: '2025-08-05T14:00:00.000Z', status: 'approved', reviewerComments: null },
      { id: 'kyc_sup001_006', type: 'board_resolution',             fileName: 'KMS_Board_Resolution.pdf',    uploadedAt: '2025-08-05T14:15:00.000Z', status: 'approved', reviewerComments: null },
      { id: 'kyc_sup001_007', type: 'id_document',                  fileName: 'KMS_Director_ID.jpg',         uploadedAt: '2025-08-05T14:18:00.000Z', status: 'approved', reviewerComments: null },
    ],
  },

  sup_002: {
    supplierId: 'sup_002',
    overallStatus: 'in_progress',
    documents: [
      { id: 'kyc_sup002_001', type: 'certificate_of_incorporation', fileName: 'KampalaMedical_CoI.pdf',      uploadedAt: '2026-03-01T10:00:00.000Z', status: 'approved', reviewerComments: null },
      { id: 'kyc_sup002_002', type: 'directors_shareholders',       fileName: 'KampalaMedical_Directors.pdf', uploadedAt: '2026-03-01T10:05:00.000Z', status: 'approved', reviewerComments: null },
      { id: 'kyc_sup002_003', type: 'tax_registration',             fileName: 'KampalaMedical_TIN.pdf',      uploadedAt: '2026-03-01T10:10:00.000Z', status: 'pending',  reviewerComments: null },
      { id: 'kyc_sup002_004', type: 'bank_account_details',         fileName: 'KampalaMedical_Bank.pdf',     uploadedAt: '2026-03-01T10:15:00.000Z', status: 'pending',  reviewerComments: null },
      { id: 'kyc_sup002_005', type: 'supplier_agreement',           fileName: 'KampalaMedical_Agreement.pdf', uploadedAt: '2026-03-02T09:00:00.000Z', status: 'pending',  reviewerComments: null },
      { id: 'kyc_sup002_006', type: 'board_resolution',             fileName: 'KampalaMedical_Board.pdf',    uploadedAt: '2026-03-02T09:10:00.000Z', status: 'pending',  reviewerComments: null },
      { id: 'kyc_sup002_007', type: 'id_document',                  fileName: 'KampalaMedical_DirID.jpg',    uploadedAt: '2026-03-02T09:20:00.000Z', status: 'pending',  reviewerComments: null },
    ],
  },

  sup_003: {
    supplierId: 'sup_003',
    overallStatus: 'rejected',
    documents: [
      { id: 'kyc_sup003_001', type: 'certificate_of_incorporation', fileName: 'NileAgro_CoI.pdf',            uploadedAt: '2025-11-10T08:00:00.000Z', status: 'approved', reviewerComments: null },
      { id: 'kyc_sup003_002', type: 'directors_shareholders',       fileName: 'NileAgro_Directors.pdf',      uploadedAt: '2025-11-10T08:30:00.000Z', status: 'rejected', reviewerComments: 'One director signature appears unsigned — please re-upload a properly executed document.' },
      { id: 'kyc_sup003_003', type: 'tax_registration',             fileName: 'NileAgro_TIN_OLD.pdf',        uploadedAt: '2025-11-10T09:00:00.000Z', status: 'rejected', reviewerComments: 'TIN certificate expired in 2024. Provide a current URA-issued TIN.' },
      { id: 'kyc_sup003_004', type: 'bank_account_details',         fileName: 'NileAgro_Bank_Blurry.pdf',    uploadedAt: '2025-11-10T09:30:00.000Z', status: 'rejected', reviewerComments: 'Bank statement is not legible. Re-upload a clear scan showing branch and account number.' },
    ],
  },

  sup_004: {
    supplierId: 'sup_004',
    overallStatus: 'in_progress',
    documents: [
      { id: 'kyc_sup004_001', type: 'certificate_of_incorporation', fileName: 'JinjaFresh_CoI.pdf',          uploadedAt: '2026-04-01T11:00:00.000Z', status: 'pending',  reviewerComments: null },
      { id: 'kyc_sup004_002', type: 'tax_registration',             fileName: 'JinjaFresh_TIN.pdf',          uploadedAt: '2026-04-01T11:05:00.000Z', status: 'pending',  reviewerComments: null },
    ],
  },

  sup_005: {
    supplierId: 'sup_005',
    overallStatus: 'rejected',
    documents: [
      { id: 'kyc_sup005_001', type: 'certificate_of_incorporation', fileName: 'GuluTech_CoI.pdf',            uploadedAt: '2021-04-18T09:00:00.000Z', status: 'approved', reviewerComments: null },
      { id: 'kyc_sup005_002', type: 'tax_registration',             fileName: 'GuluTech_TIN.pdf',            uploadedAt: '2021-04-18T09:10:00.000Z', status: 'rejected', reviewerComments: 'Sanctions screening hit — account suspended pending compliance review.' },
    ],
  },
};

// ── Helpers ────────────────────────────────────────────────────────────────

function getOrCreateKyc(supplierId: string): KycStatus {
  if (!kycStore[supplierId]) {
    kycStore[supplierId] = {
      supplierId,
      overallStatus: 'pending',
      documents: [],
    };
  }
  return kycStore[supplierId];
}

function recalcOverallStatus(kyc: KycStatus): void {
  const requiredDocs = kyc.documents.filter((d) => d.type !== 'additional');
  if (requiredDocs.length === 0) {
    kyc.overallStatus = 'pending';
    return;
  }
  const allApproved =
    requiredDocs.length >= REQUIRED_TYPE_COUNT &&
    requiredDocs.every((d) => d.status === 'approved');
  const anyRejected = requiredDocs.some((d) => d.status === 'rejected');
  if (allApproved) {
    kyc.overallStatus = 'approved';
  } else if (anyRejected) {
    kyc.overallStatus = 'rejected';
  } else {
    kyc.overallStatus = 'in_progress';
  }
}

// ── Document-comment store (Checkers §5a) ─────────────────────────────────

interface MockDocumentComment {
  id: string;
  documentId: string;
  authorRole: string;
  commentText: string;
  createdAt: string;
}

const documentCommentsStore: MockDocumentComment[] = [
  {
    id: 'dc_seed_001',
    documentId: 'kyc_doc_001',
    authorRole: 'compliance_officer',
    commentText: 'URSB certificate verified — matches registration number on file.',
    createdAt: '2026-02-16T09:10:00.000Z',
  },
  {
    id: 'dc_seed_002',
    documentId: 'kyc_doc_003',
    authorRole: 'credit_officer',
    commentText: 'Please upload the TIN printout in full colour — current copy is hard to read.',
    createdAt: '2026-02-17T14:22:00.000Z',
  },
];

// ── Handlers ───────────────────────────────────────────────────────────────

export const kycHandlers = [
  // GET /api/documents/:documentId/comments — Checkers §5a
  http.get('/api/documents/:documentId/comments', async ({ params }) => {
    await delay(200);
    const documentId = params.documentId as string;
    const comments = documentCommentsStore
      .filter((c) => c.documentId === documentId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .map(({ id, authorRole, commentText, createdAt }) => ({
        id, authorRole, commentText, createdAt,
      }));
    return HttpResponse.json({ comments });
  }),

  // POST /api/admin/suppliers/:id/feedback — Checkers §5b general feedback
  http.post('/api/admin/suppliers/:id/feedback', async ({ request }) => {
    await delay(300);
    const body = (await request.json()) as { message?: string };
    const msg = body.message?.trim() ?? '';
    if (msg.length < 10) {
      return HttpResponse.json(
        { code: 'VALIDATION_ERROR', message: 'Feedback must be at least 10 characters' },
        { status: 400 },
      );
    }
    if (msg.length > 2000) {
      return HttpResponse.json(
        { code: 'VALIDATION_ERROR', message: 'Feedback must be 2000 characters or fewer' },
        { status: 400 },
      );
    }
    return HttpResponse.json({ message: 'Feedback sent to supplier' });
  }),

  // POST /api/documents/:documentId/comments — Checkers §5a
  http.post('/api/documents/:documentId/comments', async ({ params, request }) => {
    await delay(250);
    const documentId = params.documentId as string;
    const body = (await request.json()) as { comment_text?: string };
    const text = body.comment_text?.trim() ?? '';
    if (text.length < 3) {
      return HttpResponse.json(
        { code: 'DOCUMENT_COMMENT_TOO_SHORT', message: 'Comment is too short' },
        { status: 400 },
      );
    }
    if (text.length > 2000) {
      return HttpResponse.json(
        { code: 'DOCUMENT_COMMENT_TOO_LONG', message: 'Comment exceeds 2000 chars' },
        { status: 400 },
      );
    }
    const comment: MockDocumentComment = {
      id: `dc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      documentId,
      authorRole: 'credit_officer',
      commentText: text,
      createdAt: new Date().toISOString(),
    };
    documentCommentsStore.push(comment);
    return HttpResponse.json({
      id: comment.id,
      authorRole: comment.authorRole,
      commentText: comment.commentText,
      createdAt: comment.createdAt,
    }, { status: 201 });
  }),

  // GET /api/onboarding/suppliers/:supplierId/documents/:docId/file —
  // stream a real (small) PDF blob so the dev preview shows actual content
  // instead of a placeholder. Pretend-decrypted; the real backend reads the
  // encrypted blob from disk and decrypts via shared/crypto.ts.
  http.get(
    '/api/onboarding/suppliers/:supplierId/documents/:docId/file',
    async ({ params }) => {
      await delay(150);
      const { supplierId, docId } = params as { supplierId: string; docId: string };
      const kyc = kycStore[supplierId];
      const doc = kyc?.documents.find((d) => d.id === docId);
      if (!doc) {
        return HttpResponse.json({ message: 'Document not found' }, { status: 404 });
      }

      const isImage = /\.(png|jpe?g|webp|gif)$/i.test(doc.fileName);
      if (isImage) {
        // 1×1 transparent PNG — enough for the <img> renderer to show a
        // visible (if tiny) frame. Real backend serves the full image.
        const pngBase64 =
          'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
        const bytes = Uint8Array.from(atob(pngBase64), (c) => c.charCodeAt(0));
        return new HttpResponse(bytes, {
          status: 200,
          headers: {
            'Content-Type': 'image/png',
            'Content-Disposition': `inline; filename="${doc.fileName}"`,
            'Cache-Control': 'private, max-age=0, no-store',
            'X-Content-Type-Options': 'nosniff',
          },
        });
      }

      // Minimal valid PDF that renders as a single near-blank page in any
      // PDF viewer (Chrome/Edge/Firefox built-in viewers all accept it).
      const pdfBytes = new TextEncoder().encode(
        '%PDF-1.4\n' +
          '1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n' +
          '2 0 obj<</Type/Pages/Count 1/Kids[3 0 R]>>endobj\n' +
          '3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Resources<<>>/Contents 4 0 R>>endobj\n' +
          '4 0 obj<</Length 44>>stream\n' +
          'BT /F1 24 Tf 200 400 Td (Mock KYC document) Tj ET\n' +
          'endstream\nendobj\n' +
          'xref\n0 5\n0000000000 65535 f \n0000000009 00000 n \n0000000054 00000 n \n0000000101 00000 n \n0000000178 00000 n \n' +
          'trailer<</Size 5/Root 1 0 R>>\nstartxref\n264\n%%EOF',
      );

      return new HttpResponse(pdfBytes, {
        status: 200,
        headers: {
          'Content-Type': 'application/pdf',
          'Content-Disposition': `inline; filename="${doc.fileName}"`,
          'Cache-Control': 'private, max-age=0, no-store',
          'X-Content-Type-Options': 'nosniff',
        },
      });
    },
  ),

  // GET /api/onboarding/suppliers/:supplierId/kyc — fetch KYC status
  http.get('/api/onboarding/suppliers/:supplierId/kyc', async ({ params }) => {
    await delay(300);
    const supplierId = params.supplierId as string;
    const kyc = getOrCreateKyc(supplierId);
    return HttpResponse.json<KycStatus>(kyc);
  }),

  // POST /api/onboarding/suppliers/:supplierId/documents — upload document
  http.post('/api/onboarding/suppliers/:supplierId/documents', async ({ params, request }) => {
    await delay(500);
    const supplierId = params.supplierId as string;
    const kyc = getOrCreateKyc(supplierId);

    const formData = await request.formData();
    // Backend expects 'document_type' (not 'type'). Accept both for
    // backwards-compat with any cached FE bundles.
    const type = (formData.get('document_type') ?? formData.get('type')) as KycDocType;
    const file = formData.get('file') as File | null;
    const fileName = file?.name ?? `${type}_upload.pdf`;

    // For non-additional types, replace existing (re-upload)
    // For additional, always append (allow multiple)
    if (type !== 'additional') {
      kyc.documents = kyc.documents.filter((d) => d.type !== type);
    }

    const newDoc: KycDocument = {
      id: `kyc_doc_${Date.now()}`,
      type,
      fileName,
      uploadedAt: new Date().toISOString(),
      status: 'pending',
      reviewerComments: null,
    };

    kyc.documents.push(newDoc);
    recalcOverallStatus(kyc);

    return HttpResponse.json<KycDocument>(newDoc, { status: 201 });
  }),

  // PUT /api/onboarding/admin/suppliers/:supplierId/kyc-status — review document
  http.put('/api/onboarding/admin/suppliers/:supplierId/kyc-status', async ({ params, request }) => {
    await delay(400);
    const supplierId = params.supplierId as string;
    const kyc = getOrCreateKyc(supplierId);

    const body = (await request.json()) as {
      documentId: string;
      decision: 'approved' | 'rejected';
      comments: string;
    };

    const doc = kyc.documents.find((d) => d.id === body.documentId);
    if (!doc) {
      return HttpResponse.json({ message: 'Document not found' }, { status: 404 });
    }

    doc.status = body.decision;
    doc.reviewerComments = body.comments || null;
    recalcOverallStatus(kyc);

    return new HttpResponse(null, { status: 204 });
  }),
];
