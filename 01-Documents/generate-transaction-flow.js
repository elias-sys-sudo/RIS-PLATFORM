const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  Header, Footer, AlignmentType, HeadingLevel, BorderStyle, WidthType,
  ShadingType, PageNumber, PageBreak, LevelFormat
} = require("docx");
const fs = require("fs");

const border = { style: BorderStyle.SINGLE, size: 1, color: "BBBBBB" };
const borders = { top: border, bottom: border, left: border, right: border };
const cellMargins = { top: 60, bottom: 60, left: 100, right: 100 };

function heading(text, level) {
  return new Paragraph({
    heading: level,
    spacing: { before: level === HeadingLevel.HEADING_1 ? 360 : 240, after: 120 },
    children: [new TextRun({ text, bold: true })],
  });
}

function para(text, opts = {}) {
  return new Paragraph({
    spacing: { after: 120 },
    ...opts,
    children: [new TextRun({ text, size: 22, ...opts.run })],
  });
}

function boldPara(label, text) {
  return new Paragraph({
    spacing: { after: 100 },
    children: [
      new TextRun({ text: label, bold: true, size: 22 }),
      new TextRun({ text, size: 22 }),
    ],
  });
}

function rolePara(roles) {
  return new Paragraph({
    spacing: { after: 100 },
    shading: { fill: "FFF8E1", type: ShadingType.CLEAR },
    indent: { left: 120, right: 120 },
    children: [
      new TextRun({ text: "  Roles: ", bold: true, size: 22, color: "7D6608" }),
      new TextRun({ text: roles, size: 22, color: "7D6608" }),
    ],
  });
}

function codePara(text) {
  return new Paragraph({
    spacing: { after: 60 },
    indent: { left: 360 },
    children: [new TextRun({ text, font: "Consolas", size: 20, color: "333333" })],
  });
}

function codeBlock(lines) {
  return lines.map(l => codePara(l));
}

function headerCell(text, width, opts = {}) {
  return new TableCell({
    borders,
    width: { size: width, type: WidthType.DXA },
    shading: { fill: opts.fill || "1B4F72", type: ShadingType.CLEAR },
    margins: cellMargins,
    children: [new Paragraph({ children: [new TextRun({ text, bold: true, color: opts.color || "FFFFFF", size: 20, font: "Arial" })] })],
  });
}

function cell(text, width, opts = {}) {
  return new TableCell({
    borders,
    width: { size: width, type: WidthType.DXA },
    shading: opts.shading ? { fill: opts.shading, type: ShadingType.CLEAR } : undefined,
    margins: cellMargins,
    children: [new Paragraph({ children: [new TextRun({ text, size: 20, font: "Arial", bold: opts.bold || false, color: opts.color })] })],
  });
}

function makeTable(headers, rows, colWidths) {
  const totalW = colWidths.reduce((a, b) => a + b, 0);
  return new Table({
    width: { size: totalW, type: WidthType.DXA },
    columnWidths: colWidths,
    rows: [
      new TableRow({ children: headers.map((h, i) => headerCell(h, colWidths[i])) }),
      ...rows.map((row, ri) =>
        new TableRow({
          children: row.map((c, i) =>
            cell(c, colWidths[i], { shading: ri % 2 === 1 ? "F2F7FB" : undefined })
          ),
        })
      ),
    ],
  });
}

// Role-highlighted table (amber header for role tables)
function makeRoleTable(headers, rows, colWidths) {
  const totalW = colWidths.reduce((a, b) => a + b, 0);
  return new Table({
    width: { size: totalW, type: WidthType.DXA },
    columnWidths: colWidths,
    rows: [
      new TableRow({ children: headers.map((h, i) => headerCell(h, colWidths[i], { fill: "7D6608", color: "FFFFFF" })) }),
      ...rows.map((row, ri) =>
        new TableRow({
          children: row.map((c, i) =>
            cell(c, colWidths[i], { shading: ri % 2 === 1 ? "FFF8E1" : "FFFDF0" })
          ),
        })
      ),
    ],
  });
}

function spacer() {
  return new Paragraph({ spacing: { after: 80 }, children: [] });
}

// ─── Build Document ───

