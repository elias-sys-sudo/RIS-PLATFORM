import { http, HttpResponse, delay, passthrough } from 'msw';
import type {
  Collection,
  CollectionDetail,
  PaginatedCollections,
  CollectionPayment,
  EscalationEvent,
  BuyerContact,
  CollectionStatus,
  CollectionSortField,
  CollectionSummaryStats,
  PaymentMethod,
  RecordPaymentPayload,
  EscalatePayload,
  DeescalatePayload,
} from '../../types/collection.types';
import type { EscalationLevel } from '../../lib/constants';
import type { InvoiceStatus } from '../../lib/constants';
import { MOCK_INVOICES } from './invoice.handlers';
import { addSettlement } from './settlements.handlers';

// ── Buyer contacts ────────────────────────────────────────────────────────────

const BUYER_CONTACTS: Record<string, BuyerContact> = {
  buyer_101: {
    id: 'buyer_101', company: 'Stanbic Bank Uganda', contactPerson: 'Grace Namukasa',
    email: 'payables@stanbic.co.ug', phone: '+256 312 224 600',
    address: 'Plot 17 Hannington Road, Kampala', paymentTermsDays: 45,
  },
  buyer_102: {
    id: 'buyer_102', company: 'MTN Uganda Ltd', contactPerson: 'Robert Ssali',
    email: 'finance@mtn.co.ug', phone: '+256 312 111 500',
    address: 'MTN Towers, 22 Hannington Road, Kampala', paymentTermsDays: 60,
  },
  buyer_103: {
    id: 'buyer_103', company: 'Uganda Breweries Ltd', contactPerson: 'Susan Nakalembe',
    email: 'accounts@ubl.co.ug', phone: '+256 414 321 001',
    address: 'Plot 3 Portbell Road, Nakawa', paymentTermsDays: 30,
  },
  buyer_104: {
    id: 'buyer_104', company: 'Airtel Uganda', contactPerson: 'Patrick Ochieng',
    email: 'payables@airtel.co.ug', phone: '+256 312 200 100',
    address: 'Plot 1 Kimathi Avenue, Kampala', paymentTermsDays: 60,
  },
  buyer_105: {
    id: 'buyer_105', company: 'Dfcu Bank', contactPerson: 'Agnes Nanteza',
    email: 'operations@dfcu.co.ug', phone: '+256 414 234 700',
    address: 'Plot 2 Jinja Road, Kampala', paymentTermsDays: 45,
  },
  buyer_106: {
    id: 'buyer_106', company: 'Nile Breweries Ltd', contactPerson: 'James Okello',
    email: 'finance@nilebreweries.co.ug', phone: '+256 434 123 456',
    address: 'Nile Brewery Road, Jinja', paymentTermsDays: 30,
  },
  buyer_107: {
    id: 'buyer_107', company: 'Uganda Telecom Ltd', contactPerson: 'Harriet Atim',
    email: 'payables@utl.co.ug', phone: '+256 417 700 100',
    address: 'Plot 2 Kampala Road, Kampala', paymentTermsDays: 45,
  },
};

// ── Base (seed) data — never mutated ──────────────────────────────────────────

