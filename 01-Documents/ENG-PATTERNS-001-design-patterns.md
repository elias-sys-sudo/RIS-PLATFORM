# RIS Platform — Design Patterns

**Document ID:** ENG-PATTERNS-001  
**Version:** 1.0  
**Date:** March 2026  
**Owner:** CTO / Lead Engineer

---

## Pattern 1: Repository Pattern

_All database access through repository classes. No SQL in controllers or services._

```typescript
// src/services/invoices/invoices.repository.ts

import { Pool, QueryResult } from 'pg';
import { Invoice, CreateInvoiceData, InvoiceStatus } from './invoices.types';
import { BusinessRuleError } from '../../shared/errors/business.error';

export class InvoiceRepository {
  constructor(private readonly pool: Pool) {}

  async findById(invoiceId: string, supplierId?: string): Promise<Invoice | null> {
    const query = supplierId
      ? 'SELECT * FROM invoices WHERE id = $1 AND supplier_id = $2'
      : 'SELECT * FROM invoices WHERE id = $1';
    const params = supplierId ? [invoiceId, supplierId] : [invoiceId];
    const result = await this.pool.query<Invoice>(query, params);
    return result.rows[0] ?? null;
  }

  async existsByInvoiceNumber(invoiceNumber: string, supplierId: string): Promise<boolean> {
    const result = await this.pool.query<{ count: string }>(
      'SELECT COUNT(*) FROM invoices WHERE invoice_number = $1 AND supplier_id = $2',
      [invoiceNumber, supplierId],
    );
    return parseInt(result.rows[0].count) > 0;
  }

  async create(data: CreateInvoiceData, client?: PoolClient): Promise<Invoice> {
    const db = client ?? this.pool;
    const result = await db.query<Invoice>(
      `INSERT INTO invoices
        (id, invoice_number, supplier_id, buyer_id, face_value, due_date,
         status, sla_deadline, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, 'submitted', $7, NOW())
       RETURNING *`,
      [
        data.id,
        data.invoiceNumber,
        data.supplierId,
        data.buyerId,
        data.faceValue,
        data.dueDate,
        data.slaDeadline,
      ],
    );
    return result.rows[0];
  }

  async updateStatus(invoiceId: string, status: InvoiceStatus, client?: PoolClient): Promise<void> {
    const db = client ?? this.pool;
    await db.query('UPDATE invoices SET status = $1, updated_at = NOW() WHERE id = $2', [
      status,
      invoiceId,
    ]);
  }

  async findBySupplierId(supplierId: string, page: number, limit: number): Promise<Invoice[]> {
    const offset = (page - 1) * limit;
    const result = await this.pool.query<Invoice>(
      'SELECT * FROM invoices WHERE supplier_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3',
      [supplierId, limit, offset],
    );
    return result.rows;
  }

  async getOverdueInvoices(): Promise<Invoice[]> {
    const result = await this.pool.query<Invoice>(
      `SELECT * FROM invoices
       WHERE due_date < CURRENT_DATE AND status IN ('funded', 'collecting')`,
      [],
    );
    return result.rows;
  }
}
```

---

## Pattern 2: Unit of Work Pattern

_Wrap multi-table operations in a single transaction. Rollback completely on any failure._

```typescript
// src/shared/database/unit-of-work.ts

import { Pool, PoolClient } from 'pg';
import { logger } from '../logger';

export class UnitOfWork {
  private client: PoolClient | null = null;

  constructor(private readonly pool: Pool) {}

  async begin(): Promise<PoolClient> {
    this.client = await this.pool.connect();
    await this.client.query('BEGIN');
    return this.client;
  }

  async commit(): Promise<void> {
    if (!this.client) throw new Error('No active transaction');
    await this.client.query('COMMIT');
    this.client.release();
    this.client = null;
  }

  async rollback(): Promise<void> {
    if (!this.client) return;
    try {
      await this.client.query('ROLLBACK');
    } finally {
      this.client.release();
      this.client = null;
    }
  }
}

// Usage: fund invoice — 4 tables must update atomically
export async function fundInvoice(
  invoiceId: string,
  paymentId: string,
  pool: Pool,
  invoiceRepo: InvoiceRepository,
  paymentRepo: PaymentRepository,
  facilityRepo: FacilityRepository,
  auditRepo: AuditRepository,
): Promise<void> {
  const uow = new UnitOfWork(pool);
  const client = await uow.begin();
  try {
    // All 4 operations use the same client — same transaction
    await invoiceRepo.updateStatus(invoiceId, 'funded', client);
    await paymentRepo.updateStatus(paymentId, 'funded', client);
    await facilityRepo.createDrawdown(invoiceId, client);
    await auditRepo.log('PAYMENT_FUNDED', { invoiceId, paymentId }, client);
    await uow.commit();
  } catch (error) {
    await uow.rollback();
    logger.error('fundInvoice transaction rolled back', { invoiceId, error });
    throw error; // re-throw for caller to handle
  }
}
```

