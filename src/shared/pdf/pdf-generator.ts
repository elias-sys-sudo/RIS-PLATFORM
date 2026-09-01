// =============================================================================
// PDF Generator — pdfkit implementations
//
// Generates legally required documents for Uganda compliance:
//   - Notice of Assignment  (Uganda Contract Act)
//   - Demand Letter         (Uganda Civil Procedure Act)
//   - Tax Invoice           (Uganda VAT Act — 18% VAT, 6% WHT)
//   - WHT Certificate       (Uganda Income Tax Act)
//
// All functions return Promise<Buffer>. Nothing is written to disk.
// =============================================================================

import PDFDocument from 'pdfkit';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RisDetails {
  name: string;
  address: string;
  registrationNumber: string;
  tin: string;
  vatRegistrationNumber: string;
  withholdingAgentNumber: string;
  bankAccount: string;
  bankName: string;
  /** REQ-VERIFY-008 — letterhead contact line. */
  contactEmail?: string;
}

export interface SupplierDetails {
  name: string;
  registrationNumber: string;
  tin: string;
  address: string;
  /** REQ-VERIFY-008 — bank account holder name for the Notice of Assignment. */
  bankAccountName?: string;
}

export interface BuyerDetails {
  name: string;
  address: string;
  /** REQ-VERIFY-008 — buyer registration number on the Notice of Assignment. */
  registrationNumber?: string;
}

export interface InvoiceSummary {
  reference: string;
  date: string;
  dueDate: string;
  faceValue: bigint;
}

export interface NoticeOfAssignmentData {
  ris: RisDetails;
  supplier: SupplierDetails;
  buyer: BuyerDetails;
  invoice: InvoiceSummary;
  assignmentDate: string;
  advanceAmount: bigint;
}

export interface DemandInvoiceRow {
  reference: string;
  dueDate: string;
  faceValue: bigint;
  penaltyAccrued: bigint;
  /** REQ-COLLECT-007 — days past due, shown in the demand table. */
  daysOverdue?: number;
}

export interface DemandLetterData {
  ris: RisDetails;
  buyer: BuyerDetails;
  letterDate: string;
  invoices: DemandInvoiceRow[];
  totalOutstanding: bigint;
}

export interface TaxInvoiceData {
  ris: RisDetails;
  supplier: SupplierDetails;
  taxInvoiceNumber: string;
  invoiceDate: string;
  invoice: InvoiceSummary;
  discountFee: bigint;
  vatAmount: bigint;
  whtAmount: bigint;
  netAdvance: bigint;
}

export interface WHTTransactionRow {
  invoiceRef: string;
  paymentDate: string;
  grossAmount: bigint;
  whtRate: string;
  whtAmount: bigint;
}

export interface WHTCertificateData {
  ris: RisDetails;
  supplier: SupplierDetails;
  certificateNumber: string;
  yearOfAssessment: string;
  transactions: WHTTransactionRow[];
  totalWht: bigint;
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

function formatUGX(amount: bigint): string {
  const str = amount.toString();
  const parts: string[] = [];
  let i = str.length;
  while (i > 3) {
    parts.unshift(str.slice(i - 3, i));
    i -= 3;
  }
  parts.unshift(str.slice(0, i));
  return `UGX ${parts.join(',')}`;
}

function buildBuffer(doc: PDFKit.PDFDocument): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    doc.end();
  });
}

function addLetterhead(doc: PDFKit.PDFDocument, ris: RisDetails): void {
  doc.font('Helvetica-Bold').fontSize(16).text(ris.name, { align: 'center' });
  doc.font('Helvetica').fontSize(10).text(ris.address, { align: 'center' });
  doc.text(`Registration No: ${ris.registrationNumber}`, { align: 'center' });
  if (ris.contactEmail !== undefined && ris.contactEmail !== '') {
    doc.text(`Contact: ${ris.contactEmail}`, { align: 'center' });
  }
  doc.moveDown(1.5);
}

