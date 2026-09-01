# RIS Platform — SOLID Principles Applied

**Document ID:** ENG-SOLID-001  
**Version:** 1.0  
**Date:** March 2026  
**Owner:** CTO / Lead Engineer

---

## S — Single Responsibility Principle

_Each class has exactly one reason to change._

The Risk Scoring Engine is split into 6 classes. Each class is responsible for exactly one thing.

```typescript
// src/services/risk-engine/risk-engine.types.ts

export interface ScoringContext {
  invoiceId: string;
  faceValue: number; // BIGINT UGX
  tenorDays: number;
  buyerCreditRating: 'A' | 'B' | 'C' | 'D';
  buyerUsedLimit: number;
  buyerApprovedLimit: number;
  supplierInvoiceCount: number;
  supplierOnTimePercentage: number;
  supplierHasDefault: boolean;
  collateralType:
    | 'bank_guarantee'
    | 'fixed_deposit_lien'
    | 'post_dated_cheque_full_value'
    | 'corporate_guarantee'
    | 'none';
}

export interface FactorScore {
  factorName: string;
  rawScore: number; // 0-100
  weight: number; // 0-1
  weightedScore: number; // rawScore * weight
}

export interface IScoringFactor {
  name: string;
  weight: number;
  calculate(context: ScoringContext): Promise<FactorScore>;
}
```

```typescript
// src/services/risk-engine/factors/buyer-credit-scorer.ts
// Single responsibility: score the buyer's credit rating. Nothing else.

import { IScoringFactor, ScoringContext, FactorScore } from '../risk-engine.types';

export class BuyerCreditScorer implements IScoringFactor {
  readonly name = 'buyer_credit_score';
  readonly weight = 0.3;

  async calculate(context: ScoringContext): Promise<FactorScore> {
    const scoreMap: Record<string, number> = { A: 100, B: 75, C: 50, D: 25 };
    const rawScore = scoreMap[context.buyerCreditRating] ?? 0;
    return {
      factorName: this.name,
      rawScore,
      weight: this.weight,
      weightedScore: rawScore * this.weight,
    };
  }
}
```

```typescript
// src/services/risk-engine/factors/tenor-scorer.ts
// Single responsibility: score the invoice tenor. Nothing else.

import { IScoringFactor, ScoringContext, FactorScore } from '../risk-engine.types';

export class TenorScorer implements IScoringFactor {
  readonly name = 'tenor_score';
  readonly weight = 0.2;

  async calculate(context: ScoringContext): Promise<FactorScore> {
    const { tenorDays } = context;
    let rawScore = 0;
    if (tenorDays >= 1 && tenorDays <= 30) rawScore = 100;
    else if (tenorDays >= 31 && tenorDays <= 60) rawScore = 75;
    else if (tenorDays >= 61 && tenorDays <= 90) rawScore = 50;
    // outside 7-90 range = 0 (already caught by intake validation)
    return {
      factorName: this.name,
      rawScore,
      weight: this.weight,
      weightedScore: rawScore * this.weight,
    };
  }
}
```

```typescript
// src/services/risk-engine/risk-engine.service.ts
// Single responsibility: orchestrate scoring. Does NOT know how any factor is calculated.

import { IScoringFactor, ScoringContext } from './risk-engine.types';
import { RiskEngineRepository } from './risk-engine.repository';
import { logger } from '../../shared/logger';

export class RiskScoringService {
  constructor(
    private readonly factors: IScoringFactor[],
    private readonly repository: RiskEngineRepository,
  ) {}

  async scoreInvoice(invoiceId: string): Promise<void> {
    const context = await this.repository.buildScoringContext(invoiceId);
    const factorScores = await Promise.all(this.factors.map((f) => f.calculate(context)));
    const rawTotal = factorScores.reduce((sum, f) => sum + f.weightedScore, 0);
    const finalScore = Math.round(rawTotal);
    await this.repository.saveRiskScore(invoiceId, factorScores, finalScore);
    logger.audit('INVOICE_SCORED', { invoiceId, finalScore, factorScores });
  }
}
```

---

## O — Open/Closed Principle

_Open for extension, closed for modification._

Adding a new scoring factor requires ZERO changes to existing classes. Only a new class is created.

```typescript
// NEW FACTOR: src/services/risk-engine/factors/currency-risk-scorer.ts
// Adding this factor requires no changes to any existing file.

import { IScoringFactor, ScoringContext, FactorScore } from '../risk-engine.types';

export class CurrencyRiskScorer implements IScoringFactor {
  readonly name = 'currency_risk_score';
  readonly weight = 0.05; // New weight — other weights must be adjusted to sum to 1.0

  async calculate(context: ScoringContext): Promise<FactorScore> {
    // UGX-only invoices = 100. Foreign currency = lower score.
    const rawScore = 100; // All RIS invoices are UGX in this release
    return {
      factorName: this.name,
      rawScore,
      weight: this.weight,
      weightedScore: rawScore * this.weight,
    };
  }
}
```

