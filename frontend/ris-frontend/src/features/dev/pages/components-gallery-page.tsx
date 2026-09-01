import { useState } from 'react';
import { FileText, Users, CreditCard, AlertTriangle, Package } from 'lucide-react';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';

import { AmountDisplay } from '@/components/display/amount-display';
import { DateDisplay } from '@/components/display/date-display';
import { InvoiceStatusBadge, EscalationBadge, RiskBadge, PaymentStatusBadge } from '@/components/display/status-badge';
import { SlaCountdown } from '@/components/display/sla-countdown';
import { EmptyState } from '@/components/display/empty-state';

import { AmountInput } from '@/components/forms/amount-input';
import { PasswordInput } from '@/components/forms/password-input';
import { SearchableSelect } from '@/components/forms/searchable-select';
import { DateRangePicker } from '@/components/forms/date-range-picker';
import { ConfirmationDialog } from '@/components/overlays/confirmation-dialog';

import { StatCard } from '@/features/dashboard/components/stat-card';

import type { InvoiceStatus, EscalationLevel, RiskLevel } from '@/lib/constants';

const INVOICE_STATUSES: InvoiceStatus[] = [
  'draft', 'submitted', 'buyer_confirmed', 'scored', 'priced', 'approved', 'rejected',
  'pending_first_auth', 'pending_second_auth', 'executing', 'funded',
  'collecting', 'overdue', 'collected', 'defaulted', 'cancelled',
];
const ESCALATION_LEVELS: EscalationLevel[] = ['none', 'reminder', 'formal', 'legal'];
const RISK_LEVELS: RiskLevel[] = ['low', 'medium', 'high', 'critical'];
const PAYMENT_STATUSES = ['pending_first_auth', 'pending_second_auth', 'executing', 'funded', 'failed', 'reversed'];