function addPageFooters(doc: PDFKit.PDFDocument, totalPages: number, suffix?: string): void {
  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i++) {
    doc.switchToPage(range.start + i);
    const base = `Rapha Integrated Solutions | Confidential | Page ${range.start + i + 1} of ${totalPages}`;
    const text = suffix !== undefined && suffix !== '' ? `${base} | ${suffix}` : base;
    doc
      .font('Helvetica')
      .fontSize(8)
      .text(text, 50, doc.page.height - 40, {
        align: 'center',
        width: doc.page.width - 100,
      });
  }
}

// ---------------------------------------------------------------------------
// generateNoticeOfAssignment
// ---------------------------------------------------------------------------

/**
 * Generate a Notice of Assignment PDF.
 * Uganda Contract Act — assignment of receivables must be in writing.
 */
export async function generateNoticeOfAssignment(data: NoticeOfAssignmentData): Promise<Buffer> {
  const doc = new PDFDocument({ size: 'A4', margin: 50, bufferPages: true, compress: false });

  addLetterhead(doc, data.ris);

  doc
    .font('Helvetica-Bold')
    .fontSize(13)
    .text('NOTICE OF ASSIGNMENT OF RECEIVABLES', { align: 'center' });
  doc.moveDown(0.5);
  doc.font('Helvetica').fontSize(10).text(`Date: ${data.assignmentDate}`);
  doc.moveDown(1);

  doc.font('Helvetica-Bold').text('TO:');
  doc.font('Helvetica').text(data.buyer.name);
  doc.text(data.buyer.address);
  if (data.buyer.registrationNumber !== undefined && data.buyer.registrationNumber !== '') {
    doc.text(`Registration No: ${data.buyer.registrationNumber}`);
  }
  doc.moveDown(1);

  doc.font('Helvetica-Bold').text('FROM (Assignor):');
  doc.font('Helvetica').text(data.supplier.name);
  doc.text(`Registration No: ${data.supplier.registrationNumber}`);
  if (data.supplier.bankAccountName !== undefined && data.supplier.bankAccountName !== '') {
    doc.text(`Bank Account Name: ${data.supplier.bankAccountName}`);
  }
  doc.moveDown(1);

  doc.font('Helvetica-Bold').text('INVOICE DETAILS');
  doc.moveDown(0.3);
  doc.font('Helvetica').text(`Invoice Reference:  ${data.invoice.reference}`);
  doc.text(`Invoice Date:       ${data.invoice.date}`);
  doc.text(`Due Date:           ${data.invoice.dueDate}`);
  doc.text(`Face Value:         ${formatUGX(data.invoice.faceValue)}`);
  doc.moveDown(1);

  doc.font('Helvetica-Bold').text('ADVANCE PAID BY ASSIGNEE');
  doc.font('Helvetica').text(`Advance Amount: ${formatUGX(data.advanceAmount)}`);
  doc.moveDown(1);

  doc
    .font('Helvetica')
    .text(
      `You are hereby notified that all rights to payment under the above invoice have been ` +
        `assigned to ${data.ris.name}. Payment must be directed to the account details below.`,
    );
  doc.moveDown(1);

  doc.font('Helvetica-Bold').text('RIS PAYMENT DETAILS');
  doc.font('Helvetica').text(`Bank: ${data.ris.bankName}`);
  doc.text(`Account Number: ${data.ris.bankAccount}`);
  doc.moveDown(1);

  doc
    .font('Helvetica-Oblique')
    .fontSize(9)
    .text(
      'This notice is issued pursuant to the Uganda Contract Act 2010 §§ 51-52 (assignment of ' +
        'choses in action). Any payment made to the original payee (the Assignor) after receipt ' +
        'of this notice shall not discharge your obligation to the Assignee.',
    );
  doc.moveDown(1.5);

  doc.font('Helvetica').fontSize(10).text('Signed for and on behalf of the Assignor:');
  doc.moveDown(2);
  doc.text('_________________________');
  doc.text('Authorised Signatory');
  doc.text(data.supplier.name);

  const totalPages = doc.bufferedPageRange().count;
  addPageFooters(doc, totalPages, `Invoice ${data.invoice.reference}`);

  return buildBuffer(doc);
}