```typescript
// src/server.ts — register the new factor here. Nothing else changes.
// Before: 5 factors. After: 6 factors. RiskScoringService is unchanged.

const factors: IScoringFactor[] = [
  new BuyerCreditScorer(),
  new TenorScorer(),
  new SupplierTrackRecordScorer(),
  new ConcentrationRiskScorer(),
  new CollateralScorer(),
  new CurrencyRiskScorer(), // ← added here only
];

const riskService = new RiskScoringService(factors, riskRepository);
```

---

## L — Liskov Substitution Principle

_Any subtype can replace its supertype without altering correctness._

All payment providers implement IPaymentProvider. PaymentService works identically regardless of which provider is injected.

```typescript
// src/services/payments/payments.types.ts

export interface PaymentResult {
  success: boolean;
  transactionReference: string;
  providerReference: string;
  amount: number;
  currency: 'UGX';
  timestamp: Date;
  errorCode?: string;
}

export interface IPaymentProvider {
  execute(payment: {
    amount: number;
    destination: string;
    idempotencyKey: string;
  }): Promise<PaymentResult>;
}
```

```typescript
// src/services/payments/providers/mtn-momo.provider.ts

export class MTNMoMoProvider implements IPaymentProvider {
  async execute(payment): Promise<PaymentResult> {
    // calls MTN MoMo API v1.0 sandbox/production
    const response = await this.mtnClient.transfer({
      amount: payment.amount,
      currency: 'UGX',
      externalId: payment.idempotencyKey,
      payee: { partyIdType: 'MSISDN', partyId: payment.destination },
    });
    return {
      success: response.status === 'SUCCESSFUL',
      transactionReference: payment.idempotencyKey,
      providerReference: response.financialTransactionId,
      amount: payment.amount,
      currency: 'UGX',
      timestamp: new Date(),
      errorCode: response.status !== 'SUCCESSFUL' ? response.reason : undefined,
    };
  }
}
```

```typescript
// src/services/payments/providers/mock.provider.ts
// Used in tests — substitutes any real provider without behaviour change.

export class MockPaymentProvider implements IPaymentProvider {
  constructor(private readonly scenario: 'success' | 'failure' | 'timeout') {}

  async execute(payment): Promise<PaymentResult> {
    if (this.scenario === 'timeout') {
      await new Promise((resolve) => setTimeout(resolve, 35000)); // exceeds 30s timeout
    }
    return {
      success: this.scenario === 'success',
      transactionReference: payment.idempotencyKey,
      providerReference: `MOCK-${Date.now()}`,
      amount: payment.amount,
      currency: 'UGX',
      timestamp: new Date(),
      errorCode: this.scenario === 'failure' ? 'MOCK_FAILURE' : undefined,
    };
  }
}
```

```typescript
// src/services/payments/payments.service.ts
// PaymentService never knows which provider it uses — complete LSP compliance.

export class PaymentService {
  constructor(private readonly provider: IPaymentProvider) {}

  async executePayment(paymentId: string): Promise<void> {
    const payment = await this.repository.getPayment(paymentId);
    // Works identically with MTNMoMoProvider, AirtelProvider, BankEFTProvider, MockPaymentProvider
    const result = await this.provider.execute({
      amount: payment.amount,
      destination: payment.destination,
      idempotencyKey: payment.idempotencyKey,
    });
    if (!result.success) throw new PaymentError('Payment execution failed', { result });
    await this.repository.updatePaymentResult(paymentId, result);
  }
}
```

---

## I — Interface Segregation Principle

_No role should implement methods it does not use._