const SEED_ESCALATION: Record<string, EscalationEvent[]> = {
  col_001: [],
  col_002: [
    { id: 'esc_002_1', level: 'reminder', levelNumber: 1, label: 'Reminder Sent',
      occurredAt: '2026-03-20T09:00:00Z', actorName: 'Amina Zawedde',
      actorRole: 'credit_officer', notes: 'Automated payment reminder sent via email and SMS.' },
  ],
  col_003: [
    { id: 'esc_003_1', level: 'reminder', levelNumber: 1, label: 'Reminder Sent',
      occurredAt: '2026-02-28T10:00:00Z', actorName: 'Amina Zawedde',
      actorRole: 'credit_officer', notes: 'First reminder sent. Buyer acknowledged receipt.' },
  ],
  col_004: [
    { id: 'esc_004_1', level: 'reminder', levelNumber: 1, label: 'Reminder Sent',
      occurredAt: '2026-02-15T09:30:00Z', actorName: 'Amina Zawedde',
      actorRole: 'credit_officer', notes: 'Initial reminder. No response received.' },
    { id: 'esc_004_2', level: 'formal', levelNumber: 2, label: 'Formal Notice Issued',
      occurredAt: '2026-02-22T11:00:00Z', actorName: 'Brian Kiggundu',
      actorRole: 'finance_manager', notes: 'Formal demand letter issued. 7-day cure period.' },
  ],
  col_005: [
    { id: 'esc_005_1', level: 'reminder', levelNumber: 1, label: 'Reminder Sent',
      occurredAt: '2026-02-05T08:00:00Z', actorName: 'Amina Zawedde',
      actorRole: 'credit_officer', notes: 'Automated reminder sent.' },
    { id: 'esc_005_2', level: 'formal', levelNumber: 2, label: 'Formal Notice Issued',
      occurredAt: '2026-02-12T10:00:00Z', actorName: 'Brian Kiggundu',
      actorRole: 'finance_manager', notes: 'Demand letter with 14-day repayment schedule.' },
  ],
  col_006: [
    { id: 'esc_006_1', level: 'reminder', levelNumber: 1, label: 'Reminder Sent',
      occurredAt: '2026-01-10T09:00:00Z', actorName: 'Amina Zawedde',
      actorRole: 'credit_officer', notes: 'First contact. Buyer claimed cash flow issues.' },
    { id: 'esc_006_2', level: 'formal', levelNumber: 2, label: 'Formal Notice Issued',
      occurredAt: '2026-01-17T11:00:00Z', actorName: 'Brian Kiggundu',
      actorRole: 'finance_manager', notes: 'Formal demand letter sent registered post.' },
    { id: 'esc_006_3', level: 'legal', levelNumber: 3, label: 'Legal Action Initiated',
      occurredAt: '2026-01-28T14:00:00Z', actorName: 'Sarah Nassali',
      actorRole: 'management', notes: 'File referred to Sebalu & Lule Advocates. Recovery proceedings commenced.' },
  ],
  col_007: [
    { id: 'esc_007_1', level: 'reminder', levelNumber: 1, label: 'Reminder Sent',
      occurredAt: '2025-12-20T09:00:00Z', actorName: 'Amina Zawedde',
      actorRole: 'credit_officer', notes: 'Multiple calls and emails unanswered.' },
    { id: 'esc_007_2', level: 'formal', levelNumber: 2, label: 'Formal Notice Issued',
      occurredAt: '2026-01-02T10:00:00Z', actorName: 'Brian Kiggundu',
      actorRole: 'finance_manager', notes: 'Formal letter sent via courier. Delivery confirmed.' },
    { id: 'esc_007_3', level: 'legal', levelNumber: 3, label: 'Legal Action Initiated',
      occurredAt: '2026-01-12T14:30:00Z', actorName: 'Sarah Nassali',
      actorRole: 'management', notes: 'HCCS filed at High Court Kampala Commercial Division.' },
    { id: 'esc_007_4', level: 'legal', levelNumber: 4, label: 'SAR Filed with FIA',
      occurredAt: '2026-01-18T16:00:00Z', actorName: 'David Mwesige',
      actorRole: 'compliance_officer',
      notes: 'Suspicious Activity Report filed with Financial Intelligence Authority Uganda. Amount exceeds AML threshold of UGX 100M.' },
  ],
  col_008: [
    { id: 'esc_008_1', level: 'reminder', levelNumber: 1, label: 'Reminder Sent',
      occurredAt: '2026-03-18T09:00:00Z', actorName: 'Amina Zawedde',
      actorRole: 'credit_officer', notes: 'Buyer requested 5-day extension.' },
  ],
  col_009: [],
  col_010: [
    { id: 'esc_010_1', level: 'reminder', levelNumber: 1, label: 'Reminder Sent',
      occurredAt: '2026-01-05T09:00:00Z', actorName: 'Amina Zawedde',
      actorRole: 'credit_officer', notes: 'Buyer confirmed payment in transit.' },
    { id: 'esc_010_2', level: 'formal', levelNumber: 2, label: 'Formal Notice Issued',
      occurredAt: '2026-01-12T10:00:00Z', actorName: 'Brian Kiggundu',
      actorRole: 'finance_manager', notes: 'Payment delayed beyond promised date. Formal notice issued.' },
  ],
  col_011: [
    { id: 'esc_011_1', level: 'reminder', levelNumber: 1, label: 'Reminder Sent',
      occurredAt: '2025-11-10T09:00:00Z', actorName: 'Amina Zawedde',
      actorRole: 'credit_officer', notes: 'Buyer unresponsive.' },
    { id: 'esc_011_2', level: 'formal', levelNumber: 2, label: 'Formal Notice Issued',
      occurredAt: '2025-11-18T10:00:00Z', actorName: 'Brian Kiggundu',
      actorRole: 'finance_manager', notes: 'Demand letter hand-delivered.' },
    { id: 'esc_011_3', level: 'legal', levelNumber: 3, label: 'Legal Action Initiated',
      occurredAt: '2025-11-28T13:00:00Z', actorName: 'Sarah Nassali',
      actorRole: 'management', notes: 'Writ of summons filed.' },
    { id: 'esc_011_4', level: 'legal', levelNumber: 4, label: 'SAR Filed with FIA',
      occurredAt: '2025-12-04T15:00:00Z', actorName: 'David Mwesige',
      actorRole: 'compliance_officer',
      notes: 'SAR filed. Buyer linked to two other delinquent accounts exceeding UGX 500M combined. Referred to BOU.' },
  ],
  col_012: [],
};

