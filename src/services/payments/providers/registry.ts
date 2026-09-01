import { logger } from '../../../shared/logger';
import { registerProvider } from '../payments.service';
import { PaymentProvider } from '../payments.types';
import { BankEftProvider } from './bank-eft.provider';
import { MockProvider } from './mock.provider';

// =========================================================================
// Required env vars per provider
// =========================================================================
//
// Real providers read their credentials from process.env at module load time.
// We validate presence here so the server fails fast on startup in production
// rather than crashing inside the payment worker after second-auth has already
// committed (which would leave the payment stuck in EXECUTING).
//
// Layer 3 of dual-auth (provider) cannot run unless these are wired — without
// them the registry is empty and `executePayment` throws "No provider
// registered" mid-flow.

const EFT_REQUIRED_ENV = ['EFT_BANK_API_URL', 'EFT_BANK_API_KEY', 'EFT_OUTPUT_DIR'] as const;

/**
 * Throw a startup error listing every missing env var.
 * Intentionally does NOT log the values — only the names.
 */
function requireEnv(env: NodeJS.ProcessEnv, keys: readonly string[]): void {
  const missing = keys.filter((k) => env[k] === undefined || env[k] === '');
  if (missing.length > 0) {
    throw new Error(
      `Missing required payment provider env vars: ${missing.join(', ')}. ` +
        'Set them in .env.local (sandbox) or your production secret store before starting the server.',
    );
  }
}

/**
 * Register the EFT payment provider so that `executePayment` can resolve it
 * after dual-auth completes. EFT (bank ACH) is the sole real provider —
 * mobile-money support (MTN MoMo, Airtel) was shelved; only EFT and the
 * MOCK provider remain.
 *
 * Production (`NODE_ENV='production'`):
 *   - Instantiates the real BankEftProvider.
 *   - Throws if any required credential env var is missing — server refuses
 *     to start, so dual-auth approvals cannot be accepted while disbursement
 *     is broken.
 *
 * Non-production (test, dev, staging without `NODE_ENV=production`):
 *   - Registers `MockProvider` for both EFT and the MOCK channel. Existing
 *     test harnesses already call `registerProvider()` directly, so this is
 *     a safe default.
 *
 * Audits a `PAYMENT_PROVIDERS_REGISTERED` event with provider names only —
 * NEVER log the credentials.
 */
export function initPaymentProviders(env: NodeJS.ProcessEnv): void {
  const isProd = env.NODE_ENV === 'production';

  if (isProd) {
    requireEnv(env, EFT_REQUIRED_ENV);

    registerProvider(new BankEftProvider());
  } else {
    registerProvider(new MockProvider(PaymentProvider.EFT));
    registerProvider(new MockProvider(PaymentProvider.MOCK));
  }

  // Audit metadata — names only, no credentials.
  logger.audit('PAYMENT_PROVIDERS_REGISTERED', {
    component: 'payments',
    mode: isProd ? 'production' : 'mock',
    providers: [PaymentProvider.EFT, PaymentProvider.MOCK],
  });
}