---

## Pattern 3: Command Pattern

_Every payment action is a Command object — logged, audited, and replayable._

```typescript
// src/services/payments/commands/payment.commands.ts

export interface PaymentCommand {
  commandId: string;
  commandType: string;
  paymentId: string;
  userId: string;
  timestamp: Date;
  execute(): Promise<void>;
  toAuditEntry(): AuditEntry;
}

export class AuthorisePaymentCommand implements PaymentCommand {
  readonly commandType = 'AUTHORISE_PAYMENT';
  readonly timestamp = new Date();

  constructor(
    readonly commandId: string,
    readonly paymentId: string,
    readonly userId: string,
    private readonly repository: IPaymentRepository,
    private readonly auditRepository: AuditRepository,
  ) {}

  async execute(): Promise<void> {
    const payment = await this.repository.getPayment(this.paymentId);
    if (!payment.dualAuthUser1) {
      await this.repository.recordFirstAuth(this.paymentId, this.userId);
      await this.auditRepository.log(this.toAuditEntry());
    } else if (payment.dualAuthUser1 !== this.userId) {
      await this.repository.recordSecondAuth(this.paymentId, this.userId);
      await this.auditRepository.log(this.toAuditEntry());
    } else {
      throw new PaymentError('SAME_USER_DUAL_AUTH');
    }
  }

  toAuditEntry(): AuditEntry {
    return {
      eventType: 'PAYMENT_AUTHORISED',
      userId: this.userId,
      resourceType: 'payment',
      resourceId: this.paymentId,
      metadata: { commandId: this.commandId, commandType: this.commandType },
      timestamp: this.timestamp,
    };
  }
}

export class ExecutePaymentCommand implements PaymentCommand {
  readonly commandType = 'EXECUTE_PAYMENT';
  readonly timestamp = new Date();

  constructor(
    readonly commandId: string,
    readonly paymentId: string,
    readonly userId: string,
    private readonly provider: IPaymentProvider,
    private readonly repository: IPaymentRepository,
  ) {}

  async execute(): Promise<void> {
    const payment = await this.repository.getPayment(this.paymentId);
    // Idempotency check — safe to replay
    const existing = await this.repository.getByIdempotencyKey(payment.idempotencyKey);
    if (existing?.status === 'funded') return;
    const result = await this.provider.execute({
      amount: payment.amount,
      destination: payment.destination,
      idempotencyKey: payment.idempotencyKey,
    });
    await this.repository.updatePaymentResult(this.paymentId, result);
  }

  toAuditEntry(): AuditEntry {
    return {
      eventType: 'PAYMENT_EXECUTING',
      userId: this.userId,
      resourceType: 'payment',
      resourceId: this.paymentId,
      metadata: { commandId: this.commandId },
      timestamp: this.timestamp,
    };
  }
}

// Command invoker — logs and executes
export class PaymentCommandInvoker {
  private readonly history: PaymentCommand[] = [];

  async invoke(command: PaymentCommand): Promise<void> {
    this.history.push(command);
    await command.execute();
  }

  getHistory(): PaymentCommand[] {
    return [...this.history];
  }
}
```

---

## Pattern 4: Observer Pattern

_Invoice status changes trigger observers — decoupled notification, audit, and risk recalculation._

```typescript
// src/shared/events/invoice-status.observer.ts

export interface InvoiceStatusObserver {
  onStatusChange(invoiceId: string, previousStatus: string, newStatus: string): Promise<void>;
}

export class InvoiceStatusEventEmitter {
  private observers: InvoiceStatusObserver[] = [];

  subscribe(observer: InvoiceStatusObserver): void {
    this.observers.push(observer);
  }

  async emit(invoiceId: string, previousStatus: string, newStatus: string): Promise<void> {
    await Promise.allSettled(
      this.observers.map((o) => o.onStatusChange(invoiceId, previousStatus, newStatus)),
    );
    // allSettled — one observer failing does not block others
  }
}

// Observer 1: Send notifications on relevant status changes
export class NotificationObserver implements InvoiceStatusObserver {
  constructor(private readonly notificationQueue: Queue) {}

  async onStatusChange(invoiceId: string, prev: string, next: string): Promise<void> {
    if (next === 'funded') {
      await this.notificationQueue.add('payment-confirmation', { invoiceId });
    } else if (next === 'rejected') {
      await this.notificationQueue.add('rejection-notice', { invoiceId });
    } else if (next === 'overdue') {
      await this.notificationQueue.add('overdue-notice', { invoiceId });
    }
  }
}

// Observer 2: Write immutable audit log on every status change
export class AuditObserver implements InvoiceStatusObserver {
  constructor(private readonly auditRepository: AuditRepository) {}

  async onStatusChange(invoiceId: string, prev: string, next: string): Promise<void> {
    await this.auditRepository.log({
      eventType: 'INVOICE_STATUS_CHANGED',
      resourceType: 'invoice',
      resourceId: invoiceId,
      metadata: { previousStatus: prev, newStatus: next },
      timestamp: new Date(),
    });
  }
}

// Observer 3: Recalculate portfolio concentration when invoice is funded or collected
export class RiskObserver implements InvoiceStatusObserver {
  constructor(private readonly riskQueue: Queue) {}

  async onStatusChange(invoiceId: string, prev: string, next: string): Promise<void> {
    if (next === 'funded' || next === 'collected') {
      await this.riskQueue.add('recalculate-concentration', { invoiceId });
    }
  }
}

// Registration in server.ts
const emitter = new InvoiceStatusEventEmitter();
emitter.subscribe(new NotificationObserver(notificationQueue));
emitter.subscribe(new AuditObserver(auditRepository));
emitter.subscribe(new RiskObserver(riskQueue));

// Usage in InvoiceService
await this.emitter.emit(invoiceId, 'submitted', 'buyer_confirmed');
```