```typescript
// src/shared/types/role-actions.types.ts
// Each role interface contains ONLY the actions that role performs.

export interface ISupplierActions {
  submitInvoice(data: InvoiceSubmission): Promise<InvoiceResponse>;
  uploadDocument(supplierId: string, file: Buffer, type: DocumentType): Promise<void>;
  getOwnInvoices(supplierId: string): Promise<InvoiceResponse[]>;
  getOwnInvoice(supplierId: string, invoiceId: string): Promise<InvoiceResponse>;
}

export interface ICreditOfficerActions {
  getApprovalQueue(): Promise<ApprovalQueueItem[]>;
  lockInvoiceForReview(invoiceId: string): Promise<void>;
  approveInvoice(invoiceId: string, comments: string): Promise<void>;
  rejectInvoice(invoiceId: string, comments: string): Promise<void>;
  getRiskScore(invoiceId: string): Promise<RiskScoreResponse>;
  updateKycStatus(supplierId: string, status: KycStatus, comments: string): Promise<void>;
}

export interface IFinanceManagerActions {
  getPendingPayments(): Promise<PaymentResponse[]>;
  authorisePayment(paymentId: string): Promise<PaymentResponse>;
  getProfitReport(filters: ReportFilters): Promise<ProfitReport>;
  getFacilityReport(): Promise<FacilityReport>;
}

export interface IManagementActions {
  getPortfolioSummary(): Promise<PortfolioSummary>;
  getBuyerExposureReport(): Promise<BuyerExposureReport>;
  activateKillSwitch(reason: string): Promise<void>;
  getAllInvoices(filters: InvoiceFilters): Promise<InvoiceResponse[]>;
}

export interface IComplianceOfficerActions {
  getRegulatoryReport(): Promise<RegulatoryReport>;
  generateSAR(entityId: string, narrative: string): Promise<SARDocument>;
  reviewAmlFlag(flagId: string, decision: 'clear' | 'escalate'): Promise<void>;
}

export interface IAuditorActions {
  exportAuditTrail(filters: AuditFilters): Promise<ReadableStream>;
  getPortfolioSummary(): Promise<PortfolioSummary>;
}

// A supplier NEVER has access to IFinanceManagerActions.
// A credit officer NEVER has access to IFinanceManagerActions.
// Role guards enforce this — but the type system documents it.
```

---

## D — Dependency Inversion Principle

_Depend on abstractions, not concretions._

PaymentService depends on IPaymentProvider and IPaymentRepository. Concrete implementations are injected — enabling testing with MockPaymentProvider without any code change.

```typescript
// src/services/payments/payments.repository.interface.ts
// The abstraction PaymentService depends on.

export interface IPaymentRepository {
  createPayment(data: CreatePaymentData): Promise<Payment>;
  getPayment(paymentId: string): Promise<Payment>;
  getByIdempotencyKey(key: string): Promise<Payment | null>;
  recordFirstAuth(paymentId: string, userId: string): Promise<void>;
  recordSecondAuth(paymentId: string, userId: string): Promise<void>;
  updatePaymentResult(paymentId: string, result: PaymentResult): Promise<void>;
}
```

```typescript
// src/services/payments/payments.service.ts
// Depends ONLY on abstractions — never on concrete classes.

export class PaymentService {
  constructor(
    private readonly provider: IPaymentProvider, // abstraction
    private readonly repository: IPaymentRepository, // abstraction
    private readonly notificationQueue: Queue,
  ) {}

  async authorisePayment(paymentId: string, userId: string): Promise<Payment> {
    const payment = await this.repository.getPayment(paymentId);
    if (payment.dualAuthUser1 === userId) {
      throw new PaymentError('SAME_USER_DUAL_AUTH');
    }
    if (!payment.dualAuthUser1) {
      await this.repository.recordFirstAuth(paymentId, userId);
    } else {
      await this.repository.recordSecondAuth(paymentId, userId);
      await this.executePayment(paymentId);
    }
    return this.repository.getPayment(paymentId);
  }

  private async executePayment(paymentId: string): Promise<void> {
    const payment = await this.repository.getPayment(paymentId);
    const existing = await this.repository.getByIdempotencyKey(payment.idempotencyKey);
    if (existing?.status === 'funded') return; // idempotency check
    const result = await this.provider.execute({
      amount: payment.amount,
      destination: payment.destination,
      idempotencyKey: payment.idempotencyKey,
    });
    await this.repository.updatePaymentResult(paymentId, result);
  }
}
```

```typescript
// src/server.ts — dependency injection at composition root.
// Switch between real provider and mock by changing ONE line here.

// Production:
const paymentProvider: IPaymentProvider = new MTNMoMoProvider(process.env.MTN_MOMO_API_KEY!);

// Testing (no code change in PaymentService):
const paymentProvider: IPaymentProvider = new MockPaymentProvider('success');

const paymentRepository: IPaymentRepository = new PaymentRepository(pool);
const paymentService = new PaymentService(paymentProvider, paymentRepository, notificationQueue);
```

---

## Summary

| Principle                 | Applied To             | Benefit                                                               |
| ------------------------- | ---------------------- | --------------------------------------------------------------------- |
| S — Single Responsibility | Risk scoring factors   | Each factor changes independently — no ripple effects                 |
| O — Open/Closed           | Factor registration    | New factors added without touching existing code                      |
| L — Liskov Substitution   | Payment providers      | MockProvider replaces real provider in tests — zero behaviour change  |
| I — Interface Segregation | Role action interfaces | Type system enforces role boundaries at compile time                  |
| D — Dependency Inversion  | PaymentService         | Testable without a real payment API — inject mock at composition root |
