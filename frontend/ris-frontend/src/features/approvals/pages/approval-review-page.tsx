import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Check, X, MessageSquare, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid,
} from 'recharts';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { Skeleton } from '@/components/ui/skeleton';
import { Separator } from '@/components/ui/separator';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { ConfirmationDialog } from '@/components/overlays/confirmation-dialog';
import { AmountDisplay } from '@/components/display/amount-display';
import { RiskBadge } from '@/components/display/status-badge';
import { RiskScoreRadar } from '@/components/display/risk-score-radar';
import { ApprovalTierBadge } from '@/components/display/approval-tier-badge';
import { SlaCountdown } from '@/components/display/sla-countdown';
import { useApprovalDetail, useApproveInvoice, useRejectInvoice, useRequestInfo } from '../hooks/use-approvals';
import { formatDate } from '@/lib/format-date';
import { parseApiError } from '@/lib/parse-api-error';
import type { ApprovalTier } from '@/types/approval.types';

const TIER_LABELS: Record<ApprovalTier, string> = {
  AUTO: 'Auto Approval',
  TIER_2: 'Credit Officer',
  TIER_3: 'Finance Manager',
  TIER_4: 'Management / Board',
};

const COMMENT_MIN_LENGTH = 20;

export function ApprovalReviewPage(): React.ReactElement {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { data, isLoading } = useApprovalDetail(id ?? '');
  const approve = useApproveInvoice();
  const reject = useRejectInvoice();
  const reqInfo = useRequestInfo();

  const [showApprove, setShowApprove] = useState(false);
  const [showReject, setShowReject] = useState(false);
  const [reason, setReason] = useState('');
  // G10 — case summary writeup. Required (min 30 chars) for TIER_2+.
  const [reviewSummary, setReviewSummary] = useState('');
  const [infoMsg, setInfoMsg] = useState('');

  if (isLoading) {
    return <div className="space-y-4"><Skeleton className="h-8 w-64" /><Skeleton className="h-96 w-full" /></div>;
  }
  if (!data) {
    return <div className="py-20 text-center text-muted-foreground">Approval not found.</div>;
  }

  const inv = data.invoice;
  const rb = data.riskBreakdown;
  const chartData = rb ? [
    { name: 'Buyer Credit', score: rb.buyerCredit },
    { name: 'Supplier Track', score: rb.supplierTrackRecord },
    { name: 'Concentration', score: rb.concentrationRisk },
    { name: 'Collateral', score: rb.collateral },
    { name: 'Tenor', score: rb.tenor },
  ] : [];

  const approvedCount = data.tierDecisions.filter(
    (td) => td.decision === 'APPROVED',
  ).length;

  const needsReviewSummary = data.currentTier !== 'AUTO';
  const reviewSummaryMissing =
    needsReviewSummary && reviewSummary.trim().length < 30;

  async function handleApprove(): Promise<void> {
    if (reason.length < COMMENT_MIN_LENGTH) {
      toast.error(`Comments must be at least ${COMMENT_MIN_LENGTH} characters`);
      return;
    }
    if (reviewSummaryMissing) {
      toast.error('Review summary must be at least 30 characters for this tier');
      return;
    }
    try {
      await approve.mutateAsync({ invoiceId: id!, reason, reviewSummary });
      navigate('/approvals');
    } catch (err) { toast.error(parseApiError(err)); }
  }

  async function handleReject(): Promise<void> {
    if (reason.length < COMMENT_MIN_LENGTH) {
      toast.error(`Reason must be at least ${COMMENT_MIN_LENGTH} characters`);
      return;
    }
    if (reviewSummaryMissing) {
      toast.error('Review summary must be at least 30 characters for this tier');
      return;
    }
    try {
      await reject.mutateAsync({ invoiceId: id!, reason, reviewSummary });
      navigate('/approvals');
    } catch (err) { toast.error(parseApiError(err)); }
  }

  async function handleRequestInfo(): Promise<void> {
    if (infoMsg.length < 10) { toast.error('Message must be at least 10 characters'); return; }
    try {
      await reqInfo.mutateAsync({ invoiceId: id!, message: infoMsg });
      setInfoMsg('');
      toast.success('Information request sent');
    } catch (err) { toast.error(parseApiError(err)); }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" onClick={() => navigate('/approvals')}>
          <ArrowLeft className="size-4" />
        </Button>
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold font-mono">{inv.invoiceNumber}</h1>
            <ApprovalTierBadge
              tier={data.currentTier}
              approvalsReceived={approvedCount}
              approvalsRequired={data.currentTier === 'TIER_3' ? 2 : data.currentTier === 'TIER_4' ? 3 : 1}
            />
            {data.currentTier === 'AUTO' && (
              <Badge variant="secondary">Auto-approved by System</Badge>
            )}
            {inv.riskLevel && <RiskBadge level={inv.riskLevel} />}
            <SlaCountdown startedAt={data.submittedAt} slaHours={48} />
          </div>
          <div className="flex items-center gap-4">
            <p className="text-sm text-muted-foreground">{data.daysInQueue}d in queue</p>
            {data.currentTier === 'TIER_3' && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <span>{approvedCount} of 2 approvals received</span>
                <Progress value={(approvedCount / 2) * 100} className="h-2 w-24" />
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Invoice summary */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Face Value</p><AmountDisplay value={inv.faceValue} className="text-lg font-bold" /></CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Supplier</p><p className="text-sm font-medium">{inv.supplierName}</p></CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Buyer</p><p className="text-sm font-medium">{inv.buyerName}</p></CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Due Date</p><p className="text-sm font-medium">{formatDate(inv.dueDate)}</p></CardContent></Card>
      </div>

      {/* Contact info — supplier + buyer */}
      {(inv.supplierInfo || inv.buyerInfo) && (
        <div className="grid gap-4 md:grid-cols-2">
          {inv.supplierInfo && (
            <Card>
              <CardHeader><CardTitle className="text-base">Supplier contact</CardTitle></CardHeader>
              <CardContent className="space-y-1 p-4 pt-0">
                <p className="text-xs text-muted-foreground">Email</p>
                <p className="text-sm font-medium">{inv.supplierInfo.contactEmail || '—'}</p>
                <p className="text-xs text-muted-foreground mt-2">Phone</p>
                <p className="text-sm font-medium">{inv.supplierInfo.contactPhone || '—'}</p>
              </CardContent>
            </Card>
          )}
          {inv.buyerInfo && (
            <Card>
              <CardHeader><CardTitle className="text-base">Buyer contact</CardTitle></CardHeader>
              <CardContent className="space-y-1 p-4 pt-0">
                <p className="text-xs text-muted-foreground">Email</p>
                <p className="text-sm font-medium">{inv.buyerInfo.contactEmail || '—'}</p>
                <p className="text-xs text-muted-foreground mt-2">Phone</p>
                <p className="text-sm font-medium">{inv.buyerInfo.contactPhone || '—'}</p>
              </CardContent>
            </Card>
          )}
        </div>
      )}

      <div className="grid gap-6 md:grid-cols-2">
        {/* Risk breakdown chart */}
        {chartData.length > 0 && (
          <Card>
            <CardHeader><CardTitle className="text-base">Risk Breakdown (Score: {rb?.composite.toFixed(1)})</CardTitle></CardHeader>
            <CardContent>
              <div className="h-52">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chartData} layout="vertical" margin={{ left: 80 }}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis type="number" domain={[0, 100]} />
                    <YAxis type="category" dataKey="name" className="text-xs" />
                    <Tooltip formatter={(v) => `${Number(v).toFixed(1)}/100`} />
                    <Bar dataKey="score" fill="hsl(var(--chart-1))" radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <RiskScoreRadar
                factors={[
                  { name: 'Buyer Credit', score: rb?.buyerCredit ?? 0, weight: 0.30 },
                  { name: 'Supplier Track', score: rb?.supplierTrackRecord ?? 0, weight: 0.25 },
                  { name: 'Collateral', score: rb?.collateral ?? 0, weight: 0.20 },
                  { name: 'Concentration', score: rb?.concentrationRisk ?? 0, weight: 0.15 },
                  { name: 'Tenor', score: rb?.tenor ?? 0, weight: 0.10 },
                ]}
                compositeScore={rb?.composite ?? 0}
                className="mt-4"
              />
            </CardContent>
          </Card>
        )}

        {/* Tier decisions */}
        <Card>
          <CardHeader><CardTitle className="text-base">Tier Decisions</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {data.tierDecisions.map((td) => (
              <div key={td.tier} className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium">
                    {TIER_LABELS[td.tier] ?? td.tierLabel}
                  </p>
                  {td.tier === 'AUTO' ? (
                    <p className="text-xs text-muted-foreground">System</p>
                  ) : (
                    td.actorName && <p className="text-xs text-muted-foreground">{td.actorName} ({td.actorRole})</p>
                  )}
                </div>
                {td.decision ? (
                  <Badge variant="outline" className={td.decision === 'APPROVED' ? 'text-green-700' : td.decision === 'REJECTED' ? 'text-red-700' : 'text-amber-700'}>
                    {td.decision}
                  </Badge>
                ) : (
                  <Badge variant="outline" className="text-muted-foreground">Pending</Badge>
                )}
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      {/* Decision actions */}
      {data.status.toLowerCase() === 'pending' && (
        <Card>
          <CardHeader><CardTitle className="text-base">Your Decision</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            {needsReviewSummary && (
              <div>
                <label className="text-sm font-medium">
                  Case summary (required, min 30 chars)
                </label>
                <Textarea
                  value={reviewSummary}
                  onChange={(e) => setReviewSummary(e.target.value)}
                  placeholder="Summarise the request, the key risk factors you considered, and the rationale for your decision."
                  rows={4}
                  className="mt-1"
                />
                <p className="text-xs text-muted-foreground mt-1">
                  {reviewSummary.trim().length < 30
                    ? `${30 - reviewSummary.trim().length} characters to minimum`
                    : 'Long enough — will be stored on the approval record for audit.'}
                </p>
              </div>
            )}
            <div>
              <label className="text-sm font-medium">Reason / Comments</label>
              <Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Enter your reasoning (required for reject, optional for approve)..." rows={3} className="mt-1" />
            </div>
            <div className="flex gap-3">
              <Button onClick={() => setShowApprove(true)} className="bg-green-600 hover:bg-green-700">
                <Check className="mr-2 size-4" /> Approve
              </Button>
              <Button variant="destructive" onClick={() => setShowReject(true)}>
                <X className="mr-2 size-4" /> Reject
              </Button>
              <Button variant="outline" onClick={handleRequestInfo} disabled={reqInfo.isPending || infoMsg.length < 10 && reason.length < 10}>
                {reqInfo.isPending ? <Loader2 className="mr-2 size-4 animate-spin" /> : <MessageSquare className="mr-2 size-4" />}
                Request Info
              </Button>
            </div>

            <Separator />
            <div>
              <label className="text-sm font-medium">Quick message to supplier</label>
              <Textarea value={infoMsg} onChange={(e) => setInfoMsg(e.target.value)} placeholder="Ask for additional documentation..." rows={2} className="mt-1" />
            </div>
          </CardContent>
        </Card>
      )}

      <ConfirmationDialog open={showApprove} onOpenChange={setShowApprove} title="Approve Invoice" description={`Approve ${inv.invoiceNumber} for ${inv.faceValue ? `UGX ${String(inv.faceValue)}` : ''}? This will advance the invoice to the payment authorization queue.`} confirmLabel="Approve" onConfirm={handleApprove} isLoading={approve.isPending} />
      <ConfirmationDialog open={showReject} onOpenChange={setShowReject} title="Reject Invoice" description="This action cannot be undone. The supplier will be notified." confirmLabel="Reject" onConfirm={handleReject} isLoading={reject.isPending} destructive />
    </div>
  );
}

export default ApprovalReviewPage;