const doc = new Document({
  styles: {
    default: { document: { run: { font: "Arial", size: 22 } } },
    paragraphStyles: [
      {
        id: "Heading1", name: "Heading 1", basedOn: "Normal", next: "Normal", quickFormat: true,
        run: { size: 36, bold: true, font: "Arial", color: "1B4F72" },
        paragraph: { spacing: { before: 360, after: 200 }, outlineLevel: 0 },
      },
      {
        id: "Heading2", name: "Heading 2", basedOn: "Normal", next: "Normal", quickFormat: true,
        run: { size: 28, bold: true, font: "Arial", color: "2E75B6" },
        paragraph: { spacing: { before: 280, after: 160 }, outlineLevel: 1 },
      },
      {
        id: "Heading3", name: "Heading 3", basedOn: "Normal", next: "Normal", quickFormat: true,
        run: { size: 24, bold: true, font: "Arial", color: "3498DB" },
        paragraph: { spacing: { before: 200, after: 120 }, outlineLevel: 2 },
      },
    ],
  },
  numbering: {
    config: [
      {
        reference: "bullets",
        levels: [{
          level: 0, format: LevelFormat.BULLET, text: "\u2022", alignment: AlignmentType.LEFT,
          style: { paragraph: { indent: { left: 720, hanging: 360 } } },
        }],
      },
    ],
  },
  sections: [
    // ─── TITLE PAGE ───
    {
      properties: {
        page: {
          size: { width: 12240, height: 15840 },
          margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 },
        },
      },
      children: [
        new Paragraph({ spacing: { before: 3600 }, children: [] }),
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { after: 200 },
          children: [new TextRun({ text: "RIS PLATFORM", size: 56, bold: true, color: "1B4F72", font: "Arial" })],
        }),
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { after: 400 },
          children: [new TextRun({ text: "Full Transaction Flow", size: 40, color: "2E75B6", font: "Arial" })],
        }),
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { after: 60 },
          children: [new TextRun({ text: "From Eligibility to Funding to Collections & Settlement", size: 24, color: "666666", font: "Arial" })],
        }),
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { after: 120 },
          children: [new TextRun({ text: "Including Role Ownership & Authorization Matrix", size: 24, color: "666666", font: "Arial" })],
        }),
        new Paragraph({ spacing: { before: 600 }, children: [] }),
        new Paragraph({
          alignment: AlignmentType.CENTER,
          border: { top: { style: BorderStyle.SINGLE, size: 2, color: "2E75B6", space: 8 } },
          spacing: { before: 200, after: 100 },
          children: [new TextRun({ text: "CONFIDENTIAL", size: 22, bold: true, color: "CC0000", font: "Arial" })],
        }),
        new Paragraph({
          alignment: AlignmentType.CENTER,
          children: [new TextRun({ text: "Rapha Integrated Solutions  |  Version 2.0  |  March 2026", size: 20, color: "888888", font: "Arial" })],
        }),
        new Paragraph({ children: [new PageBreak()] }),
      ],
    },
    // ─── MAIN CONTENT ───
    {
      properties: {
        page: {
          size: { width: 12240, height: 15840 },
          margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 },
        },
      },
      headers: {
        default: new Header({
          children: [new Paragraph({
            border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: "2E75B6", space: 4 } },
            children: [new TextRun({ text: "RIS Platform \u2014 Transaction Flow & Role Matrix", size: 18, color: "888888", font: "Arial" })],
          })],
        }),
      },
      footers: {
        default: new Footer({
          children: [new Paragraph({
            alignment: AlignmentType.CENTER,
            border: { top: { style: BorderStyle.SINGLE, size: 2, color: "CCCCCC", space: 4 } },
            children: [
              new TextRun({ text: "Page ", size: 18, color: "888888" }),
              new TextRun({ children: [PageNumber.CURRENT], size: 18, color: "888888" }),
              new TextRun({ text: "  |  Confidential", size: 18, color: "888888" }),
            ],
          })],
        }),
      },
      children: [
        // ═══════════════════════════════════════════════════════════
        // SECTION 1: OVERVIEW
        // ═══════════════════════════════════════════════════════════
        heading("1. Overview", HeadingLevel.HEADING_1),
        para("This document traces the complete lifecycle of an invoice through the RIS Platform \u2014 from initial supplier eligibility checks, through risk scoring, pricing, approval, payment disbursement, buyer collection, and final settlement with profit booking. Each stage identifies the responsible role(s) and authorization requirements."),
        spacer(),

        heading("End-to-End Status Flow", HeadingLevel.HEADING_2),
        ...codeBlock([
          "draft \u2192 submitted \u2192 buyer_confirmed \u2192 scored \u2192 priced \u2192 approved",
          "\u2192 pending_first_auth \u2192 pending_second_auth \u2192 executing \u2192 funded",
          "\u2192 collecting / overdue \u2192 escalated \u2192 collected / defaulted",
          "\u2192 settlement: pending \u2192 facility_repaid \u2192 profit_booked \u2192 closed",
        ]),
        spacer(),

        heading("Platform Roles", HeadingLevel.HEADING_2),
        makeRoleTable(
          ["Role", "Primary Responsibility", "Key Stages"],
          [
            ["supplier", "Submit invoices, accept/reject pricing", "Stages 1, 5"],
            ["buyer (external)", "Confirm invoices via token link", "Stage 2"],
            ["credit_officer", "Review risk, approve low-to-mid risk invoices, manage collections", "Stages 2, 3, 5, 6, 9"],
            ["finance_manager", "Authorise payments (dual-sig), manage facilities, book settlements", "Stages 7, 8, 9, 10"],
            ["management", "Override approvals, close settlements, strategic decisions", "Stages 6, 9, 10"],
            ["compliance_officer", "AML clearance, SAR filing for flagged invoices/collections", "Stages 1, 7, 9"],
            ["auditor", "Read-only access to timelines, settlements, and audit logs", "All (read-only)"],
          ],
          [2200, 4560, 2600]
        ),
        new Paragraph({ children: [new PageBreak()] }),

        // ═══════════════════════════════════════════════════════════
        // SECTION 2: ROLE-TO-STAGE MATRIX (THE MISSING PIECE)
        // ═══════════════════════════════════════════════════════════
        heading("2. Role-to-Stage Authorization Matrix", HeadingLevel.HEADING_1),
        para("This section provides a single-page reference showing exactly who does what at each stage. Actions marked with (A) are the primary actor; (V) indicates view/read access only."),
        spacer(),

        makeRoleTable(
          ["Stage", "Action", "supplier", "credit_officer", "finance_mgr", "management", "compliance", "auditor"],
          [
            ["1. Submit", "Create & submit invoice", "A", "\u2014", "\u2014", "\u2014", "\u2014", "\u2014"],
            ["1. Submit", "View invoices", "A (own)", "V", "\u2014", "V", "V", "\u2014"],
            ["1. Submit", "AML flag review", "\u2014", "\u2014", "\u2014", "\u2014", "A", "\u2014"],
            ["2. Confirm", "Confirm invoice (token)", "buyer", "\u2014", "\u2014", "\u2014", "\u2014", "\u2014"],
            ["2. Confirm", "Resend confirmation link", "\u2014", "A", "\u2014", "\u2014", "\u2014", "\u2014"],
            ["2. Confirm", "View pending confirmations", "\u2014", "V", "\u2014", "\u2014", "\u2014", "\u2014"],
            ["3. Score", "Trigger scoring", "\u2014", "System (auto)", "\u2014", "\u2014", "\u2014", "\u2014"],
            ["3. Score", "View risk score", "\u2014", "V", "\u2014", "V", "\u2014", "\u2014"],
            ["4. Price", "Calculate pricing", "\u2014", "System (auto)", "\u2014", "\u2014", "\u2014", "\u2014"],
            ["4. Price", "View pricing details", "\u2014", "V", "V", "V", "\u2014", "\u2014"],
            ["5. Decision", "Accept pricing", "A", "\u2014", "\u2014", "\u2014", "\u2014", "\u2014"],
            ["5. Decision", "Reject pricing", "A", "\u2014", "\u2014", "\u2014", "\u2014", "\u2014"],
            ["6. Approve", "AUTO tier (< 10M, low risk)", "\u2014", "System", "\u2014", "\u2014", "\u2014", "\u2014"],
            ["6. Approve", "TIER 2 (10M-50M)", "\u2014", "A (1 sig)", "\u2014", "\u2014", "\u2014", "\u2014"],
            ["6. Approve", "TIER 3 (50M-200M)", "\u2014", "A (2 sigs)", "\u2014", "A (override: 1 sig)", "\u2014", "\u2014"],
            ["6. Approve", "TIER 4 (> 200M)", "\u2014", "A (1 of 2)", "\u2014", "A (1 of 2)", "\u2014", "\u2014"],
            ["6. Approve", "Reject invoice", "\u2014", "A", "\u2014", "A", "\u2014", "\u2014"],
            ["7. Payment", "1st authorisation", "\u2014", "\u2014", "A", "\u2014", "\u2014", "\u2014"],
            ["7. Payment", "2nd authorisation (diff user)", "\u2014", "\u2014", "A", "\u2014", "\u2014", "\u2014"],
            ["7. Payment", "AML clearance gate", "\u2014", "\u2014", "\u2014", "\u2014", "A", "\u2014"],
            ["7. Payment", "View payment status", "\u2014", "\u2014", "V", "V", "\u2014", "\u2014"],
            ["8. Drawdown", "Facility drawdown", "\u2014", "\u2014", "A (system-queued)", "\u2014", "\u2014", "\u2014"],
            ["8. Drawdown", "View facility dashboard", "\u2014", "\u2014", "V", "V", "\u2014", "\u2014"],
            ["9. Collect", "Record buyer payment", "\u2014", "A", "A", "\u2014", "\u2014", "\u2014"],
            ["9. Collect", "Escalate collection", "\u2014", "A", "A", "A", "\u2014", "\u2014"],
            ["9. Collect", "De-escalate collection", "\u2014", "A", "A", "A", "\u2014", "\u2014"],
            ["9. Collect", "SAR review (flagged)", "\u2014", "\u2014", "\u2014", "\u2014", "A", "\u2014"],
            ["9. Collect", "View collections", "\u2014", "V", "V", "V", "\u2014", "V"],
            ["10. Settle", "Initiate settlement", "\u2014", "\u2014", "System (auto)", "\u2014", "\u2014", "\u2014"],
            ["10. Settle", "Repay facility", "\u2014", "\u2014", "A", "\u2014", "\u2014", "\u2014"],
            ["10. Settle", "Book profit", "\u2014", "\u2014", "A", "\u2014", "\u2014", "\u2014"],
            ["10. Settle", "Close settlement (final)", "\u2014", "\u2014", "\u2014", "A", "\u2014", "\u2014"],
            ["10. Settle", "View settlements", "\u2014", "\u2014", "V", "V", "\u2014", "V"],
          ],
          [1200, 2200, 900, 1200, 1100, 1200, 900, 660]
        ),
        spacer(),
        para("Legend: A = Actor (performs action) | V = Viewer (read-only) | \u2014 = No access | System = Automated"),
        new Paragraph({ children: [new PageBreak()] }),

        // ═══════════════════════════════════════════════════════════
        // SECTION 3: STAGE 1
        // ═══════════════════════════════════════════════════════════
        heading("3. Stage 1: Invoice Submission & Eligibility", HeadingLevel.HEADING_1),
        boldPara("Module: ", "invoices.service.ts"),
        rolePara("supplier submits | compliance_officer reviews AML flags | credit_officer, management, compliance_officer can view"),
        spacer(),

        heading("Who Does What", HeadingLevel.HEADING_3),
        makeRoleTable(
          ["Action", "Role", "Endpoint"],
          [
            ["Create invoice draft", "supplier", "POST /invoices"],
            ["Submit invoice (triggers 5-step validation)", "supplier", "POST /invoices/:id/submit"],
            ["View own invoices", "supplier", "GET /invoices (filtered to own)"],
            ["View all invoices", "credit_officer, management, compliance_officer", "GET /invoices"],
            ["View invoice timeline", "credit_officer, management, compliance_officer, auditor", "GET /invoices/:id/timeline"],
            ["Review AML-flagged invoices", "compliance_officer", "Dashboard / manual review"],
          ],
          [3200, 3960, 2200]
        ),
        spacer(),

        heading("5-Step Validation Chain", HeadingLevel.HEADING_3),
        makeTable(
          ["Step", "Check", "Error Code"],
          [
            ["1", "Supplier KYC status = approved", "SUPPLIER_NOT_APPROVED"],
            ["2", "Invoice number unique per supplier", "DUPLICATE_INVOICE"],
            ["3", "Buyer exists AND is_active = true", "BUYER_NOT_APPROVED"],
            ["4", "Tenor within 7\u201390 days (configurable)", "TENOR_OUT_OF_RANGE"],
            ["5", "faceValue + used_limit \u2264 approved_limit", "CREDIT_LIMIT_EXCEEDED"],
          ],
          [800, 5560, 3000]
        ),
        spacer(),

        heading("AML Gate", HeadingLevel.HEADING_3),
        para("If face_value exceeds 100,000,000 UGX, the invoice is flagged (aml_flagged = true). This blocks auto-approval and requires compliance_officer review before the invoice can proceed through the approval tier."),
        spacer(),
        boldPara("Status transition: ", "draft \u2192 submitted"),
        boldPara("SLA: ", "72 hours from creation"),
        boldPara("Handoff: ", "Queue send-buyer-confirmation \u2192 Verification module"),
        new Paragraph({ children: [new PageBreak()] }),

        // ═══════════════════════════════════════════════════════════
        // SECTION 4: STAGE 2
        // ═══════════════════════════════════════════════════════════
        heading("4. Stage 2: Buyer Confirmation", HeadingLevel.HEADING_1),
        boldPara("Module: ", "verification.service.ts"),
        rolePara("buyer (external, via token link) confirms | credit_officer resends tokens & monitors pending"),
        spacer(),

        heading("Who Does What", HeadingLevel.HEADING_3),
        makeRoleTable(
          ["Action", "Role", "Endpoint"],
          [
            ["View confirmation page", "buyer (public, token-gated)", "GET /verify/:token"],
            ["Confirm invoice (4 fields)", "buyer (public, token-gated)", "POST /verify/:token/confirm"],
            ["Dispute invoice", "buyer (public, token-gated)", "POST /verify/:token/dispute"],
            ["View pending confirmations", "credit_officer", "GET /verify/admin/invoices/pending-confirmation"],
            ["Resend confirmation link", "credit_officer", "POST /verify/admin/invoices/:id/resend-confirmation"],
          ],
          [3200, 3200, 3000]
        ),
        spacer(),

        heading("Confirmation Fields", HeadingLevel.HEADING_3),
        makeTable(
          ["Field", "Description"],
          [
            ["invoice_is_valid", "Buyer confirms the invoice is legitimate"],
            ["amount_is_correct", "Face value matches buyer records"],
            ["due_date_is_correct", "Payment due date is accurate"],
            ["agrees_to_pay_mms", "Buyer agrees to pay RIS (not the supplier) on the due date"],
          ],
          [3000, 6360]
        ),
        spacer(),
        para("All four fields must be true. If any is false, the system throws CONFIRMATION_INCOMPLETE. Tokens are SHA-256 hashed for DB storage; raw token sent via email with 48-hour expiry."),
        spacer(),
        boldPara("Status transition: ", "submitted \u2192 buyer_confirmed"),
        boldPara("Handoff: ", "Queue score-invoice \u2192 Risk Engine"),
        spacer(),

        // ═══════════════════════════════════════════════════════════
        // SECTION 5: STAGE 3
        // ═══════════════════════════════════════════════════════════
        heading("5. Stage 3: Risk Scoring", HeadingLevel.HEADING_1),
        boldPara("Module: ", "risk-engine.service.ts"),
        rolePara("System (automatic, BullMQ worker) scores | credit_officer, management can view results"),
        spacer(),

        heading("Who Does What", HeadingLevel.HEADING_3),
        makeRoleTable(
          ["Action", "Role", "Endpoint"],
          [
            ["Trigger scoring", "System (automatic after buyer confirms)", "BullMQ worker: score-invoice"],
            ["View risk score & factor breakdown", "credit_officer, management", "GET /risk-engine/:id/risk-score"],
          ],
          [3200, 3600, 2560]
        ),
        spacer(),

        heading("5-Factor Scoring (weights from risk_config table, must sum to 1.0)", HeadingLevel.HEADING_3),
        makeTable(
          ["Factor", "Weight", "Scoring Logic"],
          [
            ["Buyer Credit Rating", "0.30", "A=100, B=75, C=50, D=25"],
            ["Supplier Track Record", "0.25", "On-time history, default count"],
            ["Collateral Coverage", "0.20", "Active collateral vs face value"],
            ["Concentration Risk", "0.15", "Buyer exposure %; >30% = score 0"],
            ["Tenor", "0.10", "Shorter tenor = higher score"],
          ],
          [2800, 1200, 5360]
        ),
        spacer(),

        heading("Threshold Routing", HeadingLevel.HEADING_3),
        makeTable(
          ["Score", "Recommendation", "Max Advance", "Risk Premium", "Next Step"],
          [
            ["\u2265 75", "AUTO_APPROVE", "95%", "0%", "Auto-price, auto-approve eligible"],
            ["60\u201374", "REFER_TO_MANAGER", "90%", "0.5\u20131%", "Manual approval required"],
            ["50\u201359", "REFER_TO_MANAGER", "85%", "1.5%", "Manual approval required"],
            ["< 50", "REJECT", "0%", "N/A", "Invoice auto-rejected"],
          ],
          [1000, 2200, 1500, 1500, 3160]
        ),
        spacer(),
        boldPara("Status transition: ", "buyer_confirmed \u2192 scored (or rejected if score < 50)"),
        boldPara("Handoff: ", "Queue price-invoice \u2192 Pricing (or invoice-rejected notification)"),
        new Paragraph({ children: [new PageBreak()] }),

        // ═══════════════════════════════════════════════════════════
        // SECTION 6: STAGE 4
        // ═══════════════════════════════════════════════════════════
        heading("6. Stage 4: Pricing Calculation", HeadingLevel.HEADING_1),
        boldPara("Module: ", "pricing.service.ts"),
        rolePara("System (automatic) calculates | credit_officer, finance_manager, management can view | finance_manager sets bank rate | management sets RIS margin"),
        spacer(),

        heading("Who Does What", HeadingLevel.HEADING_3),
        makeRoleTable(
          ["Action", "Role", "Detail"],
          [
            ["Calculate pricing", "System (automatic after scoring)", "BullMQ worker: price-invoice"],
            ["View pricing breakdown", "credit_officer, finance_manager, management", "GET /pricing/:id/pricing"],
            ["Set bank_cost_rate (facility interest)", "finance_manager", "Via facility creation/config"],
            ["Set mms_margin_rate (per buyer)", "management", "Via buyer configuration"],
            ["Set risk_premium_rate", "System (risk engine output)", "Automatic from risk score"],
          ],
          [3000, 3560, 2800]
        ),
        spacer(),

        heading("Pricing Formula (BigInt, PRECISION = 1e8)", HeadingLevel.HEADING_3),
        ...codeBlock([
          "totalAnnualRate  = bankCost + riskPremium + mmsMargin",
          "discountRate     = totalAnnualRate x (tenor / 365)",
          "advanceAmount    = faceValue x maxAdvancePct",
          "discountAmount   = faceValue x discountRate",
          "netPayment       = advanceAmount - discountAmount",
        ]),
        spacer(),
        boldPara("Status transition: ", "scored \u2192 priced"),
        boldPara("Handoff: ", "None \u2014 awaits supplier decision"),
        spacer(),

        // ═══════════════════════════════════════════════════════════
        // SECTION 7: STAGE 5
        // ═══════════════════════════════════════════════════════════
        heading("7. Stage 5: Supplier Pricing Decision", HeadingLevel.HEADING_1),
        boldPara("Module: ", "pricing.service.ts"),
        rolePara("supplier accepts or rejects pricing terms"),
        spacer(),

        heading("Who Does What", HeadingLevel.HEADING_3),
        makeRoleTable(
          ["Action", "Role", "Endpoint", "Result"],
          [
            ["Accept pricing", "supplier", "POST /pricing/:id/pricing/accept", "Queues approve-invoice"],
            ["Reject pricing (with reason)", "supplier", "POST /pricing/:id/pricing/reject", "Invoice \u2192 rejected"],
          ],
          [2200, 1400, 3560, 2200]
        ),
        spacer(),
        para("The supplier sees a transparent fee breakdown: face value, advance %, discount amount, net payment to supplier, and the three fee components (bank cost, risk premium, RIS margin)."),
        spacer(),

        // ═══════════════════════════════════════════════════════════
        // SECTION 8: STAGE 6
        // ═══════════════════════════════════════════════════════════
        heading("8. Stage 6: Approval Routing", HeadingLevel.HEADING_1),
        boldPara("Module: ", "approvals.service.ts"),
        rolePara("credit_officer approves TIER 2\u20134 | management overrides TIER 3, required for TIER 4 | System auto-approves AUTO tier"),
        spacer(),

        heading("Who Does What", HeadingLevel.HEADING_3),
        makeRoleTable(
          ["Action", "Role", "Endpoint"],
          [
            ["Approve invoice", "credit_officer, management", "POST /approvals/:id/approve"],
            ["Reject invoice (with comments)", "credit_officer, management", "POST /approvals/:id/reject"],
            ["View approval queue", "credit_officer, management", "GET /approvals/queue"],
          ],
          [3200, 3200, 2960]
        ),
        spacer(),

        heading("4-Tier Approval Matrix", HeadingLevel.HEADING_3),
        makeTable(
          ["Tier", "Trigger", "Who Approves", "Quorum", "management Override?"],
          [
            ["AUTO", "< 10M, score \u2265 75, no AML", "SYSTEM (immediate)", "Instant", "N/A"],
            ["TIER 2", "10M\u201350M or score 50\u201374 or AML", "1 credit_officer", "1 sig", "Not needed"],
            ["TIER 3", "50M\u2013200M or score < 50", "2 different credit_officers", "2 sigs", "Yes: 1 management = approved"],
            ["TIER 4", "> 200M or score < 30", "1 management + 1 credit_officer", "2 sigs (both roles)", "management required"],
          ],
          [1100, 2600, 2600, 1400, 1660]
        ),
        spacer(),
        para("CRITICAL: Same user cannot provide both signatures in TIER 3/TIER 4. Enforced at application layer. Concurrency lock: SELECT ... FOR UPDATE NOWAIT. SLA: 24 hours from scored to final decision."),
        spacer(),
        boldPara("Status transition: ", "priced \u2192 approved (or rejected)"),
        boldPara("Handoff: ", "Queue process-payment \u2192 Payments module"),
        new Paragraph({ children: [new PageBreak()] }),

        // ═══════════════════════════════════════════════════════════
        // SECTION 9: STAGE 7
        // ═══════════════════════════════════════════════════════════
        heading("9. Stage 7: Payment & Dual Authorization", HeadingLevel.HEADING_1),
        boldPara("Module: ", "payments.service.ts"),
        rolePara("finance_manager (x2, different users) authorises payments | compliance_officer clears AML gate | management can view"),
        spacer(),

        heading("Who Does What", HeadingLevel.HEADING_3),
        makeRoleTable(
          ["Action", "Role", "Endpoint", "Constraint"],
          [
            ["1st payment authorisation", "finance_manager", "POST /payments/:id/authorise", "Creates payment, sets user_1"],
            ["2nd payment authorisation", "finance_manager (different person)", "POST /payments/:id/authorise", "user_1 \u2260 user_2 (enforced 3 ways)"],
            ["AML clearance (if flagged)", "compliance_officer", "Manual clearance", "Required if face \u2265 100M UGX"],
            ["View pending payments", "finance_manager, management", "GET /payments/pending", "Read-only"],
            ["View payment details", "finance_manager, management", "GET /payments/:id", "Read-only"],
            ["Manual retry (after failure)", "finance_manager", "POST /payments/:id/authorise", "Re-enters dual-auth flow"],
          ],
          [2200, 2600, 2560, 2000]
        ),
        spacer(),

        heading("Pre-Payment Gates (all must pass)", HeadingLevel.HEADING_3),
        makeTable(
          ["Gate", "Business Rule", "Error if Failed"],
          [
            ["Collateral", "Coverage ratio \u2265 50% of face value", "COLLATERAL_INSUFFICIENT"],
            ["Facility", "Active facility available_amount \u2265 payment", "FACILITY_INSUFFICIENT"],
            ["Idempotency", "No duplicate payment for same invoice", "Returns existing record"],
          ],
          [2000, 4760, 2600]
        ),
        spacer(),

        heading("Dual Authorization \u2014 Three-Layer Enforcement", HeadingLevel.HEADING_3),
        makeTable(
          ["Layer", "Mechanism", "What It Enforces"],
          [
            ["1. Application", "authoriseFirstAuth() / authoriseSecondAuth()", "dual_auth_user_1 \u2260 dual_auth_user_2"],
            ["2. DB Trigger", "payments_dual_auth_check PostgreSQL trigger", "Same check at database level (defence in depth)"],
            ["3. Provider", "Only webhook callback can set funded status", "Prevents false-positive funding without real money movement"],
          ],
          [2000, 4160, 3200]
        ),
        spacer(),

        heading("Payment Status Flow", HeadingLevel.HEADING_3),
        ...codeBlock([
          "approved \u2192 pending_first_auth    (payment record created by finance_manager #1)",
          "         \u2192 pending_second_auth   (finance_manager #1 authorises)",
          "         \u2192 executing              (finance_manager #2 authorises, MUST be different person)",
          "         \u2192 funded / failed        (MTN/Airtel/EFT webhook callback)",
        ]),
        spacer(),

        heading("Provider Integration", HeadingLevel.HEADING_3),
        makeTable(
          ["Provider", "API Endpoint", "Idempotency"],
          [
            ["MTN MoMo", "/disbursement/v1_0/transfer", "X-Reference-Id header"],
            ["Airtel Money", "/merchant/v2/payments", "reference field in payload"],
            ["Bank EFT", "ACH batch format", "Embedded in ACH record"],
          ],
          [2200, 4160, 3000]
        ),
        spacer(),
        para("All webhooks verified with HMAC-SHA256 using crypto.timingSafeEqual (timing-safe). Duplicate webhooks discarded via webhook_events table."),
        spacer(),
        boldPara("SLA: ", "72 hours from payment creation. Escalation warning at 66 hours to management."),
        new Paragraph({ children: [new PageBreak()] }),

        // ═══════════════════════════════════════════════════════════
        // SECTION 10: STAGE 8
        // ═══════════════════════════════════════════════════════════
        heading("10. Stage 8: Facility Drawdown", HeadingLevel.HEADING_1),
        boldPara("Module: ", "facilities.service.ts"),
        rolePara("System (automatic queue) draws down | finance_manager manages facilities & views dashboard | management views dashboard"),
        spacer(),

        heading("Who Does What", HeadingLevel.HEADING_3),
        makeRoleTable(
          ["Action", "Role", "Detail"],
          [
            ["Create facility drawdown", "System (BullMQ: facility-drawdown)", "Automatic after funding confirmed"],
            ["Create bank facility", "finance_manager", "POST /facilities (one active at a time)"],
            ["View facility dashboard", "finance_manager, management", "GET /facilities/dashboard"],
            ["Repay drawdown", "finance_manager", "POST /facilities/:id/repay"],
          ],
          [3000, 3560, 2800]
        ),
        spacer(),

        heading("Utilisation Thresholds", HeadingLevel.HEADING_3),
        makeTable(
          ["Utilisation", "Action", "Notified Role"],
          [
            ["\u2265 90%", "BLOCK new drawdowns (UTILISATION_EXCEEDED)", "finance_manager, management"],
            ["\u2265 80%", "WARNING notification (allow drawdown)", "finance_manager"],
            ["< 80%", "Normal operation", "None"],
          ],
          [1600, 5160, 2600]
        ),
        spacer(),
        para("Interest accrues nightly (RATE_PRECISION = 1e9): daily = principal x (annual_rate / 365). Only one facility can be active at a time."),
        spacer(),

        // ═══════════════════════════════════════════════════════════
        // SECTION 11: STAGE 9
        // ═══════════════════════════════════════════════════════════
        heading("11. Stage 9: Collections", HeadingLevel.HEADING_1),
        boldPara("Module: ", "collections.service.ts"),
        rolePara("credit_officer and finance_manager record payments & escalate | management escalates/de-escalates | compliance_officer handles SAR reviews | auditor views"),
        spacer(),

        heading("Who Does What", HeadingLevel.HEADING_3),
        makeRoleTable(
          ["Action", "Role", "Endpoint"],
          [
            ["View all collections", "credit_officer, finance_manager, management, auditor", "GET /collections"],
            ["Record buyer payment received", "credit_officer, finance_manager", "POST /collections/:id/payments"],
            ["Escalate collection", "credit_officer, finance_manager, management", "POST /collections/:id/escalate"],
            ["De-escalate collection", "credit_officer, finance_manager, management", "POST /collections/:id/de-escalate"],
            ["Resolve collection", "credit_officer, finance_manager, management", "POST /collections/:id/resolve"],
            ["SAR review (flagged collections)", "compliance_officer", "Manual review + FIA Uganda filing"],
            ["View overdue invoices", "credit_officer, management", "GET /collections/overdue"],
          ],
          [3200, 4000, 2160]
        ),
        spacer(),

        heading("Escalation Ladder & SAR Trigger", HeadingLevel.HEADING_3),
        makeTable(
          ["Days Overdue", "Level", "Action", "SAR Flag?", "Notified Role"],
          [
            ["\u2265 3", "1", "Formal reminder", "No", "credit_officer"],
            ["\u2265 7", "2", "Demand notice", "Yes (if \u2265 100M UGX)", "management"],
            ["\u2265 14", "3", "Legal action", "Yes (if \u2265 100M UGX)", "management + legal"],
            ["\u2265 90", "\u2014", "Auto-default (bad_debt)", "Yes (if flagged)", "finance_manager + management"],
          ],
          [1200, 800, 2200, 2360, 2800]
        ),
        spacer(),
        para("Penalty: 0.1% per day (BigInt, PENALTY_PRECISION = 1,000,000). SAR trigger: escalation level \u2265 2 AND face_value \u2265 100M UGX. compliance_officer must manually file SAR with FIA Uganda."),
        spacer(),

        heading("Payment Received \u2192 Triple Queue Dispatch", HeadingLevel.HEADING_3),
        para("When credit_officer or finance_manager records a buyer payment, three queues fire in parallel after COMMIT:"),
        spacer(),
        makeTable(
          ["Queue", "Target", "Purpose"],
          [
            ["facility-repayment", "Facilities", "Repay drawdown principal + accrued interest"],
            ["settlement-initiate", "Settlements", "Begin profit booking workflow"],
            ["supplier-payment-notification", "Notifications", "Inform supplier of buyer payment"],
          ],
          [3200, 2400, 3760]
        ),
        new Paragraph({ children: [new PageBreak()] }),

        // ═══════════════════════════════════════════════════════════
        // SECTION 12: STAGE 10
        // ═══════════════════════════════════════════════════════════
        heading("12. Stage 10: Settlement & Profit Booking", HeadingLevel.HEADING_1),
        boldPara("Module: ", "settlements.service.ts"),
        rolePara("finance_manager repays facility & books profit | management closes settlement (final sign-off) | auditor views"),
        spacer(),

        heading("Who Does What", HeadingLevel.HEADING_3),
        makeRoleTable(
          ["Action", "Role", "Endpoint", "Status After"],
          [
            ["Initiate settlement", "System (queue worker)", "BullMQ: settlement-initiate", "pending"],
            ["Repay facility", "finance_manager", "POST /settlements/:id/repay-facility", "facility_repaid"],
            ["Book profit (immutable record)", "finance_manager", "POST /settlements/:id/book-profit", "profit_booked"],
            ["Close settlement (final)", "management", "POST /settlements/:id/close", "closed"],
            ["View settlement details", "finance_manager, management, auditor", "GET /settlements/:id", "N/A"],
            ["View all settlements", "finance_manager, management, auditor", "GET /settlements", "N/A"],
          ],
          [2400, 2400, 2960, 1600]
        ),
        spacer(),

        heading("Settlement Status Flow", HeadingLevel.HEADING_3),
        ...codeBlock([
          "pending              [System creates after buyer payment received]",
          "  \u2192 facility_repaid  [finance_manager records bank repayment]",
          "  \u2192 profit_booked    [finance_manager books: netProfit = discount - bankCost + penalty]",
          "  \u2192 closed           [management final sign-off; supplier notified]",
        ]),
        spacer(),
        para("The profit_bookings table is immutable \u2014 a PostgreSQL trigger prevents UPDATE or DELETE. This is a compliance requirement ensuring financial records are tamper-proof."),
        new Paragraph({ children: [new PageBreak()] }),

        // ═══════════════════════════════════════════════════════════
        // SECTION 13: CROSS-MODULE
        // ═══════════════════════════════════════════════════════════
        heading("13. Cross-Module Queue Architecture", HeadingLevel.HEADING_1),
        para("All modules communicate via BullMQ queues. Queue jobs are dispatched AFTER COMMIT (never inside transactions). All jobs use 3 retries with exponential backoff (30s / 120s / 480s)."),
        spacer(),
        makeTable(
          ["From", "Queue Job", "To", "Trigger"],
          [
            ["Invoices", "send-buyer-confirmation", "Verification", "After invoice submitted"],
            ["Verification", "score-invoice", "Risk Engine", "After buyer confirmed"],
            ["Risk Engine", "price-invoice", "Pricing", "After scoring (if not rejected)"],
            ["Pricing", "approve-invoice", "Approvals", "After supplier accepts pricing"],
            ["Approvals", "process-payment", "Payments", "After approval (any tier)"],
            ["Payments", "facility-drawdown", "Facilities", "After funding confirmed"],
            ["Collections", "facility-repayment", "Facilities", "After buyer payment received"],
            ["Collections", "settlement-initiate", "Settlements", "After buyer payment received"],
            ["Settlements", "settlement_complete", "Notifications", "After management closes"],
          ],
          [2000, 2800, 2200, 2360]
        ),
        spacer(),

        // ═══════════════════════════════════════════════════════════
        // SECTION 14: INVARIANTS
        // ═══════════════════════════════════════════════════════════
        heading("14. Platform-Wide Invariants", HeadingLevel.HEADING_1),
        makeTable(
          ["#", "Rule", "Enforcement"],
          [
            ["1", "All money is BigInt", "No floating-point arithmetic on monetary values, ever"],
            ["2", "Audit log inside every transaction", "INSERT INTO audit_logs before COMMIT"],
            ["3", "Supplier ownership in SQL", "WHERE id=$1 AND supplier_id=$2 in every supplier query"],
            ["4", "No PII in queues or logs", "Only IDs in payloads; worker fetches encrypted PII from DB"],
            ["5", "Status transitions are atomic", "Single PostgreSQL transaction per status change"],
            ["6", "Queue jobs fire after COMMIT", "Never dispatch jobs inside a transaction"],
            ["7", "Parameterised SQL only", "Zero string concatenation in queries"],
            ["8", "AES-256 encryption on all PII", "Encrypt before INSERT; decrypt after SELECT in service layer"],
            ["9", "Dual auth on all payments", "3 independent enforcement layers (app + DB trigger + provider)"],
            ["10", "Immutable profit bookings", "DB trigger prevents UPDATE/DELETE on profit_bookings table"],
          ],
          [500, 3600, 5260]
        ),
        spacer(),

        // ═══════════════════════════════════════════════════════════
        // SECTION 15: COMPLETE DIAGRAM
        // ═══════════════════════════════════════════════════════════
        heading("15. Complete Status Transition Diagram (with Roles)", HeadingLevel.HEADING_1),
        para("Each transition shows the responsible role in parentheses:"),
        spacer(),
        ...codeBlock([
          "draft",
          "  \u2514\u2500> submitted                     [supplier submits]",
          "       \u2514\u2500> buyer_confirmed            [buyer confirms via token link]",
          "            \u2514\u2500> scored                 [System: risk-engine auto-scores]",
          "                 |\u2500> rejected            [System: if score < 50]",
          "                 \u2514\u2500> priced              [System: pricing auto-calculates]",
          "                      |\u2500> rejected        [supplier rejects pricing]",
          "                      \u2514\u2500> approved        [credit_officer / management approves]",
          "                           \u2514\u2500> pending_first_auth   [finance_manager #1]",
          "                                \u2514\u2500> pending_second_auth [finance_manager #1 authorises]",
          "                                     \u2514\u2500> executing        [finance_manager #2 authorises]",
          "                                          |\u2500> funded      [provider webhook confirms]",
          "                                          \u2514\u2500> failed      [provider webhook fails]",
          "",
          "  funded",
          "    \u2514\u2500> overdue                       [System: T+1 auto-detection]",
          "         \u2514\u2500> escalated                [credit_officer / management escalates]",
          "              |\u2500> collected            [credit_officer / finance_manager records payment]",
          "              \u2514\u2500> defaulted            [System: 90+ days auto-default]",
          "",
          "  settlement: pending                    [System: auto-initiated on payment]",
          "    \u2514\u2500> facility_repaid              [finance_manager records repayment]",
          "         \u2514\u2500> profit_booked            [finance_manager books profit]",
          "              \u2514\u2500> closed               [management final sign-off]",
        ]),
      ],
    },
  ],
});

Packer.toBuffer(doc).then((buffer) => {
  const outPath = "C:/Users/magol/Desktop/MMS-Platform/01-Documents/RIS-Transaction-Flow-Complete.docx";
  fs.writeFileSync(outPath, buffer);
  console.log("Created: " + outPath);
});
