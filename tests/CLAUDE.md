# tests/ — Templates & Standards

> Coverage minimums: 80% all modules, 95% risk-engine and payments.
> CI blocks merge on coverage drop. Never use `/* istanbul ignore */` to fake coverage.

---

## Service Test Template — Copy This

```typescript
// tests/unit/[module]/[module].service.test.ts
import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import { ModuleService } from '../../../src/services/[module]/[module].service';
import * as repo from '../../../src/services/[module]/[module].repository';
import * as auditRepo from '../../../src/shared/database/audit'; // if separate

jest.mock('../../../src/services/[module]/[module].repository');
const mockRepo = jest.mocked(repo);

describe('[Module]Service', () => {
  beforeEach(() => jest.clearAllMocks());

  describe('methodName', () => {
    it('succeeds when all preconditions are met', async () => {
      mockRepo.findById.mockResolvedValue({ id: 'uuid-1', status: 'approved', ... });
      const result = await ModuleService.methodName('uuid-1', 'user-1');
      expect(result.status).toBe('expected-status');
      expect(mockRepo.updateStatusWithClient).toHaveBeenCalledWith(
        expect.anything(), // the client
        'uuid-1', 'expected-status'
      );
    });

    it('throws BusinessRuleError when status is wrong', async () => {
      mockRepo.findById.mockResolvedValue({ id: 'uuid-1', status: 'draft' });
      await expect(ModuleService.methodName('uuid-1', 'user-1'))
        .rejects.toMatchObject({ code: 'MODULE_WRONG_STATUS' }); // assert error CODE not just class
    });

    it('throws NotFoundError when resource does not exist', async () => {
      mockRepo.findById.mockResolvedValue(null);
      await expect(ModuleService.methodName('uuid-1', 'user-1'))
        .rejects.toBeInstanceOf(NotFoundError);
    });

    it('writes audit log on success', async () => {
      mockRepo.findById.mockResolvedValue({ id: 'uuid-1', status: 'approved' });
      await ModuleService.methodName('uuid-1', 'user-1');
      expect(mockRepo.createAuditEntryWithClient).toHaveBeenCalledWith(
        expect.anything(), 'user-1', 'EXPECTED_ACTION', 'entity', 'uuid-1', expect.any(Object)
      );
    });

    it('rolls back on repository error', async () => {
      mockRepo.findById.mockResolvedValue({ id: 'uuid-1', status: 'approved' });
      mockRepo.updateStatusWithClient.mockRejectedValue(new Error('DB error'));
      await expect(ModuleService.methodName('uuid-1', 'user-1')).rejects.toThrow();
      // verify the transaction was rolled back (mock pool client)
    });
  });
});
```

---

## Repository Test Template — Ownership Enforcement

```typescript
// tests/unit/[module]/[module].repository.test.ts
describe('[Module]Repository', () => {
  describe('getById', () => {
    it('returns record when id and supplierId match', async () => {
      mockPool.query.mockResolvedValue({ rows: [mockRow], rowCount: 1 });
      const result = await repo.getById('invoice-1', 'supplier-1');
      expect(result).toBeDefined();
    });

    it('returns null when supplierId does not match — ownership enforced in SQL', async () => {
      // Simulates another supplier's ID being passed
      mockPool.query.mockResolvedValue({ rows: [], rowCount: 0 });
      const result = await repo.getById('invoice-1', 'supplier-2');
      expect(result).toBeNull(); // NOT a ForbiddenError — null, service throws NotFound
    });

    it('uses parameterised query — asserts no string concatenation', async () => {
      await repo.getById('invoice-1', 'supplier-1');
      const [sql, params] = mockPool.query.mock.calls[0];
      expect(sql).not.toContain('invoice-1');  // ID must be in params, not SQL string
      expect(sql).not.toContain('supplier-1');
      expect(params).toContain('invoice-1');
      expect(params).toContain('supplier-1');
    });
  });
});
```

---

## Security Test Pattern — Cross-Supplier Data Isolation

Every module with supplier-owned data needs this test:

```typescript
// Supplier A should NEVER be able to access Supplier B's data
describe('Cross-supplier isolation', () => {
  it('supplier A cannot read supplier B invoice by ID manipulation', async () => {
    // Setup: supplier B's invoice exists in DB
    mockRepo.getInvoiceById.mockResolvedValue(null); // SQL WHERE supplier_id returns nothing

    const req = buildRequest({ params: { id: supplierB_invoiceId }, user: { id: supplierA_id } });
    await invoiceController.getOne(req, mockRes, mockNext);

    expect(mockNext).toHaveBeenCalledWith(expect.any(NotFoundError));
    // Must NOT be ForbiddenError (reveals resource exists)
  });
});
```

---

## Test Data Fixtures — Rules

```typescript
// ✅ CORRECT — fake data, amounts below AML threshold
const MOCK_INVOICE = {
  id: '00000000-0000-0000-0000-000000000001',
  supplierId: '00000000-0000-0000-0000-000000000002',
  buyerId: '00000000-0000-0000-0000-000000000003',
  faceValue: 5_000_000n,   // 5M UGX — readable bigint literal
  tenorDays: 30,
  status: 'submitted' as InvoiceStatus,
};

// ❌ WRONG — real-looking data, over AML threshold
const BAD_FIXTURE = {
  faceValue: 150000000,    // triggers AML — need special handling in test
  supplierName: 'Kato David', // real-looking name
  phone: '+256700000000',    // real-looking phone
};
```

For AML tests specifically: use `faceValue: 100_000_000n` and test that `AML_FLAG_TRIGGERED` is the audit action.

---

## Running Tests

```bash
# Single module with coverage
npm run test:unit -- --coverage --collectCoverageFrom="src/services/[module]/**/*.ts" --testPathPattern="tests/unit/[module]"

# All unit tests
npm run test:unit

# Integration (requires running DB + Redis — uses test schema)
npm run test:integration

# Type check (must pass before every commit)
npm run typecheck && npm run lint
```

**Integration tests use a real DB**. Never mock the database in integration tests — that's what burnt us before. The `global-setup.ts` spins up migrations on the test schema before the suite runs.