const SEED_PAYMENTS: Record<string, CollectionPayment[]> = {
  col_001: [
    { id: 'pay_001_1', amount: 15_000_000, paymentDate: '2026-03-10T10:30:00Z',
      method: 'Bank Transfer', reference: 'EFT-2026-03-1045',
      runningBalance: 30_000_000, notes: 'Partial payment per installment agreement.' },
    { id: 'pay_001_2', amount: 10_000_000, paymentDate: '2026-03-18T14:00:00Z',
      method: 'MTN Mobile Money', reference: 'MTNMM-20260318-9921',
      runningBalance: 20_000_000, notes: null },
  ],
  col_002: [
    { id: 'pay_002_1', amount: 20_000_000, paymentDate: '2026-03-05T09:00:00Z',
      method: 'Bank Transfer', reference: 'EFT-2026-03-0812',
      runningBalance: 100_000_000, notes: 'First partial payment.' },
    { id: 'pay_002_2', amount: 15_000_000, paymentDate: '2026-03-22T16:30:00Z',
      method: 'MTN Mobile Money', reference: 'MTNMM-20260322-4401',
      runningBalance: 85_000_000, notes: null },
  ],
  col_003: [
    { id: 'pay_003_1', amount: 8_000_000, paymentDate: '2026-02-20T11:00:00Z',
      method: 'Airtel Money', reference: 'ATA-20260220-7731',
      runningBalance: 42_000_000, notes: null },
    { id: 'pay_003_2', amount: 5_000_000, paymentDate: '2026-03-05T13:00:00Z',
      method: 'Bank Transfer', reference: 'EFT-2026-03-0301',
      runningBalance: 37_000_000, notes: 'Buyer disputes remaining balance.' },
    { id: 'pay_003_3', amount: 7_000_000, paymentDate: '2026-03-20T10:00:00Z',
      method: 'Bank Transfer', reference: 'EFT-2026-03-2004',
      runningBalance: 30_000_000, notes: null },
  ],
  col_004: [
    { id: 'pay_004_1', amount: 30_000_000, paymentDate: '2026-02-01T09:00:00Z',
      method: 'Bank Transfer', reference: 'EFT-2026-02-0109',
      runningBalance: 145_000_000, notes: null },
    { id: 'pay_004_2', amount: 25_000_000, paymentDate: '2026-02-14T15:00:00Z',
      method: 'Bank Transfer', reference: 'EFT-2026-02-1415',
      runningBalance: 120_000_000, notes: 'Payment received after formal notice.' },
  ],
  col_005: [
    { id: 'pay_005_1', amount: 10_000_000, paymentDate: '2026-01-28T10:00:00Z',
      method: 'MTN Mobile Money', reference: 'MTNMM-20260128-6612',
      runningBalance: 65_000_000, notes: 'Token payment. Buyer seeking refinancing.' },
  ],
  col_006: [
    { id: 'pay_006_1', amount: 50_000_000, paymentDate: '2025-12-15T09:00:00Z',
      method: 'Bank Transfer', reference: 'EFT-2025-12-1520',
      runningBalance: 180_000_000, notes: null },
    { id: 'pay_006_2', amount: 30_000_000, paymentDate: '2026-01-05T14:00:00Z',
      method: 'Bank Transfer', reference: 'EFT-2026-01-0514',
      runningBalance: 150_000_000, notes: 'Payment made under legal pressure.' },
  ],
  col_007: [
    { id: 'pay_007_1', amount: 40_000_000, paymentDate: '2025-11-20T10:00:00Z',
      method: 'Bank Transfer', reference: 'EFT-2025-11-2010',
      runningBalance: 260_000_000, notes: null },
  ],
  col_008: [
    { id: 'pay_008_1', amount: 18_000_000, paymentDate: '2026-03-14T09:00:00Z',
      method: 'MTN Mobile Money', reference: 'MTNMM-20260314-3301',
      runningBalance: 57_000_000, notes: null },
    { id: 'pay_008_2', amount: 10_000_000, paymentDate: '2026-03-21T11:30:00Z',
      method: 'Airtel Money', reference: 'ATA-20260321-8812',
      runningBalance: 47_000_000, notes: null },
  ],
  col_009: [
    { id: 'pay_009_1', amount: 25_000_000, paymentDate: '2026-01-10T09:00:00Z',
      method: 'Bank Transfer', reference: 'EFT-2026-01-1009',
      runningBalance: 35_000_000, notes: null },
    { id: 'pay_009_2', amount: 20_000_000, paymentDate: '2026-01-20T14:00:00Z',
      method: 'MTN Mobile Money', reference: 'MTNMM-20260120-5501',
      runningBalance: 15_000_000, notes: null },
    { id: 'pay_009_3', amount: 15_000_000, paymentDate: '2026-01-28T10:00:00Z',
      method: 'Bank Transfer', reference: 'EFT-2026-01-2810',
      runningBalance: 0, notes: 'Final payment. Account settled.' },
  ],
  col_010: [
    { id: 'pay_010_1', amount: 40_000_000, paymentDate: '2026-01-08T09:00:00Z',
      method: 'Bank Transfer', reference: 'EFT-2026-01-0809',
      runningBalance: 80_000_000, notes: null },
    { id: 'pay_010_2', amount: 50_000_000, paymentDate: '2026-01-18T10:00:00Z',
      method: 'Bank Transfer', reference: 'EFT-2026-01-1810',
      runningBalance: 30_000_000, notes: 'Partial payment after formal notice.' },
    { id: 'pay_010_3', amount: 30_000_000, paymentDate: '2026-01-29T15:00:00Z',
      method: 'Bank Transfer', reference: 'EFT-2026-01-2915',
      runningBalance: 0, notes: 'Balance cleared.' },
  ],
  col_011: [
    { id: 'pay_011_1', amount: 20_000_000, paymentDate: '2025-10-25T09:00:00Z',
      method: 'Bank Transfer', reference: 'EFT-2025-10-2509',
      runningBalance: 210_000_000, notes: null },
    { id: 'pay_011_2', amount: 10_000_000, paymentDate: '2025-11-15T14:00:00Z',
      method: 'MTN Mobile Money', reference: 'MTNMM-20251115-9911',
      runningBalance: 200_000_000, notes: 'Token payment. Court proceedings ongoing.' },
  ],
  col_012: [
    { id: 'pay_012_1', amount: 12_000_000, paymentDate: '2026-03-22T10:00:00Z',
      method: 'MTN Mobile Money', reference: 'MTNMM-20260322-1121',
      runningBalance: 33_000_000, notes: null },
  ],
};

// ── Mutable runtime state (persists for browser session) ──────────────────────

/** Add a collection row from outside (e.g. mark-funded handoff). */
export function addRuntimeCollection(col: Collection): void {
  if (!runtimeCollections.some((c) => c.id === col.id)) {
    runtimeCollections.push(col);
  }
}

