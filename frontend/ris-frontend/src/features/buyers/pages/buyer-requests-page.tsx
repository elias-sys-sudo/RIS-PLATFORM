import { useState } from 'react';
import { Loader2, UserPlus, MessageSquare } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';

import {
  useBuyerRequests,
  useReviewBuyerRequest,
} from '../hooks/use-buyer-requests';
import type {
  BuyerOnboardingRequest,
  BuyerRequestStatus,
} from '@/types/buyer-request.types';

// ── Status filter type (includes 'all') ─────────────────────────────────────

type StatusFilter = BuyerRequestStatus | 'all';

// ── Status badge mapping ────────────────────────────────────────────────────

const STATUS_VARIANT: Record<BuyerRequestStatus, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  pending: 'outline',
  in_review: 'secondary',
  approved: 'default',
  rejected: 'destructive',
};

const STATUS_LABEL: Record<BuyerRequestStatus, string> = {
  pending: 'Pending',
  in_review: 'In Review',
  approved: 'Approved',
  rejected: 'Rejected',
};

// ── Page component ──────────────────────────────────────────────────────────

export function BuyerRequestsPage(): React.ReactElement {
  const [tab, setTab] = useState<StatusFilter>('all');
  const [reviewTarget, setReviewTarget] = useState<BuyerOnboardingRequest | null>(null);

  const queryStatus = tab === 'all' ? undefined : tab;
  const { data, isPending, isError } = useBuyerRequests(queryStatus);
  const requests = data?.data ?? [];

  if (isPending) return <PageSkeleton />;
  if (isError) return <ErrorState />;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <UserPlus className="size-6" />
        <h1 className="text-2xl font-bold font-display">Buyer Onboarding Requests</h1>
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(v as StatusFilter)}>
        <TabsList>
          <TabsTrigger value="all">All</TabsTrigger>
          <TabsTrigger value="pending">Pending</TabsTrigger>
          <TabsTrigger value="in_review">In Review</TabsTrigger>
          <TabsTrigger value="approved">Approved</TabsTrigger>
          <TabsTrigger value="rejected">Rejected</TabsTrigger>
        </TabsList>
      </Tabs>

      {requests.length === 0 ? (
        <EmptyState tab={tab} />
      ) : (
        <RequestsTable
          requests={requests}
          onReview={setReviewTarget}
        />
      )}

      {reviewTarget && (
        <ReviewDialog
          request={reviewTarget}
          open={!!reviewTarget}
          onOpenChange={(open) => {
            if (!open) setReviewTarget(null);
          }}
        />
      )}
    </div>
  );
}

export default BuyerRequestsPage;

// ── Requests table ──────────────────────────────────────────────────────────

function RequestsTable({
  requests,
  onReview,
}: {
  requests: BuyerOnboardingRequest[];
  onReview: (r: BuyerOnboardingRequest) => void;
}): React.ReactElement {
  return (
    <Card>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Company Name</TableHead>
              <TableHead>Reason</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Date</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {requests.map((r) => (
              <RequestRow key={r.id} request={r} onReview={onReview} />
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

function RequestRow({
  request,
  onReview,
}: {
  request: BuyerOnboardingRequest;
  onReview: (r: BuyerOnboardingRequest) => void;
}): React.ReactElement {
  const canReview = request.status === 'pending' || request.status === 'in_review';
  return (
    <TableRow>
      <TableCell className="font-medium">{request.companyName}</TableCell>
      <TableCell className="max-w-xs truncate" title={request.reason}>
        {request.reason}
      </TableCell>
      <TableCell>
        <Badge variant={STATUS_VARIANT[request.status]}>
          {STATUS_LABEL[request.status]}
        </Badge>
      </TableCell>
      <TableCell className="whitespace-nowrap">
        {formatDate(request.createdAt)}
      </TableCell>
      <TableCell className="text-right">
        {canReview && (
          <Button size="sm" variant="outline" onClick={() => onReview(request)}>
            <MessageSquare className="mr-1.5 size-3.5" />
            Review
          </Button>
        )}
      </TableCell>
    </TableRow>
  );
}

// ── Review dialog ───────────────────────────────────────────────────────────

function ReviewDialog({
  request,
  open,
  onOpenChange,
}: {
  request: BuyerOnboardingRequest;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}): React.ReactElement {
  const [comments, setComments] = useState('');
  const mutation = useReviewBuyerRequest();

  function handleDecision(status: 'approved' | 'rejected'): void {
    mutation.mutate(
      {
        id: request.id,
        payload: {
          status,
          reviewer_comments: comments || undefined,
        },
      },
      { onSuccess: () => onOpenChange(false) },
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Review Buyer Request</DialogTitle>
          <DialogDescription>
            Review the request to onboard {request.companyName}.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 text-sm">
          <DetailRow label="Company" value={request.companyName} />
          <DetailRow
            label="Registration #"
            value={request.registrationNumber ?? '—'}
          />
          <DetailRow label="Contact" value={request.contactName ?? '—'} />
          <DetailRow label="Email" value={request.contactEmail ?? '—'} />
          <DetailRow label="Phone" value={request.contactPhone ?? '—'} />
          <DetailRow label="Reason" value={request.reason} />
        </div>

        <div className="space-y-2 pt-2">
          <label htmlFor="reviewer-comments" className="text-sm font-medium">
            Comments (optional)
          </label>
          <Textarea
            id="reviewer-comments"
            value={comments}
            onChange={(e) => setComments(e.target.value)}
            placeholder="Add notes about your decision..."
            rows={3}
          />
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Button
            variant="destructive"
            disabled={mutation.isPending}
            onClick={() => handleDecision('rejected')}
          >
            {mutation.isPending && (
              <Loader2 className="mr-2 size-4 animate-spin" />
            )}
            Reject
          </Button>
          <Button
            disabled={mutation.isPending}
            onClick={() => handleDecision('approved')}
          >
            {mutation.isPending && (
              <Loader2 className="mr-2 size-4 animate-spin" />
            )}
            Approve
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Shared helpers ──────────────────────────────────────────────────────────

function DetailRow({
  label,
  value,
}: {
  label: string;
  value: string;
}): React.ReactElement {
  return (
    <div className="flex justify-between gap-4">
      <span className="text-muted-foreground shrink-0">{label}</span>
      <span className="text-right">{value}</span>
    </div>
  );
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('en-UG', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

function EmptyState({ tab }: { tab: StatusFilter }): React.ReactElement {
  const suffix = tab === 'all' ? '' : ` with status "${STATUS_LABEL[tab as BuyerRequestStatus]}"`;
  return (
    <Card>
      <CardHeader className="items-center py-12">
        <UserPlus className="size-10 text-muted-foreground mb-3" />
        <CardTitle className="text-base font-normal text-muted-foreground">
          No buyer onboarding requests{suffix}
        </CardTitle>
      </CardHeader>
    </Card>
  );
}

function PageSkeleton(): React.ReactElement {
  return (
    <div className="space-y-6">
      <Skeleton className="h-8 w-64" />
      <Skeleton className="h-10 w-96" />
      <Skeleton className="h-64 w-full" />
    </div>
  );
}

function ErrorState(): React.ReactElement {
  return (
    <Card>
      <CardHeader className="items-center py-12">
        <CardTitle className="text-base font-normal text-destructive">
          Failed to load buyer requests. Please try again.
        </CardTitle>
      </CardHeader>
    </Card>
  );
}
