import { useNavigate } from 'react-router-dom';
import {
  BarChart3, Clock, Users, DollarSign, Building2, FileText, Shield,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useAuthStore } from '@/store/auth.store';
import type { Role } from '@/lib/constants';
import type { LucideIcon } from 'lucide-react';

interface ReportCard {
  key: string;
  title: string;
  description: string;
  icon: LucideIcon;
  roles: Role[];
}

const REPORTS: ReportCard[] = [
  { key: 'portfolio', title: 'Portfolio Overview', description: 'Funded, collected, outstanding, overdue totals with status breakdown', icon: BarChart3, roles: ['management', 'auditor', 'compliance_officer'] },
  { key: 'aging', title: 'Aging Analysis', description: 'Receivables aging by bucket (0-30, 31-60, 61-90, 90+ days)', icon: Clock, roles: ['credit_officer', 'management', 'auditor', 'compliance_officer'] },
  { key: 'buyer-exposure', title: 'Buyer Exposure', description: 'Credit utilisation, payment performance per buyer', icon: Users, roles: ['credit_officer', 'management'] },
  { key: 'profit', title: 'Profit & Loss', description: 'Discount income, bank interest costs, net profit margins', icon: DollarSign, roles: ['finance_manager', 'management'] },
  { key: 'facilities', title: 'Facilities Usage', description: 'Bank credit line utilisation and upcoming maturities', icon: Building2, roles: ['finance_manager', 'management'] },
  { key: 'audit-export', title: 'Audit Export', description: 'Full audit trail export in CSV or JSON format', icon: FileText, roles: ['auditor', 'compliance_officer'] },
  { key: 'regulatory', title: 'Regulatory Compliance', description: 'AML flags, SARs filed, KYC statistics', icon: Shield, roles: ['compliance_officer', 'management'] },
];

export function ReportSelectorPage(): React.ReactElement {
  const navigate = useNavigate();
  const role = useAuthStore((s) => s.role);

  const visible = REPORTS.filter((r) => role && r.roles.includes(role));

  return (
    <div className="space-y-6">
      <div><h1 className="text-2xl font-bold font-display">Reporting</h1><p className="text-sm text-muted-foreground">Select a report to view</p></div>
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {visible.map((r) => (
          <Card key={r.key} className="cursor-pointer hover:border-primary/50 hover:shadow-sm transition-all" onClick={() => navigate(`/reporting/${r.key}`)}>
            <CardHeader className="flex flex-row items-center gap-3 pb-2">
              <r.icon className="size-5 text-primary shrink-0" />
              <CardTitle className="text-base">{r.title}</CardTitle>
            </CardHeader>
            <CardContent><p className="text-sm text-muted-foreground">{r.description}</p></CardContent>
          </Card>
        ))}
        {visible.length === 0 && <p className="text-muted-foreground col-span-full text-center py-8">No reports available for your role.</p>}
      </div>
    </div>
  );
}
export default ReportSelectorPage;