// ---------------------------------------------------------------------------
// generateDemandLetter
// ---------------------------------------------------------------------------

/**
 * Generate a Demand Letter PDF.
 * Uganda Civil Procedure Act — formal demand before civil proceedings.
 */
export async function generateDemandLetter(data: DemandLetterData): Promise<Buffer> {
  const doc = new PDFDocument({ size: 'A4', margin: 50, bufferPages: true, compress: false });

  addLetterhead(doc, data.ris);

  doc.font('Helvetica-Bold').fontSize(13).text('FORMAL DEMAND FOR PAYMENT', { align: 'center' });
  doc.moveDown(0.5);
  doc.font('Helvetica').fontSize(10).text(`Date: ${data.letterDate}`);
  doc.moveDown(1);

  doc.font('Helvetica-Bold').text('TO:');
  doc.font('Helvetica').text(data.buyer.name);
  doc.text(data.buyer.address);
  doc.moveDown(1);

  doc
    .font('Helvetica')
    .text(
      'We write to formally demand immediate payment of all outstanding amounts detailed below, ' +
        'which are due and payable to Rapha Integrated Solutions under assigned invoices.',
    );
  doc.moveDown(1);

  // Table header
  const colRef = 50;
  const colDue = 130;
  const colDays = 215;
  const colFace = 270;
  const colPenalty = 355;
  const colTotal = 450;
  const tableTop = doc.y;

  doc.font('Helvetica-Bold').fontSize(9);
  doc.text('Invoice Ref', colRef, tableTop);
  doc.text('Due Date', colDue, tableTop);
  doc.text('Days Overdue', colDays, tableTop);
  doc.text('Face Value', colFace, tableTop);
  doc.text('Penalty', colPenalty, tableTop);
  doc.text('Total Due', colTotal, tableTop);
  doc.moveDown(0.4);

  doc
    .moveTo(colRef, doc.y)
    .lineTo(doc.page.width - 50, doc.y)
    .stroke();
  doc.moveDown(0.3);

  doc.font('Helvetica').fontSize(9);
  for (const inv of data.invoices) {
    const rowY = doc.y;
    const total = inv.faceValue + inv.penaltyAccrued;
    doc.text(inv.reference, colRef, rowY);
    doc.text(inv.dueDate, colDue, rowY);
    doc.text(String(inv.daysOverdue ?? '-'), colDays, rowY);
    doc.text(formatUGX(inv.faceValue), colFace, rowY);
    doc.text(formatUGX(inv.penaltyAccrued), colPenalty, rowY);
    doc.text(formatUGX(total), colTotal, rowY);
    doc.moveDown(0.6);
  }

  doc
    .moveTo(colRef, doc.y)
    .lineTo(doc.page.width - 50, doc.y)
    .stroke();
  doc.moveDown(0.4);

  doc
    .font('Helvetica-Bold')
    .fontSize(10)
    .text(`TOTAL OUTSTANDING: ${formatUGX(data.totalOutstanding)}`);
  doc.moveDown(1);

  doc
    .font('Helvetica')
    .fontSize(10)
    .text('Penalty of 0.1% per day accrues from the due date on all overdue amounts.');
  doc.moveDown(0.5);

  doc
    .font('Helvetica-Bold')
    .text('You are required to pay the full outstanding amount within 7 days of this letter.');
  doc.moveDown(0.5);

  doc
    .font('Helvetica')
    .text(
      'Failure to pay in full within the stipulated period will result in (a) referral to legal ' +
        'escalation, (b) reporting of your default to licensed Uganda credit reference bureaus pursuant ' +
        'to the Financial Institutions Act 2004 § 134, and (c) institution of civil proceedings ' +
        'against you in the High Court of Uganda, Commercial Division, without further notice.',
    );
  doc.moveDown(1);

  doc.font('Helvetica').text('Sincerely,');
  doc.moveDown(0.5);
  doc.font('Helvetica-Bold').text('Credit Manager');
  doc.font('Helvetica').text(data.ris.name);

  const totalPages = doc.bufferedPageRange().count;
  addPageFooters(doc, totalPages);

  return buildBuffer(doc);
}