const runtimeCollections: Collection[] = [
  {
    id: 'col_001',
    invoiceId: 'inv_001', invoiceNumber: 'INV-2025-001',
    supplierId: 'usr_002', supplierName: 'Kampala Traders Ltd',
    buyerId: 'buyer_101', buyerName: 'Stanbic Bank Uganda',
    faceValue: 45_000_000, collectedAmount: 25_000_000, outstandingAmount: 20_000_000,
    status: 'pending', dueDate: '2026-04-05T00:00:00Z', daysOverdue: 0,
    escalationLevel: 'none', sarFlagged: false,
    lastPaymentDate: '2026-03-18T14:00:00Z',
    createdAt: '2026-02-10T07:30:00Z', updatedAt: '2026-03-18T14:00:00Z',
  },
  {
    id: 'col_002',
    invoiceId: 'inv_002', invoiceNumber: 'INV-2025-002',
    supplierId: 'usr_002', supplierName: 'Kampala Traders Ltd',
    buyerId: 'buyer_102', buyerName: 'MTN Uganda Ltd',
    faceValue: 120_000_000, collectedAmount: 35_000_000, outstandingAmount: 85_000_000,
    status: 'overdue', dueDate: '2026-03-20T00:00:00Z', daysOverdue: 6,
    escalationLevel: 'reminder', sarFlagged: false,
    lastPaymentDate: '2026-03-22T16:30:00Z',
    createdAt: '2026-01-20T07:00:00Z', updatedAt: '2026-03-22T16:30:00Z',
  },
  {
    id: 'col_003',
    invoiceId: 'inv_003', invoiceNumber: 'INV-2025-003',
    supplierId: 'usr_003', supplierName: 'Entebbe Supplies Co',
    buyerId: 'buyer_103', buyerName: 'Uganda Breweries Ltd',
    faceValue: 60_000_000, collectedAmount: 30_000_000, outstandingAmount: 30_000_000,
    status: 'overdue', dueDate: '2026-03-10T00:00:00Z', daysOverdue: 16,
    escalationLevel: 'reminder', sarFlagged: false,
    lastPaymentDate: '2026-03-20T10:00:00Z',
    createdAt: '2026-01-10T08:00:00Z', updatedAt: '2026-03-20T10:00:00Z',
  },
  {
    id: 'col_004',
    invoiceId: 'inv_004', invoiceNumber: 'INV-2025-004',
    supplierId: 'usr_004', supplierName: 'Mbarara Agri Products',
    buyerId: 'buyer_104', buyerName: 'Airtel Uganda',
    faceValue: 175_000_000, collectedAmount: 55_000_000, outstandingAmount: 120_000_000,
    status: 'overdue', dueDate: '2026-02-28T00:00:00Z', daysOverdue: 26,
    escalationLevel: 'formal', sarFlagged: false,
    lastPaymentDate: '2026-02-14T15:00:00Z',
    createdAt: '2025-12-15T09:00:00Z', updatedAt: '2026-02-22T11:00:00Z',
  },
  {
    id: 'col_005',
    invoiceId: 'inv_005', invoiceNumber: 'INV-2025-005',
    supplierId: 'usr_005', supplierName: 'Gulu Hardware Ltd',
    buyerId: 'buyer_105', buyerName: 'Dfcu Bank',
    faceValue: 75_000_000, collectedAmount: 10_000_000, outstandingAmount: 65_000_000,
    status: 'overdue', dueDate: '2026-02-18T00:00:00Z', daysOverdue: 36,
    escalationLevel: 'formal', sarFlagged: false,
    lastPaymentDate: '2026-01-28T10:00:00Z',
    createdAt: '2025-12-01T09:00:00Z', updatedAt: '2026-02-12T10:00:00Z',
  },
  {
    id: 'col_006',
    invoiceId: 'inv_006', invoiceNumber: 'INV-2025-006',
    supplierId: 'usr_003', supplierName: 'Entebbe Supplies Co',
    buyerId: 'buyer_106', buyerName: 'Nile Breweries Ltd',
    faceValue: 230_000_000, collectedAmount: 80_000_000, outstandingAmount: 150_000_000,
    status: 'overdue', dueDate: '2026-01-25T00:00:00Z', daysOverdue: 60,
    escalationLevel: 'legal', sarFlagged: false,
    lastPaymentDate: '2026-01-05T14:00:00Z',
    createdAt: '2025-11-10T09:00:00Z', updatedAt: '2026-01-28T14:00:00Z',
  },
  {
    id: 'col_007',
    invoiceId: 'inv_007', invoiceNumber: 'INV-2025-007',
    supplierId: 'usr_006', supplierName: 'Jinja Manufacturing',
    buyerId: 'buyer_107', buyerName: 'Uganda Telecom Ltd',
    faceValue: 300_000_000, collectedAmount: 40_000_000, outstandingAmount: 260_000_000,
    status: 'overdue', dueDate: '2026-01-10T00:00:00Z', daysOverdue: 75,
    escalationLevel: 'legal', sarFlagged: true,
    lastPaymentDate: '2025-11-20T10:00:00Z',
    createdAt: '2025-10-15T09:00:00Z', updatedAt: '2026-01-18T16:00:00Z',
  },
  {
    id: 'col_008',
    invoiceId: 'inv_008', invoiceNumber: 'INV-2025-008',
    supplierId: 'usr_004', supplierName: 'Mbarara Agri Products',
    buyerId: 'buyer_101', buyerName: 'Stanbic Bank Uganda',
    faceValue: 85_000_000, collectedAmount: 38_000_000, outstandingAmount: 47_000_000,
    status: 'overdue', dueDate: '2026-03-17T00:00:00Z', daysOverdue: 9,
    escalationLevel: 'reminder', sarFlagged: false,
    lastPaymentDate: '2026-03-21T11:30:00Z',
    createdAt: '2026-01-25T09:00:00Z', updatedAt: '2026-03-21T11:30:00Z',
  },
  {
    id: 'col_009',
    invoiceId: 'inv_009', invoiceNumber: 'INV-2025-009',
    supplierId: 'usr_002', supplierName: 'Kampala Traders Ltd',
    buyerId: 'buyer_103', buyerName: 'Uganda Breweries Ltd',
    faceValue: 60_000_000, collectedAmount: 60_000_000, outstandingAmount: 0,
    status: 'collected', dueDate: '2026-01-30T00:00:00Z', daysOverdue: 0,
    escalationLevel: 'none', sarFlagged: false,
    lastPaymentDate: '2026-01-28T10:00:00Z',
    createdAt: '2025-12-01T09:00:00Z', updatedAt: '2026-01-28T10:00:00Z',
  },
  {
    id: 'col_010',
    invoiceId: 'inv_010', invoiceNumber: 'INV-2025-010',
    supplierId: 'usr_005', supplierName: 'Gulu Hardware Ltd',
    buyerId: 'buyer_102', buyerName: 'MTN Uganda Ltd',
    faceValue: 120_000_000, collectedAmount: 120_000_000, outstandingAmount: 0,
    status: 'collected', dueDate: '2026-01-31T00:00:00Z', daysOverdue: 0,
    escalationLevel: 'formal', sarFlagged: false,
    lastPaymentDate: '2026-01-29T15:00:00Z',
    createdAt: '2025-11-20T09:00:00Z', updatedAt: '2026-01-29T15:00:00Z',
  },
  {
    id: 'col_011',
    invoiceId: 'inv_011', invoiceNumber: 'INV-2025-011',
    supplierId: 'usr_006', supplierName: 'Jinja Manufacturing',
    buyerId: 'buyer_105', buyerName: 'Dfcu Bank',
    faceValue: 230_000_000, collectedAmount: 30_000_000, outstandingAmount: 200_000_000,
    status: 'bad_debt', dueDate: '2025-11-01T00:00:00Z', daysOverdue: 145,
    escalationLevel: 'legal', sarFlagged: true,
    lastPaymentDate: '2025-11-15T14:00:00Z',
    createdAt: '2025-09-01T09:00:00Z', updatedAt: '2025-12-04T15:00:00Z',
  },
  {
    id: 'col_012',
    invoiceId: 'inv_012', invoiceNumber: 'INV-2025-012',
    supplierId: 'usr_003', supplierName: 'Entebbe Supplies Co',
    buyerId: 'buyer_104', buyerName: 'Airtel Uganda',
    faceValue: 45_000_000, collectedAmount: 12_000_000, outstandingAmount: 33_000_000,
    status: 'pending', dueDate: '2026-04-10T00:00:00Z', daysOverdue: 0,
    escalationLevel: 'none', sarFlagged: false,
    lastPaymentDate: '2026-03-22T10:00:00Z',
    createdAt: '2026-02-20T09:00:00Z', updatedAt: '2026-03-22T10:00:00Z',
  },
];

