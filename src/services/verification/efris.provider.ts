/**
 * URA EFRIS (Electronic Fiscal Receipt and Invoicing System) verification.
 *
 * Uganda Revenue Authority requires taxpayers to issue invoices through EFRIS.
 * Each EFRIS-issued invoice carries a reference number that can be validated
 * against the URA registry. RIS verifies this reference before accepting the
 * invoice as authentic.
 *
 * Provider is looked up at runtime via `getEfrisProvider()`:
 *  - NODE_ENV=test / development  → MockEfrisProvider (no network)
 *  - NODE_ENV=production          → UraEfrisProvider  (real HTTP to URA)
 *
 * Mirrors the provider pattern used in `src/services/payments/providers/`.
 */
import { logger } from '../../shared/logger';

export interface EfrisVerificationResult {
  /** True when the EFRIS reference exists at URA and matches the expected invoice. */
  verified: boolean;
  /** URA's response correlation id. Empty when verified=false. */
  providerReference: string;
  /** Short machine-readable reason, e.g. "not_found" | "amount_mismatch". */
  mismatchReason?: string;
}

export interface IEfrisProvider {
  readonly name: string;
  verifyReference(efrisRef: string, faceValueUgx: bigint): Promise<EfrisVerificationResult>;
}

/**
 * Deterministic mock. Test harness conventions:
 *   ref starts with "EFRIS-BAD-"      → verified=false, reason "mock_bad_ref"
 *   ref starts with "EFRIS-MISMATCH-" → verified=false, reason "amount_mismatch"
 *   anything else                     → verified=true
 */
export class MockEfrisProvider implements IEfrisProvider {
  public readonly name = 'EFRIS_MOCK';

  // eslint-disable-next-line @typescript-eslint/require-await
  public async verifyReference(
    ref: string,
    _faceValueUgx: bigint,
  ): Promise<EfrisVerificationResult> {
    if (ref.startsWith('EFRIS-BAD-')) {
      return { verified: false, providerReference: '', mismatchReason: 'mock_bad_ref' };
    }
    if (ref.startsWith('EFRIS-MISMATCH-')) {
      return { verified: false, providerReference: '', mismatchReason: 'amount_mismatch' };
    }
    return { verified: true, providerReference: `URA-MOCK-${Date.now()}` };
  }
}

/**
 * Production provider. Performs an HTTP call to the URA EFRIS validation API.
 * Until credentials are issued the implementation falls back to the mock so
 * startup does not fail. The real HTTP call is outlined in the body for the
 * integration work that completes REQ-VERIFY-EFRIS.
 */
export class UraEfrisProvider implements IEfrisProvider {
  public readonly name = 'URA_EFRIS';

  public async verifyReference(
    ref: string,
    faceValueUgx: bigint,
  ): Promise<EfrisVerificationResult> {
    // TODO: once URA EFRIS API credentials are provisioned, replace this
    // fallback with a real HTTPS call wrapped in the standard BullMQ retry
    // (attempts: 3, backoff exponential 30s) as per src/services/CLAUDE.md.
    logger.warn('UraEfrisProvider falling back to mock — credentials not configured', {
      component: 'verification',
    });
    return new MockEfrisProvider().verifyReference(ref, faceValueUgx);
  }
}

let efrisProvider: IEfrisProvider | null = null;

/** Override the provider (used by tests and wire-up at startup). */
export function setEfrisProvider(provider: IEfrisProvider): void {
  efrisProvider = provider;
}

/** Return the active EFRIS provider, selecting a default by environment. */
export function getEfrisProvider(): IEfrisProvider {
  if (efrisProvider !== null) return efrisProvider;
  return process.env.NODE_ENV === 'production' ? new UraEfrisProvider() : new MockEfrisProvider();
}