// ---------------------------------------------------------------------------
// generateTaxInvoice
// ---------------------------------------------------------------------------

/**
 * Generate a Tax Invoice PDF.
 * Uganda VAT Act — 18% VAT on discount fee; 6% WHT deducted.
 */
export async function generateTaxInvoice(data: TaxInvoiceData): Promise<Buffer> {
  const doc = new PDFDocument({ size: 'A4', margin: 50, bufferPages: true, compress: false });

  addLetterhead(doc, data.ris);

  doc.font('Helvetica-Bold').fontSize(13).text('TAX INVOICE', { align: 'center' });
  doc.moveDown(0.5);

  doc.font('Helvetica').fontSize(10);
  doc.text(`TIN: ${data.ris.tin}`);
  doc.text(`VAT Registration No: ${data.ris.vatRegistrationNumber}`);
  doc.moveDown(0.5);

  doc.font('Helvetica-Bold').text(`Tax Invoice No: ${data.taxInvoiceNumber}`);
  doc.font('Helvetica').text(`Invoice Date: ${data.invoiceDate}`);
  doc.moveDown(1);

  doc.font('Helvetica-Bold').text('BILLED TO (Supplier):');
  doc.font('Helvetica').text(data.supplier.name);
  doc.text(`TIN: ${data.supplier.tin}`);
  doc.text(data.supplier.address);
  doc.moveDown(1);

  doc.font('Helvetica-Bold').text('SERVICE DESCRIPTION:');
  doc
    .font('Helvetica')
    .text(
      `Invoice discounting service — Invoice ref ${data.invoice.reference}, due date ${data.invoice.dueDate}`,
    );
  doc.moveDown(1);

  // Amounts table
  const colDesc = 50;
  const colAmt = 400;
  const tableTop = doc.y;

  doc.font('Helvetica-Bold').fontSize(10);
  doc.text('Description', colDesc, tableTop);
  doc.text('Amount', colAmt, tableTop);
  doc.moveDown(0.4);

  doc
    .moveTo(colDesc, doc.y)
    .lineTo(doc.page.width - 50, doc.y)
    .stroke();
  doc.moveDown(0.3);

  const rows: Array<[string, string]> = [
    ['Face Value (for reference)', formatUGX(data.invoice.faceValue)],
    ['Discount Fee (RIS charge)', formatUGX(data.discountFee)],
    ['VAT at 18%', formatUGX(data.vatAmount)],
    ['WHT deducted at 6%', `(${formatUGX(data.whtAmount)})`],
    ['Net Advance to Supplier', formatUGX(data.netAdvance)],
  ];

  doc.font('Helvetica').fontSize(10);
  for (const [desc, amt] of rows) {
    const rowY = doc.y;
    doc.text(desc, colDesc, rowY);
    doc.text(amt, colAmt, rowY);
    doc.moveDown(0.6);
  }

  doc
    .moveTo(colDesc, doc.y)
    .lineTo(doc.page.width - 50, doc.y)
    .stroke();
  doc.moveDown(1);

  doc
    .font('Helvetica-Oblique')
    .fontSize(9)
    .text(
      'This is a tax invoice issued in accordance with the Uganda Value Added Tax Act. ' +
        'VAT registration number shown above. WHT has been deducted and will be remitted ' +
        'to Uganda Revenue Authority on your behalf.',
    );

  const totalPages = doc.bufferedPageRange().count;
  addPageFooters(doc, totalPages);

  return buildBuffer(doc);
}

