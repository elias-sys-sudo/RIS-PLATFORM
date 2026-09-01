import { http, HttpResponse, delay } from 'msw';
// Note: mock data uses snake_case to simulate backend responses.
// The axios deepCamelCase interceptor converts to camelCase for components.

/**
 * Mock-internal collateral item shape — uses snake_case to simulate a real
 * backend response.  The axios deepCamelCase interceptor converts these keys
 * to camelCase before the component ever sees them.
 */
export interface CollateralMockItem {
  id:              string;
  invoice_id:      string;
  type:            string;
  description:     string;
  estimated_value: number;
  expiry_date:     string | null;
  status:          string;
  documents:       Record<string, unknown>[];
  created_at:      string;
  updated_at:      string;
}

// ── Seed data ─────────────────────────────────────────────────────────────────

const SEED_DOCS: Record<string, unknown>[] = [
  {
    id:               'doc_col_001',
    name:             'property-title-deed.pdf',
    mime_type:        'application/pdf',
    size_bytes:       425_600,
    uploaded_at:      '2025-02-10T09:30:00Z',
    uploaded_by_name: 'Alice Nakato',
  },
  {
    id:               'doc_col_002',
    name:             'property-valuation-report.pdf',
    mime_type:        'application/pdf',
    size_bytes:       982_000,
    uploaded_at:      '2025-02-10T09:45:00Z',
    uploaded_by_name: 'Alice Nakato',
  },
];

const SEED_DOCS_V: Record<string, unknown>[] = [
  {
    id:               'doc_col_003',
    name:             'vehicle-logbook.pdf',
    mime_type:        'application/pdf',
    size_bytes:       214_000,
    uploaded_at:      '2025-02-11T10:00:00Z',
    uploaded_by_name: 'Bob Ssebuliba',
  },
  {
    id:               'doc_col_004',
    name:             'vehicle-photo.jpg',
    mime_type:        'image/jpeg',
    size_bytes:       510_000,
    uploaded_at:      '2025-02-11T10:05:00Z',
    uploaded_by_name: 'Bob Ssebuliba',
  },
];

const SEED_DOCS_R: Record<string, unknown>[] = [
  {
    id:               'doc_col_005',
    name:             'receivables-statement.xlsx',
    mime_type:        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    size_bytes:       86_000,
    uploaded_at:      '2025-02-12T11:00:00Z',
    uploaded_by_name: 'Carol Atim',
  },
];

/** Mutable in-memory store for collateral items keyed by invoice ID. */
export const COLLATERAL_STORE: Record<string, CollateralMockItem[]> = {
  inv_001: [
    {
      id:              'col_001',
      invoice_id:      'inv_001',
      type:            'property',
      description:     'Commercial plot, Kampala Road, Nakasero — Land Title MZE/104520',
      estimated_value: 35_000_000,
      expiry_date:     '2026-02-10',
      status:          'verified',
      documents:       SEED_DOCS,
      created_at:      '2025-02-10T09:00:00Z',
      updated_at:      '2025-02-10T09:50:00Z',
    },
    {
      id:              'col_002',
      invoice_id:      'inv_001',
      type:            'vehicle',
      description:     'Toyota Land Cruiser VX 2022 — Reg. UAA 001Z',
      estimated_value: 95_000_000,
      expiry_date:     null,
      status:          'pending',
      documents:       SEED_DOCS_V,
      created_at:      '2025-02-11T10:00:00Z',
      updated_at:      '2025-02-11T10:10:00Z',
    },
    {
      id:              'col_003',
      invoice_id:      'inv_001',
      type:            'receivables',
      description:     'Outstanding debtors from Q4 2024 — verified by auditors',
      estimated_value: 18_500_000,
      expiry_date:     '2025-06-30',
      status:          'verified',
      documents:       SEED_DOCS_R,
      created_at:      '2025-02-12T11:00:00Z',
      updated_at:      '2025-02-12T11:15:00Z',
    },
  ],
};

/** In-memory audit log keyed by collateral ID. */
const AUDIT_STORE: Record<string, Record<string, unknown>[]> = {
  col_001: [
    {
      id:              'aud_001',
      changed_at:      '2025-02-10T09:00:00Z',
      changed_by_name: 'Alice Nakato',
      old_value:       30_000_000,
      new_value:       35_000_000,
      reason:          'Updated after fresh valuation report confirmed higher market price',
    },
  ],
  col_003: [
    {
      id:              'aud_002',
      changed_at:      '2025-02-12T11:15:00Z',
      changed_by_name: 'Carol Atim',
      old_value:       20_000_000,
      new_value:       18_500_000,
      reason:          'Adjusted downward after excluding one disputed debtor',
    },
  ],
};

let nextDocId = 10;
let nextColId = 10;
let nextAudId = 10;

// ── Handlers ──────────────────────────────────────────────────────────────────

