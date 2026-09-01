import React, { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, CheckCircle2, XCircle, Clock, FileText, AlertCircle, Eye } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { cn } from '@/lib/cn';
import { useKycStatus, useReviewKycDocument } from '../hooks/use-kyc';
import type { KycDocument, KycDocStatus, KycOverallStatus } from '../api/kyc.api';
import { SupplierFeedbackSection } from '../components/supplier-feedback-section';
import { DocumentCommentsSection } from '../components/document-comments-section';
import { DocumentPreviewDialog } from '../components/document-preview-dialog';
import { useAuthStore } from '@/store/auth.store';

/**
 * Backend allows these roles to post feedback on a supplier. Keep in sync
 * with the route guard in src/services/onboarding/onboarding.routes.ts.
 */
const FEEDBACK_WRITE_ROLES = new Set(['credit_officer', 'compliance_officer', 'management']);

// ── Constants ───────────────────────────────────────────────────────────────

const DOC_TYPE_LABELS: Record<string, string> = {
  certificate_of_incorporation: 'Certificate of Incorporation',
  tax_registration: 'Tax Registration Certificate',
  board_resolution: 'Board Resolution / Authorization Letter',
  id_document: 'Director ID Document',
};

const MIN_REJECT_COMMENT_LENGTH = 20;

// ── Status helpers ──────────────────────────────────────────────────────────

const DOC_STATUS_CONFIG: Record<KycDocStatus, { icon: typeof CheckCircle2; className: string; label: string }> = {
  pending:  { icon: Clock,        className: 'text-amber-600',  label: 'Pending Review' },
  approved: { icon: CheckCircle2, className: 'text-green-600',  label: 'Approved' },
  rejected: { icon: XCircle,      className: 'text-red-600',    label: 'Rejected' },
};

const OVERALL_STATUS_STYLE: Record<KycOverallStatus, string> = {
  pending:     'bg-gray-100 text-gray-700 border-gray-200',
  in_progress: 'bg-blue-50 text-blue-700 border-blue-200',
  approved:    'bg-green-50 text-green-700 border-green-200',
  rejected:    'bg-red-50 text-red-700 border-red-200',
};

// ── Document review card ────────────────────────────────────────────────────

interface DocumentReviewCardProps {
  document: KycDocument;
  supplierId: string;
  onApprove: (docId: string) => void;
  onReject: (docId: string) => void;
  isReviewing: boolean;
  supplierCompany?: string;
}

function DocumentReviewCard({
  document,
  supplierId,
  onApprove,
  onReject,
  isReviewing,
  supplierCompany,
}: DocumentReviewCardProps): React.ReactElement {
  const statusConfig = DOC_STATUS_CONFIG[document.status];
  const StatusIcon = statusConfig.icon;
  const [previewOpen, setPreviewOpen] = useState(false);

  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-start justify-between">
          <div className="space-y-1.5">
            <div className="flex items-center gap-2">
              <FileText className="size-4 text-muted-foreground" />
              <p className="text-sm font-medium">
                {DOC_TYPE_LABELS[document.type] ?? document.type}
              </p>
            </div>
            <p className="text-xs text-muted-foreground">
              {document.fileName}
            </p>
            <p className="text-xs text-muted-foreground">
              Uploaded: {new Date(document.uploadedAt).toLocaleDateString('en-UG')}
            </p>
            <span className={cn('flex items-center gap-1 text-xs', statusConfig.className)}>
              <StatusIcon className="size-3.5" />
              {statusConfig.label}
            </span>
            {document.reviewerComments && (
              <p className="mt-1 text-xs text-muted-foreground italic">
                Reviewer note: {document.reviewerComments}
              </p>
            )}
          </div>

          <div className="flex flex-col items-end gap-2">
            {/* View — always available for any document, irrespective of status */}
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPreviewOpen(true)}
            >
              <Eye className="mr-1.5 size-3.5" />
              View
            </Button>

            {document.status === 'pending' && (
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={isReviewing}
                  onClick={() => onApprove(document.id)}
                  className="text-green-700 hover:bg-green-50"
                >
                  <CheckCircle2 className="mr-1.5 size-3.5" />
                  Approve
                </Button>
                <Button
                  variant="destructive"
                  size="sm"
                  disabled={isReviewing}
                  onClick={() => onReject(document.id)}
                >
                  <XCircle className="mr-1.5 size-3.5" />
                  Reject
                </Button>
              </div>
            )}
          </div>
        </div>

        {/* Checkers §5a — per-document comment thread. Same backend endpoint as
            the supplier-side view, so the supplier and staff see each other's
            comments in real time. */}
        <DocumentCommentsSection documentId={document.id} />

        <DocumentPreviewDialog
          open={previewOpen}
          onOpenChange={setPreviewOpen}
          supplierId={supplierId}
          documentId={document.id}
          documentType={document.type}
          fileName={document.fileName}
          uploadedAt={document.uploadedAt}
          status={document.status}
          supplierCompany={supplierCompany}
        />
      </CardContent>
    </Card>
  );
}

