import {
  generateNoticeOfAssignment,
  generateDemandLetter,
  generateTaxInvoice,
  generateWHTCertificate,
  type NoticeOfAssignmentData,
  type DemandLetterData,
  type TaxInvoiceData,
  type WHTCertificateData,
} from '../../../src/shared/pdf/pdf-generator';

// ---------------------------------------------------------------------------
// Shared fixture data
// ---------------------------------------------------------------------------

const mmsFixture = {
  name: 'Rapha Integrated Solutions',
  address: 'Plot 1, Kampala Road, Kampala, Uganda',
  registrationNumber: '80000123456789',
  tin: '1000123456',
  vatRegistrationNumber: 'V12345678',
  withholdingAgentNumber: 'WHA-001',
  bankAccount: '0123456789',
  bankName: 'Stanbic Bank Uganda',
};

const supplierFixture = {
  name: 'Acme Supplies Ltd',
  registrationNumber: '80000987654321',
  tin: '2000987654',
  address: '45 Industrial Area, Kampala',
};

const buyerFixture = {
  name: 'BigBuyer Corp',
  address: '10 City Square, Kampala, Uganda',
};

const invoiceFixture = {
  reference: 'INV-2024-001',
  date: '2024-01-15',
  dueDate: '2024-04-15',
  faceValue: BigInt(10_000_000),
};

/**
 * pdfkit encodes text as hex in TJ arrays with kerning breaks.
 * This helper extracts all hex-encoded text segments from the PDF,
 * concatenates them (ignoring kerning numbers), and searches in
 * the resulting plain text.
 */
function extractPdfText(buf: Buffer): string {
  const latin = buf.toString('latin1');
  const hexPattern = /<([0-9a-f]+)>/g;
  const segments: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = hexPattern.exec(latin)) !== null) {
    segments.push(Buffer.from(match[1], 'hex').toString('latin1'));
  }
  return segments.join('');
}

function pdfContainsText(buf: Buffer, needle: string): boolean {
  return extractPdfText(buf).includes(needle);
}

// ---------------------------------------------------------------------------
// generateNoticeOfAssignment
// ---------------------------------------------------------------------------