// Mutable payment + escalation histories (deep-copied from seed)
const runtimePayments: Record<string, CollectionPayment[]> = Object.fromEntries(
  Object.entries(SEED_PAYMENTS).map(([k, v]) => [k, [...v]]),
);

const runtimeEscalation: Record<string, EscalationEvent[]> = Object.fromEntries(
  Object.entries(SEED_ESCALATION).map(([k, v]) => [k, [...v]]),
);

// ── Runtime documents store ─────────────────────────────────────────────────

interface MockDocument {
  id: string;
  collectionId: string;
  documentType: string;
  status: 'draft' | 'sent';
  draftParams: { deadlineDays: number; additionalNotes: string };
  generatedBy: string;
  finalizedBy: string | null;
  sentAt: string | null;
  createdAt: string;
}

const runtimeDocuments: MockDocument[] = [];

// ── Escalation level helpers ──────────────────────────────────────────────────

const NEXT_LEVEL: Record<EscalationLevel, EscalationLevel | null> = {
  none: 'reminder', reminder: 'formal', formal: 'legal', legal: null,
};

const PREV_LEVEL: Record<EscalationLevel, EscalationLevel | null> = {
  none: null, reminder: 'none', formal: 'reminder', legal: 'formal',
};

const LEVEL_NUMBER: Record<EscalationLevel, 1 | 2 | 3 | null> = {
  none: null, reminder: 1, formal: 2, legal: 3,
};

const LEVEL_LABELS: Record<EscalationLevel, string> = {
  none: 'No Escalation', reminder: 'Reminder Sent', formal: 'Formal Notice', legal: 'Legal Action',
};

const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  mtn_momo: 'MTN Mobile Money', airtel_money: 'Airtel Money',
  bank_transfer: 'Bank Transfer', cash: 'Cash', cheque: 'Cheque',
};

// ── Summary stats ─────────────────────────────────────────────────────────────

function computeSummaryStats(collections: Collection[]): CollectionSummaryStats {
  const active  = collections.filter((c) => c.status !== 'collected');
  const overdue = active.filter((c) => c.status === 'overdue' || c.status === 'bad_debt');

  const totalOutstandingUgx = active.reduce((s, c) => s + c.outstandingAmount, 0);
  const overdueCount        = overdue.length;
  const avgDaysOverdue      = overdue.length
    ? Math.round(overdue.reduce((s, c) => s + c.daysOverdue, 0) / overdue.length)
    : 0;
  const totalFace      = collections.reduce((s, c) => s + c.faceValue, 0);
  const totalCollected = collections.reduce((s, c) => s + c.collectedAmount, 0);
  const collectionRate = totalFace > 0
    ? Math.round((totalCollected / totalFace) * 1000) / 10
    : 0;

  return { totalOutstandingUgx, overdueCount, avgDaysOverdue, collectionRate };
}