---

## Pattern 5: Strategy Pattern

_Payment routing selects MTN MoMo vs Airtel vs EFT based on supplier preference and amount thresholds._

```typescript
// src/services/payments/strategies/payment-routing.strategy.ts

import { IPaymentProvider } from '../payments.types';
import { MTNMoMoProvider } from '../providers/mtn-momo.provider';
import { AirtelMoneyProvider } from '../providers/airtel.provider';
import { BankEFTProvider } from '../providers/bank-eft.provider';

export interface IPaymentRoutingStrategy {
  selectProvider(preferredMethod: string, amount: number): IPaymentProvider;
}

export class UgandaPaymentRoutingStrategy implements IPaymentRoutingStrategy {
  // Above this amount, always use EFT regardless of preference (MTN MoMo limits)
  private readonly EFT_THRESHOLD_UGX = 5_000_000_00; // 500M UGX

  constructor(
    private readonly mtnProvider: IPaymentProvider,
    private readonly airtelProvider: IPaymentProvider,
    private readonly eftProvider: IPaymentProvider,
  ) {}

  selectProvider(preferredMethod: string, amount: number): IPaymentProvider {
    // Override preference for large amounts — MTN/Airtel have transaction limits
    if (amount >= this.EFT_THRESHOLD_UGX) {
      return this.eftProvider;
    }
    switch (preferredMethod) {
      case 'MTN_MOMO':
        return this.mtnProvider;
      case 'AIRTEL':
        return this.airtelProvider;
      case 'EFT':
        return this.eftProvider;
      default:
        return this.mtnProvider; // MTN is primary default
    }
  }
}

// Usage in PaymentService — strategy selected at runtime per payment
export class PaymentService {
  constructor(
    private readonly routingStrategy: IPaymentRoutingStrategy,
    private readonly repository: IPaymentRepository,
  ) {}

  async executePayment(paymentId: string): Promise<void> {
    const payment = await this.repository.getPayment(paymentId);
    const supplier = await this.supplierRepository.findById(payment.supplierId);

    // Strategy selects the correct provider — PaymentService doesn't know which one
    const provider = this.routingStrategy.selectProvider(
      supplier.preferredPaymentMethod,
      payment.amount,
    );

    const result = await provider.execute({
      amount: payment.amount,
      destination: supplier.mobileMoneyNumber ?? supplier.bankAccountNumber,
      idempotencyKey: payment.idempotencyKey,
    });

    await this.repository.updatePaymentResult(paymentId, result);
  }
}

// Test strategy — always returns mock provider
export class TestPaymentRoutingStrategy implements IPaymentRoutingStrategy {
  constructor(private readonly mockProvider: IPaymentProvider) {}
  selectProvider(_method: string, _amount: number): IPaymentProvider {
    return this.mockProvider; // always mock in tests
  }
}
```

---

## Pattern Summary

| Pattern      | Applied To                                                 | Key Benefit                                                                |
| ------------ | ---------------------------------------------------------- | -------------------------------------------------------------------------- |
| Repository   | All DB access (InvoiceRepository, PaymentRepository, etc.) | SQL isolated — services and controllers have zero SQL                      |
| Unit of Work | Fund invoice, record payment, collect payment              | Multi-table atomicity — partial state impossible                           |
| Command      | Payment authorisation and execution                        | Every action logged, auditable, replayable with idempotency                |
| Observer     | Invoice status changes                                     | Notification, audit, and risk decoupled — one failure doesn't block others |
| Strategy     | Payment provider selection                                 | Add new payment rail by creating new class — zero change to PaymentService |
