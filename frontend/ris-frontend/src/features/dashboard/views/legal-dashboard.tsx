import { ComplianceDashboard } from './compliance-dashboard';

/**
 * Legal role sees the same view as compliance — SAR flags, escalations, regulatory data.
 * Reuses ComplianceDashboard with no modifications.
 */
export function LegalDashboard(): React.ReactElement {
  return <ComplianceDashboard />;
}