describe('generateNoticeOfAssignment', () => {
  const data: NoticeOfAssignmentData = {
    ris: mmsFixture,
    supplier: supplierFixture,
    buyer: buyerFixture,
    invoice: invoiceFixture,
    assignmentDate: '2024-01-16',
    advanceAmount: BigInt(9_500_000),
  };

  it('returns a non-empty Buffer starting with PDF header', async () => {
    const result = await generateNoticeOfAssignment(data);
    expect(result).toBeInstanceOf(Buffer);
    expect(result.length).toBeGreaterThan(0);
    expect(result.subarray(0, 5).toString()).toBe('%PDF-');
  });

  it('contains assignment title and key parties', async () => {
    const result = await generateNoticeOfAssignment(data);
    expect(pdfContainsText(result, 'NOTICE OF ASSIGNMENT')).toBe(true);
    expect(pdfContainsText(result, 'Rapha Integrated Solutions')).toBe(true);
    expect(pdfContainsText(result, 'Acme Supplies Ltd')).toBe(true);
    expect(pdfContainsText(result, 'BigBuyer Corp')).toBe(true);
  });

  it('contains invoice details and formatted UGX amounts', async () => {
    const result = await generateNoticeOfAssignment(data);
    expect(pdfContainsText(result, 'INV-2024-001')).toBe(true);
    expect(pdfContainsText(result, 'UGX 10,000,000')).toBe(true);
    expect(pdfContainsText(result, 'UGX 9,500,000')).toBe(true);
    expect(pdfContainsText(result, 'Stanbic Bank Uganda')).toBe(true);
  });

  it('contains legal assignment clause citing Uganda Contract Act 2010', async () => {
    const result = await generateNoticeOfAssignment(data);
    expect(pdfContainsText(result, 'assigned to')).toBe(true);
    // REQ-VERIFY-008 — specific citation, not generic
    expect(pdfContainsText(result, 'Uganda Contract Act 2010')).toBe(true);
  });

  it('contains supplier authorised signatory block', async () => {
    const result = await generateNoticeOfAssignment(data);
    expect(pdfContainsText(result, 'Authorised Signatory')).toBe(true);
  });

  it('contains confidential footer with invoice ID', async () => {
    const result = await generateNoticeOfAssignment(data);
    expect(pdfContainsText(result, 'Confidential')).toBe(true);
    expect(pdfContainsText(result, 'Page 1 of 1')).toBe(true);
    // REQ-VERIFY-008 — page footer carries the invoice reference
    expect(pdfContainsText(result, 'INV-2024-001')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// generateDemandLetter
// ---------------------------------------------------------------------------

describe('generateDemandLetter', () => {
  const data: DemandLetterData = {
    ris: mmsFixture,
    buyer: buyerFixture,
    letterDate: '2024-05-01',
    invoices: [
      {
        reference: 'INV-2024-001',
        dueDate: '2024-04-15',
        faceValue: BigInt(10_000_000),
        penaltyAccrued: BigInt(150_000),
        daysOverdue: 16,
      },
      {
        reference: 'INV-2024-002',
        dueDate: '2024-04-20',
        faceValue: BigInt(5_000_000),
        penaltyAccrued: BigInt(55_000),
        daysOverdue: 11,
      },
    ],
    totalOutstanding: BigInt(15_205_000),
  };

  it('returns a non-empty Buffer starting with PDF header', async () => {
    const result = await generateDemandLetter(data);
    expect(result).toBeInstanceOf(Buffer);
    expect(result.length).toBeGreaterThan(0);
    expect(result.subarray(0, 5).toString()).toBe('%PDF-');
  });

  it('contains demand letter title and buyer details', async () => {
    const result = await generateDemandLetter(data);
    // REQ-COLLECT-007 — spec wording is "FORMAL DEMAND FOR PAYMENT"
    expect(pdfContainsText(result, 'FORMAL DEMAND FOR PAYMENT')).toBe(true);
    expect(pdfContainsText(result, 'BigBuyer Corp')).toBe(true);
  });

  it('contains invoice references and total outstanding', async () => {
    const result = await generateDemandLetter(data);
    expect(pdfContainsText(result, 'INV-2024-001')).toBe(true);
    expect(pdfContainsText(result, 'INV-2024-002')).toBe(true);
    expect(pdfContainsText(result, 'UGX 15,205,000')).toBe(true);
  });

  it('contains penalty amounts and per-row totals', async () => {
    const result = await generateDemandLetter(data);
    expect(pdfContainsText(result, 'UGX 150,000')).toBe(true);
    expect(pdfContainsText(result, 'UGX 55,000')).toBe(true);
    // REQ-COLLECT-007 — Total Due column = face + penalty
    expect(pdfContainsText(result, 'UGX 10,150,000')).toBe(true);
    expect(pdfContainsText(result, 'UGX 5,055,000')).toBe(true);
  });

  it('contains days overdue column', async () => {
    const result = await generateDemandLetter(data);
    expect(pdfContainsText(result, 'Days Overdue')).toBe(true);
  });

  it('contains legal consequence text with FIA 2004 § 134', async () => {
    const result = await generateDemandLetter(data);
    expect(pdfContainsText(result, 'High Court of Uganda')).toBe(true);
    // REQ-COLLECT-007 — spec wants 7-day demand period, not 14
    expect(pdfContainsText(result, '7 days')).toBe(true);
    expect(pdfContainsText(result, '0.1% per day')).toBe(true);
    expect(pdfContainsText(result, 'Financial Institutions Act 2004')).toBe(true);
  });

  it('contains Credit Manager signature block', async () => {
    const result = await generateDemandLetter(data);
    expect(pdfContainsText(result, 'Sincerely')).toBe(true);
    expect(pdfContainsText(result, 'Credit Manager')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// generateTaxInvoice
// ---------------------------------------------------------------------------

describe('generateTaxInvoice', () => {
  const data: TaxInvoiceData = {
    ris: mmsFixture,
    supplier: supplierFixture,
    taxInvoiceNumber: 'TI-2024-001',
    invoiceDate: '2024-01-16',
    invoice: invoiceFixture,
    discountFee: BigInt(400_000),
    vatAmount: BigInt(72_000),
    whtAmount: BigInt(24_000),
    netAdvance: BigInt(9_504_000),
  };

  it('returns a non-empty Buffer starting with PDF header', async () => {
    const result = await generateTaxInvoice(data);
    expect(result).toBeInstanceOf(Buffer);
    expect(result.length).toBeGreaterThan(0);
    expect(result.subarray(0, 5).toString()).toBe('%PDF-');
  });

  it('contains tax invoice number and VAT registration', async () => {
    const result = await generateTaxInvoice(data);
    expect(pdfContainsText(result, 'TAX INVOICE')).toBe(true);
    expect(pdfContainsText(result, 'TI-2024-001')).toBe(true);
    expect(pdfContainsText(result, 'V12345678')).toBe(true);
  });

  it('contains supplier details', async () => {
    const result = await generateTaxInvoice(data);
    expect(pdfContainsText(result, 'Acme Supplies Ltd')).toBe(true);
    expect(pdfContainsText(result, '2000987654')).toBe(true);
  });

  it('contains financial amounts', async () => {
    const result = await generateTaxInvoice(data);
    expect(pdfContainsText(result, 'UGX 400,000')).toBe(true);
    expect(pdfContainsText(result, 'UGX 72,000')).toBe(true);
    expect(pdfContainsText(result, 'UGX 24,000')).toBe(true);
    expect(pdfContainsText(result, 'UGX 9,504,000')).toBe(true);
  });

  it('references Uganda VAT Act', async () => {
    const result = await generateTaxInvoice(data);
    expect(pdfContainsText(result, 'Uganda Value Added Tax Act')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// generateWHTCertificate
// ---------------------------------------------------------------------------

describe('generateWHTCertificate', () => {
  const data: WHTCertificateData = {
    ris: mmsFixture,
    supplier: supplierFixture,
    certificateNumber: 'WHT-2024-001',
    yearOfAssessment: '2024',
    transactions: [
      {
        invoiceRef: 'INV-2024-001',
        paymentDate: '2024-01-16',
        grossAmount: BigInt(10_000_000),
        whtRate: '6%',
        whtAmount: BigInt(24_000),
      },
    ],
    totalWht: BigInt(24_000),
  };

  it('returns a non-empty Buffer starting with PDF header', async () => {
    const result = await generateWHTCertificate(data);
    expect(result).toBeInstanceOf(Buffer);
    expect(result.length).toBeGreaterThan(0);
    expect(result.subarray(0, 5).toString()).toBe('%PDF-');
  });

  it('contains certificate number and withholding agent details', async () => {
    const result = await generateWHTCertificate(data);
    expect(pdfContainsText(result, 'WITHHOLDING TAX CERTIFICATE')).toBe(true);
    expect(pdfContainsText(result, 'WHT-2024-001')).toBe(true);
    expect(pdfContainsText(result, 'WHA-001')).toBe(true);
  });

  it('contains supplier details', async () => {
    const result = await generateWHTCertificate(data);
    expect(pdfContainsText(result, 'Acme Supplies Ltd')).toBe(true);
    expect(pdfContainsText(result, '2000987654')).toBe(true);
  });

  it('contains transaction data and total WHT', async () => {
    const result = await generateWHTCertificate(data);
    expect(pdfContainsText(result, 'INV-2024-001')).toBe(true);
    expect(pdfContainsText(result, 'UGX 24,000')).toBe(true);
  });

  it('contains URA certification statement', async () => {
    const result = await generateWHTCertificate(data);
    expect(pdfContainsText(result, 'Uganda Revenue Authority')).toBe(true);
  });

  it('contains signature block', async () => {
    const result = await generateWHTCertificate(data);
    expect(pdfContainsText(result, 'RIS Finance Manager')).toBe(true);
    expect(pdfContainsText(result, 'Rapha Integrated Solutions')).toBe(true);
  });
});
