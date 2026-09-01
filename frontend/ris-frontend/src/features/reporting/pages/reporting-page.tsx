import { useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Download, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { DateRangePicker } from '@/components/forms/date-range-picker';
import { useAuthStore } from '@/store/auth.store';
import { ErrorBoundary } from '@/components/display/error-boundary';
import type { ReportFilters, PortfolioReport as PortfolioData, AgingReport as AgingData, BuyerExposureRow, ProfitReport as ProfitData, FacilityReport as FacilityData, AuditExportReport, RegulatoryReport as RegulatoryData, ApplicationsReceivedReport as ApplicationsReceivedData, ApplicationsPipelineReport as ApplicationsPipelineData, IncompleteApplicationRow, CompanyPlReport as CompanyPlData, DisbursedFundsReport as DisbursedFundsData } from '@/types/reporting.types';
import type { Role } from '@/lib/constants';
import type { LucideIcon } from 'lucide-react';
import { BarChart3, Clock, Users, DollarSign, Building2, FileText, Shield, Inbox, Workflow, AlertCircle, Coins, Banknote } from 'lucide-react';
import { exportCsv } from '@/lib/csv-export';
import {
  fetchPortfolioReport, fetchAgingReport, fetchBuyerExposure, fetchProfitReport,
  fetchFacilitiesReport, fetchAuditExport, fetchRegulatoryReport,
  fetchApplicationsReceived, fetchApplicationsPipeline, fetchApplicationsIncomplete,
  fetchCompanyPl, fetchDisbursedFunds,
} from '../api/reporting.api';
import { parseApiError } from '@/lib/parse-api-error';

// Direct imports — no lazy loading to avoid Suspense + Radix Tabs interaction issues
import PortfolioReport from '../components/portfolio-report';
import AgingReport from '../components/aging-report';
import BuyerExposureReport from '../components/buyer-exposure-report';
import ProfitReport from '../components/profit-report';
import FacilitiesReport from '../components/facilities-report';
import RegulatoryReport from '../components/regulatory-report';
import AuditReport from '../components/audit-report';
import ApplicationsReceivedReport from '../components/applications-received-report';
import ApplicationsPipelineReport from '../components/applications-pipeline-report';
import ApplicationsIncompleteReport from '../components/applications-incomplete-report';
import CompanyPlReport from '../components/company-pl-report';
import DisbursedFundsReport from '../components/disbursed-funds-report';

interface ReportTab {
  key: string;
  label: string;
  icon: LucideIcon;
  roles: Role[];
}

const REPORT_TABS: ReportTab[] = [
  {
    key: 'portfolio',
    label: 'Portfolio',
    icon: BarChart3,
    roles: ['management', 'auditor', 'compliance_officer'],
  },
  {
    key: 'aging',
    label: 'Aging',
    icon: Clock,
    roles: ['credit_officer', 'management', 'auditor', 'compliance_officer'],
  },
  {
    key: 'buyer-exposure',
    label: 'Exposure',
    icon: Users,
    roles: ['credit_officer', 'management'],
  },
  { key: 'profit', label: 'P&L', icon: DollarSign, roles: ['finance_manager', 'management'] },
  {
    key: 'facilities',
    label: 'Facilities',
    icon: Building2,
    roles: ['finance_manager', 'management'],
  },
  {
    key: 'regulatory',
    label: 'Compliance',
    icon: Shield,
    roles: ['compliance_officer', 'management'],
  },
  { key: 'audit-export', label: 'Audit', icon: FileText, roles: ['auditor', 'compliance_officer'] },

  // Checkers §6 — five reports the operations team needs visibility on.
  {
    key: 'applications-received',
    label: 'Applications',
    icon: Inbox,
    roles: ['management', 'credit_officer', 'auditor'],
  },
  {
    key: 'applications-pipeline',
    label: 'Pipeline',
    icon: Workflow,
    roles: ['management', 'credit_officer', 'compliance_officer'],
  },
  {
    key: 'applications-incomplete',
    label: 'Incomplete',
    icon: AlertCircle,
    roles: ['management', 'credit_officer', 'compliance_officer'],
  },
  {
    key: 'company-pl',
    label: 'Company P&L',
    icon: Coins,
    roles: ['finance_manager', 'management'],
  },
  {
    key: 'disbursed-funds',
    label: 'Disbursed',
    icon: Banknote,
    roles: ['finance_manager', 'management', 'auditor'],
  },
];

const PERIOD_OPTIONS = [
  { value: '7d', label: '7 days' },
  { value: '30d', label: '30 days' },
  { value: '90d', label: '90 days' },
  { value: '12m', label: '12 months' },
  { value: 'all', label: 'All time' },
];

const REPORT_COMPONENTS: Record<string, React.ComponentType<{ filters: ReportFilters }>> = {
  portfolio: PortfolioReport,
  aging: AgingReport,
  'buyer-exposure': BuyerExposureReport,
  profit: ProfitReport,
  facilities: FacilitiesReport,
  regulatory: RegulatoryReport,
  'audit-export': AuditReport,
  'applications-received': ApplicationsReceivedReport,
  'applications-pipeline': ApplicationsPipelineReport,
  'applications-incomplete': ApplicationsIncompleteReport,
  'company-pl': CompanyPlReport,
  'disbursed-funds': DisbursedFundsReport,
};

// ── Per-tab CSV export builders ─────────────────────────────────────────────

function exportPortfolio(data: PortfolioData): void {
  const headers = ['Metric', 'Value'];
  const rows: (string | number)[][] = [
    ['Total Funded', data.totalFunded],
    ['Total Collected', data.totalCollected],
    ['Total Outstanding', data.totalOutstanding],
    ['Total Overdue', data.totalOverdue],
    ['Annualised Yield %', data.annualisedYield],
    [],
    ['Top Buyer', 'Total Exposure'],
    ...data.topBuyers.map((b) => [b.buyerName, b.totalExposure]),
  ];
  exportCsv('portfolio-report.csv', headers, rows);
}

function exportAging(data: AgingData): void {
  const headers = ['Bucket', 'Count', 'Total Amount'];
  const rows = data.buckets.map((b) => [b.bucket, b.count, b.totalAmount]);
  exportCsv('aging-report.csv', headers, rows);
}

function exportExposure(data: BuyerExposureRow[]): void {
  const headers = ['Buyer', 'Used Limit', 'Approved Limit', 'Utilisation %', 'Avg Days to Pay', 'Overdue Incidents'];
  const rows = data.map((b) => [b.buyerName, b.usedLimit, b.approvedLimit, b.utilisationPct, b.avgDaysToPay, b.overdueIncidentCount]);
  exportCsv('buyer-exposure-report.csv', headers, rows);
}

function exportProfit(data: ProfitData): void {
  const headers = ['Invoice', 'Face Value', 'Discount', 'Bank Interest', 'Net Profit', 'Margin %'];
  const rows: (string | number)[][] = data.invoices.map((i) => [
    i.invoiceNumber ?? i.invoiceId, i.faceValue, i.discountAmount,
    i.bankInterestCost, i.netMmsProfit, i.profitMarginPct,
  ]);
  rows.push([]);
  rows.push(['TOTAL', data.summary.totalFaceValue, data.summary.totalDiscount, data.summary.totalBankInterest, data.summary.totalNetProfit, data.summary.avgProfitMarginPct]);
  exportCsv('profit-report.csv', headers, rows);
}

function exportFacilities(data: FacilityData): void {
  const headers = ['Bank', 'Total Limit', 'Drawn', 'Available', 'Utilisation %', 'Interest Accrued', 'Maturity', 'Status'];
  const rows = data.data.map((f) => [f.bankName, f.totalLimit, f.drawnAmount, f.availableAmount, f.utilisationPct, f.interestAccrued, f.maturityDate, f.status]);
  exportCsv('facilities-report.csv', headers, rows);
}

function exportRegulatory(data: RegulatoryData): void {
  const headers = ['Metric', 'Value'];
  const rows: (string | number)[][] = [
    ['AML Flags Raised', data.amlFlagsRaised],
    ['SARs Filed', data.sarsFiled],
    ['Transactions Above Threshold', data.transactionsAboveThreshold],
    ['KYC Approvals', data.kycApprovals],
    ['KYC Rejections', data.kycRejections],
  ];
  exportCsv('regulatory-report.csv', headers, rows);
}

function exportAudit(data: AuditExportReport): void {
  const headers = ['User ID', 'Action', 'Table', 'Record ID', 'Date'];
  const rows = data.entries.map((e) => [e.userId, e.action, e.tableName, e.recordId, e.createdAt]);
  exportCsv('audit-export.csv', headers, rows);
}

// ── Checkers §6 CSV exporters ────────────────────────────────────────────────

function exportApplicationsReceived(data: ApplicationsReceivedData): void {
  const rows: (string | number)[][] = [['Metric', 'Value'], ['Total Applications', data.total], []];
  rows.push(['Status', 'Count']);
  data.byStatus.forEach((r) => rows.push([r.status, r.count]));
  rows.push([]);
  rows.push(['Date', 'Applications']);
  data.byDay.forEach((r) => rows.push([r.date, r.count]));
  exportCsv('applications-received.csv', rows[0].map(String), rows.slice(1));
}

function exportApplicationsPipeline(data: ApplicationsPipelineData): void {
  const headers = ['Stage', 'Count', 'Avg Days in Stage'];
  const rows = data.stages.map((s) => [s.kycStatus, s.count, s.avgDaysInStatus]);
  exportCsv('applications-pipeline.csv', headers, rows);
}

function exportApplicationsIncomplete(data: IncompleteApplicationRow[]): void {
  const headers = ['Supplier ID', 'KYC Status', 'Days in Status', 'Missing Documents'];
  const rows = data.map((r) => [r.supplierId, r.kycStatus, r.daysInStatus, r.missingDocTypes.join('; ')]);
  exportCsv('applications-incomplete.csv', headers, rows);
}

function exportCompanyPl(data: CompanyPlData): void {
  const headers = ['Metric', 'Value (UGX)'];
  const rows: (string | number)[][] = [
    ['Total Face Value Discounted', data.totalFaceValueDiscounted],
    ['Total Discount Earned',       data.totalDiscountEarned],
    ['Total Bank Interest Cost',    data.totalBankInterestCost],
    ['Gross Profit',                data.grossProfit],
  ];
  exportCsv('company-pl.csv', headers, rows);
}

function exportDisbursedFunds(data: DisbursedFundsData): void {
  const headers = ['Invoice ID', 'Supplier ID', 'Buyer ID', 'Amount (UGX)', 'Status', 'Disbursed At'];
  const rows: (string | number)[][] = data.payments.map((p) => [
    p.invoiceId, p.supplierId, p.buyerId, p.disbursedAmount, p.status, p.disbursedAt,
  ]);
  rows.push([]);
  rows.push(['TOTAL', '', '', data.totalDisbursed, `${data.count} payments`, '']);
  exportCsv('disbursed-funds.csv', headers, rows);
}

// ── Report header ───────────────────────────────────────────────────────────

function ReportHeader({
  period,
  setPeriod,
  from,
  to,
  setFrom,
  setTo,
  onExport,
  exporting,
}: {
  period: string;
  setPeriod: (v: string) => void;
  from: Date | undefined;
  to: Date | undefined;
  setFrom: (v: Date | undefined) => void;
  setTo: (v: Date | undefined) => void;
  onExport: () => void;
  exporting: boolean;
}): React.ReactElement {
  return (
    <div className="flex items-center justify-between">
      <div>
        <h1 className="text-2xl font-bold font-display">Reporting</h1>
        <p className="text-sm text-muted-foreground">Financial analytics and compliance</p>
      </div>
      <div className="flex items-center gap-3">
        <Select value={period} onValueChange={setPeriod}>
          <SelectTrigger className="w-28">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PERIOD_OPTIONS.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <DateRangePicker
          from={from}
          to={to}
          onChange={({ from: f, to: t }) => {
            setFrom(f);
            setTo(t);
          }}
        />
        <Button variant="outline" size="sm" onClick={onExport} disabled={exporting}>
          {exporting
            ? <Loader2 className="mr-2 size-4 animate-spin" />
            : <Download className="mr-2 size-4" />}
          Export
        </Button>
      </div>
    </div>
  );
}

export function ReportingPage(): React.ReactElement {
  const { type } = useParams<{ type: string }>();
  const navigate = useNavigate();
  const role = useAuthStore((s) => s.role);

  const visibleTabs = REPORT_TABS.filter((t) => role && t.roles.includes(role));
  const firstVisible = visibleTabs[0]?.key ?? 'portfolio';
  const [selectedTab, setSelectedTab] = useState(type ?? firstVisible);
  const [period, setPeriod] = useState('30d');
  const [from, setFrom] = useState<Date>();
  const [to, setTo] = useState<Date>();
  const [exporting, setExporting] = useState(false);

  // Clamp to a visible tab synchronously — no useEffect race condition
  const activeTab = visibleTabs.some((t) => t.key === selectedTab) ? selectedTab : firstVisible;

  const filters: ReportFilters = {
    period,
    startDate: from?.toISOString().slice(0, 10),
    endDate: to?.toISOString().slice(0, 10),
  };

  function handleTabChange(tab: string): void {
    setSelectedTab(tab);
    navigate(`/reporting/${tab}`, { replace: true });
  }

  const handleExport = useCallback(() => {
    setExporting(true);
    const apiFilters = { startDate: filters.startDate, endDate: filters.endDate };

    async function doExport(): Promise<void> {
      switch (activeTab) {
        case 'portfolio': {
          const data = await fetchPortfolioReport(apiFilters) as PortfolioData;
          exportPortfolio(data);
          break;
        }
        case 'aging': {
          const data = await fetchAgingReport(apiFilters) as AgingData;
          exportAging(data);
          break;
        }
        case 'buyer-exposure': {
          const data = await fetchBuyerExposure(apiFilters) as BuyerExposureRow[];
          exportExposure(data);
          break;
        }
        case 'profit': {
          const data = await fetchProfitReport(apiFilters) as ProfitData;
          exportProfit(data);
          break;
        }
        case 'facilities': {
          const data = await fetchFacilitiesReport(apiFilters) as FacilityData;
          exportFacilities(data);
          break;
        }
        case 'regulatory': {
          const data = await fetchRegulatoryReport(apiFilters) as RegulatoryData;
          exportRegulatory(data);
          break;
        }
        case 'audit-export': {
          const data = await fetchAuditExport(apiFilters) as AuditExportReport;
          exportAudit(data);
          break;
        }
        case 'applications-received': {
          const data = await fetchApplicationsReceived(apiFilters) as ApplicationsReceivedData;
          exportApplicationsReceived(data);
          break;
        }
        case 'applications-pipeline': {
          const data = await fetchApplicationsPipeline(apiFilters) as ApplicationsPipelineData;
          exportApplicationsPipeline(data);
          break;
        }
        case 'applications-incomplete': {
          const data = await fetchApplicationsIncomplete(apiFilters) as IncompleteApplicationRow[];
          exportApplicationsIncomplete(data);
          break;
        }
        case 'company-pl': {
          const data = await fetchCompanyPl(apiFilters) as CompanyPlData;
          exportCompanyPl(data);
          break;
        }
        case 'disbursed-funds': {
          const data = await fetchDisbursedFunds(apiFilters) as DisbursedFundsData;
          exportDisbursedFunds(data);
          break;
        }
      }
    }

    doExport()
      .then(() => toast.success('Report exported'))
      .catch((err: unknown) => toast.error(parseApiError(err)))
      .finally(() => setExporting(false));
  }, [activeTab, filters.startDate, filters.endDate]);

  if (visibleTabs.length === 0) {
    return (
      <div className="space-y-6">
        <ReportHeader
          period={period}
          setPeriod={setPeriod}
          from={from}
          to={to}
          setFrom={setFrom}
          setTo={setTo}
          onExport={handleExport}
          exporting={exporting}
        />
        <p className="text-muted-foreground text-center py-8">
          No reports available for your role.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <ReportHeader
        period={period}
        setPeriod={setPeriod}
        from={from}
        to={to}
        setFrom={setFrom}
        setTo={setTo}
        onExport={handleExport}
        exporting={exporting}
      />

      <Tabs value={activeTab} onValueChange={handleTabChange}>
        <TabsList variant="line" className="w-full justify-start border-b">
          {visibleTabs.map((tab) => (
            <TabsTrigger key={tab.key} value={tab.key} className="gap-1.5">
              <tab.icon className="size-3.5" />
              {tab.label}
            </TabsTrigger>
          ))}
        </TabsList>

        {visibleTabs.map((tab) => {
          const ReportComponent = REPORT_COMPONENTS[tab.key];
          return (
            <TabsContent key={tab.key} value={tab.key}>
              <ErrorBoundary>
                {ReportComponent && <ReportComponent filters={filters} />}
              </ErrorBoundary>
            </TabsContent>
          );
        })}
      </Tabs>
    </div>
  );
}

export default ReportingPage;