// ---------------------------------------------------------------------------
// generateWHTCertificate
// ---------------------------------------------------------------------------

/**
 * Generate a Withholding Tax Certificate PDF.
 * Uganda Income Tax Act — WHT agent certificate for supplier URA returns.
 */
export async function generateWHTCertificate(data: WHTCertificateData): Promise<Buffer> {
  const doc = new PDFDocument({ size: 'A4', margin: 50, bufferPages: true, compress: false });

  addLetterhead(doc, data.ris);

  doc.font('Helvetica-Bold').fontSize(13).text('WITHHOLDING TAX CERTIFICATE', { align: 'center' });
  doc.moveDown(0.5);

  doc.font('Helvetica').fontSize(10);
  doc.text(`TIN: ${data.ris.tin}`);
  doc.text(`Withholding Agent Number: ${data.ris.withholdingAgentNumber}`);
  doc.moveDown(0.5);

  doc.font('Helvetica-Bold').text(`Certificate No: ${data.certificateNumber}`);
  doc.font('Helvetica').text(`Year of Assessment: ${data.yearOfAssessment}`);
  doc.moveDown(1);

  doc.font('Helvetica-Bold').text('ISSUED TO (Payee):');
  doc.font('Helvetica').text(data.supplier.name);
  doc.text(`TIN: ${data.supplier.tin}`);
  doc.text(data.supplier.address);
  doc.moveDown(1);

  // Transactions table
  const colInv = 50;
  const colDate = 150;
  const colGross = 240;
  const colRate = 340;
  const colWHT = 430;
  const tableTop = doc.y;

  doc.font('Helvetica-Bold').fontSize(8);
  doc.text('Invoice Ref', colInv, tableTop);
  doc.text('Payment Date', colDate, tableTop);
  doc.text('Gross Amount', colGross, tableTop);
  doc.text('WHT Rate', colRate, tableTop);
  doc.text('WHT Amount', colWHT, tableTop);
  doc.moveDown(0.4);

  doc
    .moveTo(colInv, doc.y)
    .lineTo(doc.page.width - 50, doc.y)
    .stroke();
  doc.moveDown(0.3);

  doc.font('Helvetica').fontSize(8);
  for (const tx of data.transactions) {
    const rowY = doc.y;
    doc.text(tx.invoiceRef, colInv, rowY);
    doc.text(tx.paymentDate, colDate, rowY);
    doc.text(formatUGX(tx.grossAmount), colGross, rowY);
    doc.text(tx.whtRate, colRate, rowY);
    doc.text(formatUGX(tx.whtAmount), colWHT, rowY);
    doc.moveDown(0.6);
  }

  doc
    .moveTo(colInv, doc.y)
    .lineTo(doc.page.width - 50, doc.y)
    .stroke();
  doc.moveDown(0.4);

  doc
    .font('Helvetica-Bold')
    .fontSize(10)
    .text(`TOTAL WHT DEDUCTED: ${formatUGX(data.totalWht)}`);
  doc.moveDown(1);

  doc
    .font('Helvetica')
    .fontSize(10)
    .text(
      `This certificate confirms that withholding tax of ${formatUGX(data.totalWht)} has been ` +
        `deducted and remitted to Uganda Revenue Authority on your behalf.`,
    );
  doc.moveDown(1.5);

  doc.font('Helvetica').text('_____________________________');
  doc.font('Helvetica-Bold').text('RIS Finance Manager');
  doc.font('Helvetica').text(data.ris.name);

  const totalPages = doc.bufferedPageRange().count;
  addPageFooters(doc, totalPages);

  return buildBuffer(doc);
}