export const collateralHandlers = [

  // GET /invoices/:id/collateral
  http.get('/api/invoices/:invoiceId/collateral', async ({ params }) => {
    await delay(180);
    const { invoiceId } = params as { invoiceId: string };
    return HttpResponse.json(COLLATERAL_STORE[invoiceId] ?? []);
  }),

  // POST /invoices/:id/collateral
  http.post('/api/invoices/:invoiceId/collateral', async ({ params, request }) => {
    await delay(300);
    const { invoiceId } = params as { invoiceId: string };
    const body = await request.json() as Record<string, unknown>;
    const newItem: CollateralMockItem = {
      id:              `col_${nextColId++}`,
      invoice_id:      invoiceId,
      type:            (body.type as string) ?? 'other',
      description:     String(body.description ?? ''),
      estimated_value: Number(body.estimated_value ?? 0),
      expiry_date:     (body.expiry_date as string) || null,
      status:          'pending',
      documents:       [],
      created_at:      new Date().toISOString(),
      updated_at:      new Date().toISOString(),
    };
    if (!COLLATERAL_STORE[invoiceId]) COLLATERAL_STORE[invoiceId] = [];
    COLLATERAL_STORE[invoiceId].push(newItem);
    return HttpResponse.json(newItem, { status: 201 });
  }),

  // PATCH /collateral/:id
  http.patch('/api/collateral/:collateralId', async ({ params, request }) => {
    await delay(250);
    const { collateralId } = params as { collateralId: string };
    const body = await request.json() as Record<string, unknown>;

    for (const invoiceItems of Object.values(COLLATERAL_STORE)) {
      const idx = invoiceItems.findIndex((c) => c.id === collateralId);
      if (idx === -1) continue;

      const existing = invoiceItems[idx];
      const oldValue = existing.estimated_value;
      const newValue = body.estimated_value !== undefined ? Number(body.estimated_value) : oldValue;

      const updated: CollateralMockItem = {
        ...existing,
        ...(body.type            !== undefined && { type:            body.type as string }),
        ...(body.description     !== undefined && { description:     String(body.description) }),
        ...(body.estimated_value !== undefined && { estimated_value: newValue }),
        ...(body.expiry_date     !== undefined && { expiry_date:     (body.expiry_date as string) || null }),
        updated_at: new Date().toISOString(),
      };
      invoiceItems[idx] = updated;

      // Record audit entry if value changed
      if (newValue !== oldValue) {
        if (!AUDIT_STORE[collateralId]) AUDIT_STORE[collateralId] = [];
        AUDIT_STORE[collateralId].unshift({
          id:              `aud_${nextAudId++}`,
          changed_at:      new Date().toISOString(),
          changed_by_name: 'Current User',
          old_value:       oldValue,
          new_value:       newValue,
          reason:          (body.reason as string) || null,
        });
      }

      return HttpResponse.json(updated);
    }

    return HttpResponse.json({ message: 'Not found' }, { status: 404 });
  }),

  // DELETE /collateral/:id
  http.delete('/api/collateral/:collateralId', async ({ params }) => {
    await delay(200);
    const { collateralId } = params as { collateralId: string };

    for (const [invoiceId, items] of Object.entries(COLLATERAL_STORE)) {
      const idx = items.findIndex((c) => c.id === collateralId);
      if (idx !== -1) {
        COLLATERAL_STORE[invoiceId].splice(idx, 1);
        return new HttpResponse(null, { status: 204 });
      }
    }
    return HttpResponse.json({ message: 'Not found' }, { status: 404 });
  }),

  // POST /collateral/:id/documents
  http.post('/api/collateral/:collateralId/documents', async ({ params }) => {
    await delay(600);
    const { collateralId } = params as { collateralId: string };

    const newDoc: Record<string, unknown> = {
      id:               `doc_col_${nextDocId++}`,
      name:             `document-${Date.now()}.pdf`,
      mime_type:        'application/pdf',
      size_bytes:       250_000,
      uploaded_at:      new Date().toISOString(),
      uploaded_by_name: 'Current User',
    };

    for (const items of Object.values(COLLATERAL_STORE)) {
      const col = items.find((c) => c.id === collateralId);
      if (col) {
        (col.documents ??= []).push(newDoc);
        col.updated_at = new Date().toISOString();
        return HttpResponse.json(newDoc, { status: 201 });
      }
    }
    return HttpResponse.json({ message: 'Not found' }, { status: 404 });
  }),

  // DELETE /collateral/:id/documents/:docId
  http.delete('/api/collateral/:collateralId/documents/:docId', async ({ params }) => {
    await delay(200);
    const { collateralId, docId } = params as { collateralId: string; docId: string };

    for (const items of Object.values(COLLATERAL_STORE)) {
      const col = items.find((c) => c.id === collateralId);
      if (col) {
        const idx = (col.documents ?? []).findIndex((d) => d.id === docId);
        if (idx !== -1) {
          col.documents!.splice(idx, 1);
          return new HttpResponse(null, { status: 204 });
        }
      }
    }
    return HttpResponse.json({ message: 'Not found' }, { status: 404 });
  }),

  // GET /collateral/:id/documents/:docId/download — return a tiny placeholder blob
  http.get('/api/collateral/:collateralId/documents/:docId/download', async ({ params }) => {
    await delay(400);
    const { docId } = params as { collateralId: string; docId: string };
    // Return a 1-byte placeholder so the browser doesn't hang in preview
    const placeholder = new Uint8Array([0x25, 0x50, 0x44, 0x46]); // %PDF
    return new HttpResponse(placeholder, {
      status: 200,
      headers: {
        'Content-Type':        'application/pdf',
        'Content-Disposition': `inline; filename="${docId}.pdf"`,
        'Content-Length':      String(placeholder.length),
      },
    });
  }),

  // GET /collateral/:id/audit
  http.get('/api/collateral/:collateralId/audit', async ({ params }) => {
    await delay(200);
    const { collateralId } = params as { collateralId: string };
    return HttpResponse.json(AUDIT_STORE[collateralId] ?? []);
  }),
];