// ── Filtering & sorting ───────────────────────────────────────────────────────

function applyFilters(all: Collection[], params: URLSearchParams): Collection[] {
  let result = [...all];

  // Axios serialises arrays as key[]=val — check both forms
  const statusRaw = params.get('status');
  const statusBracket = params.getAll('status[]');
  const rawStatuses = statusBracket.length > 0
    ? statusBracket
    : statusRaw ? statusRaw.split(',') : [];
  if (rawStatuses.length > 0) {
    const statuses = rawStatuses as CollectionStatus[];
    result = result.filter((c) => statuses.includes(c.status));
  }

  const escRaw = params.get('escalation_level');
  const escBracket = params.getAll('escalation_level[]');
  const rawLevels = escBracket.length > 0
    ? escBracket
    : escRaw ? escRaw.split(',') : [];
  if (rawLevels.length > 0) {
    const levels = rawLevels as EscalationLevel[];
    result = result.filter((c) => levels.includes(c.escalationLevel));
  }

  const dMin = params.get('days_overdue_min');
  if (dMin) result = result.filter((c) => c.daysOverdue >= Number(dMin));

  const dMax = params.get('days_overdue_max');
  if (dMax) result = result.filter((c) => c.daysOverdue <= Number(dMax));

  const search = params.get('search')?.toLowerCase();
  if (search) {
    result = result.filter(
      (c) =>
        c.invoiceNumber.toLowerCase().includes(search) ||
        c.buyerName.toLowerCase().includes(search)    ||
        c.supplierName.toLowerCase().includes(search),
    );
  }

  return result;
}

function sortCollections(data: Collection[], sortBy: string, sortDir: string): Collection[] {
  const dir = sortDir === 'asc' ? 1 : -1;
  return [...data].sort((a, b) => {
    const field = sortBy as CollectionSortField;
    const va = a[field as keyof Collection];
    const vb = b[field as keyof Collection];
    if (va == null && vb == null) return 0;
    if (va == null) return dir;
    if (vb == null) return -dir;
    if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * dir;
    return String(va).localeCompare(String(vb)) * dir;
  });
}

// ── Build detail from runtime state ──────────────────────────────────────────

function buildDetail(base: Collection): CollectionDetail {
  const dailyPenaltyRate = 0.001; // 0.1%/day per transaction-flow spec
  return {
    ...base,
    dailyPenaltyRate,
    penaltyAmount: Math.round(base.outstandingAmount * dailyPenaltyRate * base.daysOverdue),
    buyerContact: BUYER_CONTACTS[base.buyerId] ?? {
      id: base.buyerId, company: base.buyerName,
      contactPerson: 'Unknown', email: 'unknown@example.com',
      phone: 'N/A', address: 'N/A', paymentTermsDays: 30,
    },
    paymentHistory:    runtimePayments[base.id]    ?? [],
    escalationHistory: runtimeEscalation[base.id]  ?? [],
  };
}

// ── Handlers ──────────────────────────────────────────────────────────────────