// ── Main page ───────────────────────────────────────────────────────────────

export function KycReviewPage(): React.ReactElement {
  const { id: supplierId } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const resolvedSupplierId = supplierId ?? '';

  const role = useAuthStore((s) => s.role);
  const canWriteFeedback = role ? FEEDBACK_WRITE_ROLES.has(role) : false;

  const { data: kycStatus, isLoading, isError } = useKycStatus(resolvedSupplierId);
  const reviewMutation = useReviewKycDocument(resolvedSupplierId);

  const [rejectDialogOpen, setRejectDialogOpen] = useState(false);
  const [rejectDocId, setRejectDocId] = useState<string | null>(null);
  const [rejectComments, setRejectComments] = useState('');

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (isError || !kycStatus) {
    return (
      <Alert variant="destructive">
        <AlertCircle className="size-4" />
        <AlertDescription>Failed to load KYC documents. Please try again.</AlertDescription>
      </Alert>
    );
  }

  function handleApprove(documentId: string): void {
    reviewMutation.mutate({
      documentId,
      decision: 'approved',
      comments: '',
    });
  }

  function openRejectDialog(documentId: string): void {
    setRejectDocId(documentId);
    setRejectComments('');
    setRejectDialogOpen(true);
  }

  function handleRejectConfirm(): void {
    if (!rejectDocId) return;
    if (rejectComments.trim().length < MIN_REJECT_COMMENT_LENGTH) return;

    reviewMutation.mutate(
      {
        documentId: rejectDocId,
        decision: 'rejected',
        comments: rejectComments.trim(),
      },
      {
        onSuccess: () => {
          setRejectDialogOpen(false);
          setRejectDocId(null);
          setRejectComments('');
        },
      },
    );
  }

  const documents = kycStatus.documents;
  const pendingCount = documents.filter((d) => d.status === 'pending').length;
  const approvedCount = documents.filter((d) => d.status === 'approved').length;
  const rejectedCount = documents.filter((d) => d.status === 'rejected').length;

  const overallStyle = OVERALL_STATUS_STYLE[kycStatus.overallStatus];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
          <ArrowLeft className="size-4" />
        </Button>
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold font-display">KYC Review</h1>
            <Badge variant="outline" className={cn('text-xs font-medium capitalize', overallStyle)}>
              {kycStatus.overallStatus.replace('_', ' ')}
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground">
            Supplier ID: {resolvedSupplierId}
          </p>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardContent className="p-4 text-center">
            <p className="text-xs text-muted-foreground">Pending</p>
            <p className="text-2xl font-bold text-amber-600">{pendingCount}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <p className="text-xs text-muted-foreground">Approved</p>
            <p className="text-2xl font-bold text-green-600">{approvedCount}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <p className="text-xs text-muted-foreground">Rejected</p>
            <p className="text-2xl font-bold text-red-600">{rejectedCount}</p>
          </CardContent>
        </Card>
      </div>

      {/* Checkers §5b — free-text feedback channel. Visible only to roles the
          backend accepts POSTs from; read-only roles (finance_manager, auditor, legal)
          can still see the KYC review page for context. */}
      {canWriteFeedback && <SupplierFeedbackSection supplierId={resolvedSupplierId} />}

      {/* Document list */}
      {documents.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            No documents have been uploaded by this supplier yet.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          <h2 className="text-base font-semibold">Uploaded Documents</h2>
          {documents.map((doc) => (
            <DocumentReviewCard
              key={doc.id}
              document={doc}
              supplierId={resolvedSupplierId}
              onApprove={handleApprove}
              onReject={openRejectDialog}
              isReviewing={reviewMutation.isPending}
            />
          ))}
        </div>
      )}

      {/* Reject dialog */}
      <Dialog open={rejectDialogOpen} onOpenChange={setRejectDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reject Document</DialogTitle>
            <DialogDescription>
              Please provide a reason for rejecting this document.
              The supplier will see these comments.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Textarea
              placeholder="Enter rejection reason (minimum 20 characters)..."
              value={rejectComments}
              onChange={(e) => setRejectComments(e.target.value)}
              rows={4}
              aria-label="Rejection reason"
            />
            {rejectComments.length > 0 && rejectComments.trim().length < MIN_REJECT_COMMENT_LENGTH && (
              <p className="text-xs text-red-600">
                Please enter at least {MIN_REJECT_COMMENT_LENGTH} characters
                ({rejectComments.trim().length}/{MIN_REJECT_COMMENT_LENGTH}).
              </p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejectDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={
                rejectComments.trim().length < MIN_REJECT_COMMENT_LENGTH ||
                reviewMutation.isPending
              }
              onClick={handleRejectConfirm}
            >
              Confirm Rejection
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default KycReviewPage;
