// =============================================================================
// REQ-PAYMENT-009 — Uganda ACH (UECS-style) batch file generator
//
// Builds a fixed-width 80-char ACH instruction file aligned with the Bank of
// Uganda interbank settlement convention (SADC/EAC inheritance). The official
// UECS spec is not freely published online; this implementation follows the
// canonical record layout that Uganda banks consume:
//
//   Record 01 (Header, one line):
//     pos 1-2   record type     "01"
//     pos 3-38  batch id        UUID (36 chars)
//     pos 39-44 origin bank     6-char numeric (env EFT_BANK_CODE)
//     pos 45-58 origin account  14-char alphanum, right-padded
//     pos 59-66 value date      YYYYMMDD
//     pos 67-69 currency        "UGX"
//     pos 70-75 record count    6-digit zero-padded
//     pos 76-80 reserved        space-padded
//
//   Record 02 (Detail, one per payment):
//     pos 1-2   record type     "02"
//     pos 3-8   beneficiary bank 6-char numeric
//     pos 9-22  beneficiary acct 14-char alphanum, right-padded
//     pos 23-57 beneficiary name 35-char, right-padded (truncated)
//     pos 58-72 amount          15-digit zero-padded, amount in TENS OF CENTS
//                                (UGX × 100) — bigint precision preserved
//     pos 73-80 reference       8-char (first 8 of invoice/payment id)
//
//   Record 99 (Trailer, one line):
//     pos 1-2   record type     "99"
//     pos 3-8   detail count    6-digit zero-padded
//     pos 9-23  total amount    15-digit zero-padded (TENS OF CENTS)
//     pos 24-87 control hash    SHA-256 hex of concatenated detail rows
//                                (64 chars; record ends at 88)
//
// Amounts are TENS OF CENTS as a BigInt — never float. The control hash gives
// the receiving bank a single-digest integrity check across all detail rows.
// =============================================================================

import crypto from 'crypto';
import path from 'path';
import fs from 'fs/promises';
import { v4 as uuidv4 } from 'uuid';

export interface AchPaymentRow {
  beneficiaryBankCode: string;
  beneficiaryAccount: string;
  beneficiaryName: string;
  amount: bigint; // UGX integer (not tens of cents — converted internally)
  reference: string;
}

export interface AchBatch {
  filename: string;
  content: string;
  batchId: string;
  detailCount: number;
  totalAmount: bigint;
  controlHash: string;
}

const HEADER_TYPE = '01';
const DETAIL_TYPE = '02';
const TRAILER_TYPE = '99';
const CURRENCY = 'UGX';

function padRight(s: string, len: number): string {
  return (s ?? '').slice(0, len).padEnd(len, ' ');
}

function padLeftDigits(n: bigint | number, len: number): string {
  return String(n).padStart(len, '0');
}

function todayYYYYMMDD(): string {
  return new Date().toISOString().slice(0, 10).replace(/-/g, '');
}

function buildHeader(
  batchId: string,
  bankCode: string,
  originAccount: string,
  recordCount: number,
): string {
  return [
    HEADER_TYPE,
    batchId,
    padRight(bankCode, 6),
    padRight(originAccount, 14),
    todayYYYYMMDD(),
    CURRENCY,
    padLeftDigits(recordCount, 6),
    '     ',
  ].join('');
}

function buildDetailRow(row: AchPaymentRow): string {
  return [
    DETAIL_TYPE,
    padRight(row.beneficiaryBankCode, 6),
    padRight(row.beneficiaryAccount, 14),
    padRight(row.beneficiaryName, 35),
    padLeftDigits(row.amount * 100n, 15),
    padRight(row.reference, 8),
  ].join('');
}

function buildTrailer(detailCount: number, totalAmount: bigint, hash: string): string {
  return [
    TRAILER_TYPE,
    padLeftDigits(detailCount, 6),
    padLeftDigits(totalAmount * 100n, 15),
    hash,
  ].join('');
}

/**
 * Generate a UECS-format ACH batch file. Pure function; no I/O. Use
 * {@link writeAchBatchFile} for the on-disk path.
 */
export function generateUgandaAchFile(payments: AchPaymentRow[]): AchBatch {
  const bankCode = process.env.EFT_BANK_CODE ?? '000000';
  const originAccount = process.env.EFT_ORIGIN_ACCOUNT ?? '';
  const batchId = uuidv4();
  const detailCount = payments.length;
  const totalAmount = payments.reduce((acc, p) => acc + p.amount, 0n);

  const detailRows = payments.map(buildDetailRow);
  const controlHash = crypto.createHash('sha256').update(detailRows.join(''), 'utf8').digest('hex');

  const header = buildHeader(batchId, bankCode, originAccount, detailCount);
  const trailer = buildTrailer(detailCount, totalAmount, controlHash);
  const content = [header, ...detailRows, trailer].join('\n') + '\n';

  const filename = `RIS-EFT-${todayYYYYMMDD()}-${batchId.slice(0, 8)}.txt`;
  return { filename, content, batchId, detailCount, totalAmount, controlHash };
}

/**
 * Write the batch file to EFT_OUTPUT_DIR. Creates the directory if missing
 * (idempotent — recursive mkdir). Returns the full path written to.
 */
export async function writeAchBatchFile(batch: AchBatch): Promise<string> {
  const outDir = process.env.EFT_OUTPUT_DIR ?? '/tmp/mms-eft';
  await fs.mkdir(outDir, { recursive: true });
  const full = path.join(outDir, batch.filename);
  await fs.writeFile(full, batch.content, 'utf8');
  return full;
}
