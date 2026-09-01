import { useAuthStore } from '@/store/auth.store';
import type { Role } from '@/lib/constants';

import { SupplierDashboard } from '../views/supplier-dashboard';
import { CreditOfficerDashboard } from '../views/credit-officer-dashboard';
import { FinanceManagerDashboard } from '../views/finance-manager-dashboard';
import { ManagementDashboard } from '../views/management-dashboard';
import { ComplianceDashboard } from '../views/compliance-dashboard';
import { AuditorDashboard } from '../views/auditor-dashboard';
import { LegalDashboard } from '../views/legal-dashboard';

const ROLE_DASHBOARDS: Record<Role, React.ComponentType> = {
  supplier:            SupplierDashboard,
  credit_officer:      CreditOfficerDashboard,
  finance_manager:     FinanceManagerDashboard,
  management:          ManagementDashboard,
  compliance_officer:  ComplianceDashboard,
  auditor:             AuditorDashboard,
  legal:               LegalDashboard,
};

/**
 * Role dispatcher — renders the appropriate dashboard view
 * based on the authenticated user's role.
 */
export function DashboardPage(): React.ReactElement {
  const role = useAuthStore((s) => s.role) as Role | null;
  const View = role ? ROLE_DASHBOARDS[role] : ManagementDashboard;

  return <View />;
}

export default DashboardPage;
