import { setupWorker } from 'msw/browser';
import { authHandlers }         from './handlers/auth.handlers';
import { dashboardHandlers }    from './handlers/dashboard.handlers';
import { roleSpecificHandlers } from './handlers/roleSpecific.handlers';
import { invoiceHandlers }      from './handlers/invoice.handlers';
import { buyersHandlers }       from './handlers/buyers.handlers';
import { collectionsHandlers }  from './handlers/collections.handlers';
import { approvalsHandlers }    from './handlers/approvals.handlers';
import { collateralHandlers }   from './handlers/collateral.handlers';
import { suppliersHandlers }    from './handlers/suppliers.handlers';
import { settingsHandlers }     from './handlers/settings.handlers';
import { adminHandlers }        from './handlers/admin.handlers';
import { paymentsHandlers }     from './handlers/payments.handlers';
import { settlementsHandlers }  from './handlers/settlements.handlers';
import { pricingHandlers }      from './handlers/pricing.handlers';
import { kycHandlers }          from './handlers/kyc.handlers';
import { facilitiesHandlers }   from './handlers/facilities.handlers';
import { reportingHandlers }    from './handlers/reporting.handlers';
import { onboardingHandlers }   from './handlers/onboarding.handlers';

/**
 * MSW Service Worker — active in development only.
 * Registered in main.tsx before the React root mounts.
 */
export const worker = setupWorker(
  ...authHandlers,
  ...dashboardHandlers,
  ...roleSpecificHandlers,
  ...invoiceHandlers,
  ...buyersHandlers,
  ...collectionsHandlers,
  ...approvalsHandlers,
  ...collateralHandlers,
  ...suppliersHandlers,
  ...settingsHandlers,
  ...adminHandlers,
  ...paymentsHandlers,
  ...settlementsHandlers,
  ...pricingHandlers,
  ...kycHandlers,
  ...facilitiesHandlers,
  ...reportingHandlers,
  ...onboardingHandlers,
);