export const collectionsHandlers = [

  /** GET /api/collections — serve mock data (passthrough causes 401 logout when JWT is mock-issued) */
  http.get('/api/collections', async ({ request }) => {
    await delay(250);
    const url    = new URL(request.url);
    const params = url.searchParams;

    const filtered = applyFilters(runtimeCollections, params);
    const sorted   = sortCollections(
      filtered,
      params.get('sort_by')  ?? 'days_overdue',
      params.get('sort_dir') ?? 'desc',
    );

    const page      = Math.max(1, parseInt(params.get('page')      ?? '1',  10));
    const page_size = Math.max(1, parseInt(params.get('page_size') ?? '10', 10));
    const start     = (page - 1) * page_size;

    const response: PaginatedCollections = {
      data:        sorted.slice(start, start + page_size),
      total:       filtered.length,
      page,
      pageSize:    page_size,
      totalPages:  Math.ceil(filtered.length / page_size),
      summaryStats: computeSummaryStats(runtimeCollections),
    };

    return HttpResponse.json(response);
  }),

  /** GET /api/collections/:id — full detail */
  http.get('/api/collections/:id', async ({ params }) => {
    const base = runtimeCollections.find((c) => c.id === params.id);
    if (!base) return passthrough();
    await delay(200);
    return HttpResponse.json({ data: buildDetail(base) });
  }),

  /** POST /api/collections/:id/payments — record a payment */
  http.post('/api/collections/:id/payments', async ({ params, request }) => {
    const col = runtimeCollections.find((c) => c.id === params.id);
    if (!col) return passthrough();
    await delay(400);

    const body = await request.json() as RecordPaymentPayload;
    const now  = new Date().toISOString();

    // Update collection totals
    const newCollected    = col.collectedAmount + body.amount;
    const newOutstanding  = Math.max(0, col.outstandingAmount - body.amount);
    col.collectedAmount   = newCollected;
    col.outstandingAmount = newOutstanding;
    col.lastPaymentDate   = now;
    col.updatedAt         = now;

    // Auto-transition when fully collected
    if (col.outstandingAmount <= 0) {
      col.status = 'collected';
      const inv = MOCK_INVOICES.find((i) => i.id === col.invoiceId);
      if (inv) {
        inv.status = 'collected' as InvoiceStatus;
        inv.collectedAt = now;
        inv.updatedAt = now;
      }
      // Auto-create settlement in pending status — finance team works through the 4-step workflow
      const discountEarned = Math.round(col.faceValue * 0.032);
      const advanceAmount = Math.round(col.faceValue * 0.9);
      const bankInterest = Math.round(advanceAmount * 0.02);
      addSettlement({
        id: `stl_${col.invoiceId}`,
        invoiceId: col.invoiceId,
        invoiceNumber: col.invoiceNumber,
        supplierName: col.supplierName,
        buyerName: col.buyerName,
        faceValue: String(col.faceValue),
        collectedAmount: String(col.collectedAmount),
        advanceAmount: String(advanceAmount),
        discountEarned: String(discountEarned),
        penaltyIncome: '0',
        facilityRepayment: String(bankInterest),
        netProfit: '0',
        status: 'pending',
        collectedAt: now,
        settledAt: null,
        createdAt: now,
      });
    }

    // Append payment to history
    if (!runtimePayments[col.id]) runtimePayments[col.id] = [];
    const newPayment: CollectionPayment = {
      id:              `pay_${col.id}_${Date.now()}`,
      amount:          body.amount,
      paymentDate:    `${body.payment_date}T00:00:00Z`,
      method:          PAYMENT_METHOD_LABELS[body.method] ?? body.method,
      reference:       body.reference ?? '—',
      runningBalance: newOutstanding,
      notes:           body.notes ?? null,
    };
    runtimePayments[col.id].push(newPayment);

    return HttpResponse.json(buildDetail(col));
  }),

  /** POST /api/collections/:id/escalate */
  http.post('/api/collections/:id/escalate', async ({ params, request }) => {
    const col = runtimeCollections.find((c) => c.id === params.id);
    if (!col) return passthrough();
    await delay(350);

    const nextLevel = NEXT_LEVEL[col.escalationLevel];
    if (!nextLevel) return HttpResponse.json({ message: 'Already at maximum escalation level' }, { status: 422 });

    const body = await request.json() as EscalatePayload;
    const now  = new Date().toISOString();
    const levelNum = LEVEL_NUMBER[nextLevel];

    col.escalationLevel = nextLevel;
    col.updatedAt       = now;

    if (!runtimeEscalation[col.id]) runtimeEscalation[col.id] = [];
    if (levelNum !== null) {
      const event: EscalationEvent = {
        id:          `esc_${col.id}_${Date.now()}`,
        level:       nextLevel,
        levelNumber: levelNum,
        label:       LEVEL_LABELS[nextLevel],
        occurredAt: now,
        actorName:  'Current User',
        actorRole:  'credit_officer',
        notes:       body.reason,
      };
      runtimeEscalation[col.id].push(event);
    }

    return HttpResponse.json(buildDetail(col));
  }),

  /** POST /api/collections/:id/de-escalate */
  http.post('/api/collections/:id/de-escalate', async ({ params, request }) => {
    const col = runtimeCollections.find((c) => c.id === params.id);
    if (!col) return passthrough();
    await delay(350);

    const prevLevel = PREV_LEVEL[col.escalationLevel];
    if (prevLevel === null) return HttpResponse.json({ message: 'Already at minimum escalation level' }, { status: 422 });

    const body = await request.json() as DeescalatePayload;
    const now  = new Date().toISOString();

    col.escalationLevel = prevLevel;
    col.updatedAt       = now;

    if (!runtimeEscalation[col.id]) runtimeEscalation[col.id] = [];
    const event: EscalationEvent = {
      id:           `deesc_${col.id}_${Date.now()}`,
      level:        prevLevel,
      levelNumber: (LEVEL_NUMBER[prevLevel] ?? 1) as 1 | 2 | 3,
      label:        `De-escalated to ${LEVEL_LABELS[prevLevel]}`,
      occurredAt:  now,
      actorName:   'Current User (Management)',
      actorRole:   'management',
      notes:        body.reason,
    };
    runtimeEscalation[col.id].push(event);

    return HttpResponse.json(buildDetail(col));
  }),

  /** POST /api/collections/:id/resolve */
  http.post('/api/collections/:id/resolve', async ({ params }) => {
    const col = runtimeCollections.find((c) => c.id === params.id);
    if (!col) return passthrough();
    await delay(300);

    col.status     = 'collected';
    col.updatedAt  = new Date().toISOString();

    return HttpResponse.json(buildDetail(col));
  }),

  // -----------------------------------------------------------------------
  // Escalation Documents — mock handlers
  // -----------------------------------------------------------------------

  /** POST /api/collections/:id/documents/draft */
  http.post('/api/collections/:id/documents/draft', async ({ request, params }) => {
    await delay(400);
    const body = (await request.json()) as { document_type?: string };
    const docId = `doc_${Date.now()}`;
    const doc = {
      id: docId,
      collectionId: params.id as string,
      documentType: body.document_type ?? 'demand_letter',
      status: 'draft' as const,
      draftParams: { deadlineDays: 14, additionalNotes: '' },
      generatedBy: 'mock-user',
      finalizedBy: null,
      sentAt: null,
      createdAt: new Date().toISOString(),
    };
    runtimeDocuments.push(doc);
    return HttpResponse.json({ documentId: docId, message: 'Draft generated' }, { status: 201 });
  }),

  /** GET /api/collections/:id/documents */
  http.get('/api/collections/:id/documents', async ({ params }) => {
    await delay(200);
    const docs = runtimeDocuments.filter((d) => d.collectionId === params.id);
    return HttpResponse.json({ data: docs });
  }),

  /** GET /api/collections/:id/documents/:docId — returns HTML letter for preview */
  http.get('/api/collections/:id/documents/:docId', async ({ params }) => {
    const doc = runtimeDocuments.find((d) => d.id === params.docId);
    if (!doc) return passthrough();
    await delay(200);
    const col = runtimeCollections.find((c) => c.id === doc.collectionId);
    const buyerName = col?.buyerName ?? 'Buyer';
    const invoiceNum = col?.invoiceNumber ?? 'N/A';
    const outstanding = col ? `UGX ${col.outstandingAmount.toLocaleString('en-UG')}` : 'N/A';
    const faceValue = col ? `UGX ${col.faceValue.toLocaleString('en-UG')}` : 'N/A';
    const dueDate = col?.dueDate ? new Date(col.dueDate).toLocaleDateString('en-UG', { day: 'numeric', month: 'long', year: 'numeric' }) : 'N/A';
    const today = new Date().toLocaleDateString('en-UG', { day: 'numeric', month: 'long', year: 'numeric' });
    const deadline = doc.draftParams.deadlineDays;
    const notes = doc.draftParams.additionalNotes;
    const html = `<!DOCTYPE html><html><head><style>
      body { font-family: 'Times New Roman', serif; margin: 40px; color: #1a1a1a; line-height: 1.6; }
      .header { border-bottom: 3px solid #1a365d; padding-bottom: 16px; margin-bottom: 24px; }
      .company { font-size: 22px; font-weight: bold; color: #1a365d; margin: 0; }
      .address { font-size: 12px; color: #666; margin: 4px 0; }
      .title { font-size: 18px; font-weight: bold; text-align: center; margin: 24px 0; text-decoration: underline; }
      .date { text-align: right; margin-bottom: 20px; }
      .recipient { margin-bottom: 20px; }
      .recipient strong { display: block; }
      table { width: 100%; border-collapse: collapse; margin: 16px 0; }
      th, td { border: 1px solid #ccc; padding: 8px 12px; text-align: left; }
      th { background: #f0f4f8; font-weight: 600; }
      .total { font-weight: bold; background: #fef3c7; }
      .warning { background: #fef2f2; border-left: 4px solid #dc2626; padding: 12px 16px; margin: 20px 0; }
      .notes { background: #f0fdf4; border-left: 4px solid #16a34a; padding: 12px 16px; margin: 20px 0; }
      .footer { margin-top: 40px; font-size: 12px; color: #666; border-top: 1px solid #ccc; padding-top: 12px; }
      .signature { margin-top: 40px; }
    </style></head><body>
      <div class="header">
        <p class="company">Rapha Integrated Solutions</p>
        <p class="address">Plot 1, Kampala Road, Kampala, Uganda</p>
        <p class="address">Invoice Discounting & Early Payment Platform</p>
      </div>
      <p class="date">${today}</p>
      <div class="recipient">
        <strong>The Managing Director</strong>
        <strong>${buyerName}</strong>
        <span>Kampala, Uganda</span>
      </div>
      <p class="title">FORMAL DEMAND FOR PAYMENT</p>
      <p>Dear Sir/Madam,</p>
      <p>We refer to the below invoice(s) assigned to Rapha Integrated Solutions, for which payment is now overdue.
         Despite previous reminders, the outstanding balance remains unpaid.</p>
      <table>
        <thead><tr><th>Invoice Ref</th><th>Due Date</th><th>Face Value</th><th>Outstanding</th></tr></thead>
        <tbody>
          <tr><td>${invoiceNum}</td><td>${dueDate}</td><td>${faceValue}</td><td>${outstanding}</td></tr>
          <tr class="total"><td colspan="3">Total Outstanding</td><td>${outstanding}</td></tr>
        </tbody>
      </table>
      <p>In accordance with the terms of the Notice of Assignment and the Uganda Civil Procedure Act,
         we hereby <strong>demand full payment of the outstanding amount within ${String(deadline)} days</strong>
         from the date of this letter.</p>
      ${notes ? `<div class="notes"><strong>Additional Notes:</strong><br/>${notes}</div>` : ''}
      <div class="warning">
        <strong>Notice:</strong> Failure to settle the above amount within the stipulated period may result
        in Rapha Integrated Solutions pursuing all available legal remedies, including but not limited to filing a
        civil suit for recovery of the debt, accrued interest, and legal costs.
      </div>
      <div class="signature">
        <p>Yours faithfully,</p>
        <br/><br/>
        <p><strong>Credit Manager</strong><br/>Rapha Integrated Solutions</p>
      </div>
      <div class="footer">
        <p>This document is confidential and intended solely for the named recipient.
           Ref: ${doc.collectionId} | Generated: ${doc.createdAt}</p>
      </div>
    </body></html>`;
    return new HttpResponse(html, { headers: { 'Content-Type': 'text/html' } });
  }),

  /** PATCH /api/collections/:id/documents/:docId */
  http.patch('/api/collections/:id/documents/:docId', async ({ request, params }) => {
    const doc = runtimeDocuments.find((d) => d.id === params.docId);
    if (!doc) return passthrough();
    await delay(300);
    const body = (await request.json()) as { deadline_days?: number; additional_notes?: string };
    if (body.deadline_days !== undefined) doc.draftParams.deadlineDays = body.deadline_days;
    if (body.additional_notes !== undefined) doc.draftParams.additionalNotes = body.additional_notes;
    return HttpResponse.json({ message: 'Draft updated' });
  }),

  /** POST /api/collections/:id/documents/:docId/send */
  http.post('/api/collections/:id/documents/:docId/send', async ({ params }) => {
    const doc = runtimeDocuments.find((d) => d.id === params.docId);
    if (!doc) return passthrough();
    await delay(400);
    doc.status = 'sent';
    doc.sentAt = new Date().toISOString();
    doc.finalizedBy = 'mock-user';
    return HttpResponse.json({ message: 'Document sent' });
  }),
];
