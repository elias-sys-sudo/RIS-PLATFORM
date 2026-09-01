// REQ-PAYMENT-009 — Uganda ACH batch file format

import {
  generateUgandaAchFile,
  writeAchBatchFile,
  type AchPaymentRow,
} from '../../../src/services/payments/uganda-ach';
import * as fs from 'fs/promises';
import * as path from 'path';
import os from 'os';

jest.mock('uuid', () => ({
  v4: jest
    .fn()
    .mockReturnValueOnce('11111111-2222-3333-4444-555555555555')
    .mockReturnValue('22222222-3333-4444-5555-666666666666'),
}));

const samplePayments: AchPaymentRow[] = [
  {
    beneficiaryBankCode: '040001',
    beneficiaryAccount: '0123456789',
    beneficiaryName: 'Acme Trading Ltd',
    amount: 5_000_000n,
    reference: 'INV00042',
  },
  {
    beneficiaryBankCode: '040002',
    beneficiaryAccount: '9876543210',
    beneficiaryName: 'Zebra Importers Uganda Limited (very long name truncated to 35)',
    amount: 3_500_000n,
    reference: 'INV00043',
  },
];

describe('Uganda ACH batch file (REQ-PAYMENT-009)', () => {
  beforeEach(() => {
    process.env.EFT_BANK_CODE = '100001';
    process.env.EFT_ORIGIN_ACCOUNT = 'RIS-OPERATIONS';
  });

  describe('generateUgandaAchFile', () => {
    it('returns header + N detail rows + trailer joined by newlines', () => {
      const batch = generateUgandaAchFile(samplePayments);
      const lines = batch.content.trim().split('\n');
      expect(lines).toHaveLength(1 + samplePayments.length + 1);
      expect(lines[0]?.startsWith('01')).toBe(true);
      expect(lines[1]?.startsWith('02')).toBe(true);
      expect(lines[2]?.startsWith('02')).toBe(true);
      expect(lines[3]?.startsWith('99')).toBe(true);
    });

    it('emits BigInt amounts as tens-of-cents zero-padded to 15 digits', () => {
      const batch = generateUgandaAchFile([samplePayments[0]]);
      // 5_000_000 UGX × 100 = 500_000_000 tens-of-cents, padded to 15
      expect(batch.content).toContain('000000500000000');
    });

    it('truncates beneficiary name to 35 chars and right-pads short names', () => {
      const batch = generateUgandaAchFile(samplePayments);
      const detailRow2 = batch.content.split('\n')[2] ?? '';
      // pos 23 (0-indexed 22) starts beneficiary name, width 35
      const namePart = detailRow2.slice(22, 22 + 35);
      expect(namePart).toHaveLength(35);
      expect(namePart.startsWith('Zebra Importers Uganda Limited')).toBe(true);
    });

    it('includes total amount and detail count in trailer', () => {
      const batch = generateUgandaAchFile(samplePayments);
      expect(batch.detailCount).toBe(2);
      expect(batch.totalAmount).toBe(8_500_000n);
      // tens of cents = 850_000_000, 15 digits
      expect(batch.content).toContain('000000850000000');
    });

    it('appends a SHA-256 control hash over concatenated detail rows', () => {
      const batch = generateUgandaAchFile(samplePayments);
      expect(batch.controlHash).toMatch(/^[a-f0-9]{64}$/);
      expect(batch.content).toContain(batch.controlHash);
    });

    it('filename follows RIS-EFT-YYYYMMDD-<batch>.txt pattern', () => {
      const batch = generateUgandaAchFile(samplePayments);
      expect(batch.filename).toMatch(/^RIS-EFT-\d{8}-[a-f0-9]{8}\.txt$/);
    });

    it('embeds EFT_BANK_CODE in the header at fixed position', () => {
      const batch = generateUgandaAchFile(samplePayments);
      const header = batch.content.split('\n')[0] ?? '';
      // pos 39-44 = bank code (6 chars), 0-indexed slice 38..44
      expect(header.slice(38, 44)).toBe('100001');
    });
  });

  describe('writeAchBatchFile', () => {
    it('writes the batch content to disk under EFT_OUTPUT_DIR', async () => {
      const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'ach-test-'));
      process.env.EFT_OUTPUT_DIR = tmp;

      const batch = generateUgandaAchFile([samplePayments[0]]);
      const written = await writeAchBatchFile(batch);

      expect(written.startsWith(tmp)).toBe(true);
      const on_disk = await fs.readFile(written, 'utf8');
      expect(on_disk).toBe(batch.content);

      await fs.rm(tmp, { recursive: true, force: true });
    });

    it('creates EFT_OUTPUT_DIR if it does not exist (mkdir recursive)', async () => {
      const tmp = path.join(os.tmpdir(), `ach-test-deep-${Date.now()}`, 'sub', 'dir');
      process.env.EFT_OUTPUT_DIR = tmp;

      const batch = generateUgandaAchFile([samplePayments[0]]);
      const written = await writeAchBatchFile(batch);

      const stat = await fs.stat(written);
      expect(stat.isFile()).toBe(true);

      await fs.rm(path.dirname(path.dirname(tmp)), { recursive: true, force: true });
    });
  });
});