export function ComponentsGalleryPage(): React.ReactElement {
  const [amountVal, setAmountVal] = useState(1500000);
  const [pwVal, setPwVal] = useState('');
  const [selectVal, setSelectVal] = useState('');
  const [dateFrom, setDateFrom] = useState<Date>();
  const [dateTo, setDateTo] = useState<Date>();
  const [showDialog, setShowDialog] = useState(false);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold font-display">Components Gallery</h1>
        <p className="text-sm text-muted-foreground">Visual showcase of all shared components (dev only)</p>
      </div>

      <Tabs defaultValue="display">
        <TabsList>
          <TabsTrigger value="display">Display</TabsTrigger>
          <TabsTrigger value="forms">Forms</TabsTrigger>
          <TabsTrigger value="badges">Badges</TabsTrigger>
          <TabsTrigger value="cards">Cards</TabsTrigger>
          <TabsTrigger value="overlays">Overlays</TabsTrigger>
        </TabsList>

        {/* ── Display ── */}
        <TabsContent value="display" className="space-y-6 mt-4">
          <Card>
            <CardHeader><CardTitle className="text-base">AmountDisplay</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              <div className="flex items-center gap-4">
                <AmountDisplay value={1500000} />
                <AmountDisplay value={0} />
                <AmountDisplay value={null} />
                <AmountDisplay value={100000000000} />
                <AmountDisplay value={-500000} colorCoded />
                <AmountDisplay value={2500000} colorCoded />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-base">DateDisplay</CardTitle></CardHeader>
            <CardContent className="flex items-center gap-6">
              <div><p className="text-xs text-muted-foreground mb-1">Relative</p><DateDisplay value={new Date(Date.now() - 3600000).toISOString()} variant="relative" /></div>
              <div><p className="text-xs text-muted-foreground mb-1">Absolute</p><DateDisplay value={new Date().toISOString()} variant="absolute" /></div>
              <div><p className="text-xs text-muted-foreground mb-1">Date only</p><DateDisplay value="2025-03-27" variant="date" /></div>
              <div><p className="text-xs text-muted-foreground mb-1">Null</p><DateDisplay value={null} /></div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-base">SlaCountdown</CardTitle></CardHeader>
            <CardContent className="flex items-center gap-4">
              <div><p className="text-xs text-muted-foreground mb-1">72h (fresh)</p><SlaCountdown startedAt={new Date().toISOString()} slaHours={72} /></div>
              <div><p className="text-xs text-muted-foreground mb-1">24h (50% left)</p><SlaCountdown startedAt={new Date(Date.now() - 12 * 3600000).toISOString()} slaHours={24} /></div>
              <div><p className="text-xs text-muted-foreground mb-1">24h (breached)</p><SlaCountdown startedAt={new Date(Date.now() - 30 * 3600000).toISOString()} slaHours={24} /></div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-base">EmptyState</CardTitle></CardHeader>
            <CardContent>
              <EmptyState icon={Package} title="No invoices yet" description="Submit your first invoice to get started." action={<Button size="sm">Create Invoice</Button>} />
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Forms ── */}
        <TabsContent value="forms" className="space-y-6 mt-4">
          <Card>
            <CardHeader><CardTitle className="text-base">AmountInput</CardTitle></CardHeader>
            <CardContent className="max-w-sm">
              <AmountInput value={amountVal} onChange={setAmountVal} />
              <p className="text-xs text-muted-foreground mt-1">Raw value: {amountVal}</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-base">PasswordInput (with strength meter)</CardTitle></CardHeader>
            <CardContent className="max-w-sm">
              <PasswordInput showStrength value={pwVal} onChange={(e) => setPwVal(e.target.value)} placeholder="Enter password..." />
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-base">SearchableSelect</CardTitle></CardHeader>
            <CardContent className="max-w-sm">
              <SearchableSelect
                options={[
                  { value: '1', label: 'Stanbic Bank Uganda' },
                  { value: '2', label: 'MTN Uganda Ltd' },
                  { value: '3', label: 'Umeme Ltd' },
                  { value: '4', label: 'Airtel Uganda' },
                  { value: '5', label: 'Centenary Bank' },
                ]}
                value={selectVal}
                onChange={setSelectVal}
                placeholder="Select a buyer..."
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-base">DateRangePicker</CardTitle></CardHeader>
            <CardContent>
              <DateRangePicker from={dateFrom} to={dateTo} onChange={({ from, to }) => { setDateFrom(from); setDateTo(to); }} />
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Badges ── */}
        <TabsContent value="badges" className="space-y-6 mt-4">
          <Card>
            <CardHeader><CardTitle className="text-base">Invoice Status Badges</CardTitle></CardHeader>
            <CardContent className="flex flex-wrap gap-2">
              {INVOICE_STATUSES.map((s) => <InvoiceStatusBadge key={s} status={s} />)}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-base">Escalation Badges</CardTitle></CardHeader>
            <CardContent className="flex flex-wrap gap-2">
              {ESCALATION_LEVELS.map((l) => <EscalationBadge key={l} level={l} />)}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-base">Risk Badges</CardTitle></CardHeader>
            <CardContent className="flex flex-wrap gap-2">
              {RISK_LEVELS.map((l) => <RiskBadge key={l} level={l} />)}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-base">Payment Status Badges</CardTitle></CardHeader>
            <CardContent className="flex flex-wrap gap-2">
              {PAYMENT_STATUSES.map((s) => <PaymentStatusBadge key={s} status={s} />)}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Cards ── */}
        <TabsContent value="cards" className="space-y-6 mt-4">
          <Card>
            <CardHeader><CardTitle className="text-base">StatCard variants</CardTitle></CardHeader>
            <CardContent>
              <div className="grid gap-4 md:grid-cols-4">
                <StatCard title="Total Invoices" value="183" icon={FileText} change={22.7} subtitle="vs prev" />
                <StatCard title="Overdue" value="9" icon={AlertTriangle} change={-12.1} />
                <StatCard title="Users" value="42" icon={Users} />
                <StatCard title="Funded" value="UGX 38.6B" icon={CreditCard} change={0} subtitle="flat" />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-base">Progress bars</CardTitle></CardHeader>
            <CardContent className="space-y-3 max-w-md">
              <div className="flex items-center gap-2"><span className="text-xs w-12">25%</span><Progress value={25} className="h-2" /></div>
              <div className="flex items-center gap-2"><span className="text-xs w-12">50%</span><Progress value={50} className="h-2" /></div>
              <div className="flex items-center gap-2"><span className="text-xs w-12">75%</span><Progress value={75} className="h-2" /></div>
              <div className="flex items-center gap-2"><span className="text-xs w-12">100%</span><Progress value={100} className="h-2" /></div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Overlays ── */}
        <TabsContent value="overlays" className="space-y-6 mt-4">
          <Card>
            <CardHeader><CardTitle className="text-base">ConfirmationDialog</CardTitle></CardHeader>
            <CardContent className="flex gap-3">
              <Button onClick={() => setShowDialog(true)}>Open Confirmation</Button>
              <Button variant="destructive" onClick={() => setShowDialog(true)}>Destructive Confirmation</Button>
            </CardContent>
          </Card>
          <ConfirmationDialog
            open={showDialog}
            onOpenChange={setShowDialog}
            title="Confirm Action"
            description="Are you sure you want to proceed? This is a demo dialog."
            confirmLabel="Proceed"
            onConfirm={() => setShowDialog(false)}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}

export default ComponentsGalleryPage;
