import React, { useRef, useState } from 'react';
import { FileUp, CheckCircle2, Clock, XCircle, AlertCircle, Plus, Eye } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { cn } from '@/lib/cn';
import { useAuthStore } from '@/store/auth.store';
import { useKycStatus, useUploadKycDocument } from '../hooks/use-kyc';
import type { KycDocumentType, KycDocStatus, KycOverallStatus, KycDocument } from '../api/kyc.api';
import { DocumentCommentsSection } from '../components/document-comments-section';
import { DocumentPreviewDialog } from '../components/document-preview-dialog';

// ── Constants ───────────────────────────────────────────────────────────────

const REQUIRED_DOCUMENT_TYPES: {
  type: KycDocumentType;
  label: string;
  description: string;
}[] = [
  {
    type: 'certificate_of_incorporation',
    label: 'Certificate of Incorporation',
    description: 'Valid and current company registration certificate from URSB',
  },
  {
    type: 'directors_shareholders',
    label: 'Directors & Shareholders',
    description: 'Full list of directors and shareholders with IDs',
  },
  {
    type: 'tax_registration',
    label: 'Tax Registration (TIN)',
    description: 'TIN certificate from Uganda Revenue Authority',
  },
  {
    type: 'bank_account_details',
    label: 'Bank Account Details',
    description: 'Bank name, branch, and account number confirmation',
  },
  {
    type: 'supplier_agreement',
    label: 'Signed RIS Supplier Agreement',
    description: 'Executed supplier agreement — required before processing',
  },
  {
    type: 'board_resolution',
    label: 'Board Resolution / Authorization Letter',
    description: 'Board resolution authorizing invoice discounting',
  },
  {
    type: 'id_document',
    label: 'Director ID Document',
    description: 'National ID or passport of a company director',
  },
];

const ACCEPTED_FILE_TYPES = '.pdf,.jpg,.jpeg,.png';
const MAX_FILE_SIZE_MB = 10;
const MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024;

// ── Status badge helpers ────────────────────────────────────────────────────

const OVERALL_STATUS_CONFIG: Record<KycOverallStatus, { label: string; className: string }> = {
  pending:     { label: 'Pending',     className: 'bg-gray-100 text-gray-700 border-gray-200' },
  in_progress: { label: 'In Progress', className: 'bg-blue-50 text-blue-700 border-blue-200' },
  approved:    { label: 'Approved',    className: 'bg-green-50 text-green-700 border-green-200' },
  rejected:    { label: 'Rejected',    className: 'bg-red-50 text-red-700 border-red-200' },
};

const DOC_STATUS_CONFIG: Record<KycDocStatus, { icon: typeof CheckCircle2; className: string; label: string }> = {
  pending:  { icon: Clock,        className: 'text-amber-600',  label: 'Pending Review' },
  approved: { icon: CheckCircle2, className: 'text-green-600',  label: 'Approved' },
  rejected: { icon: XCircle,      className: 'text-red-600',    label: 'Rejected' },
};

function KycOverallStatusBadge({ status }: { status: KycOverallStatus }): React.ReactElement {
  const config = OVERALL_STATUS_CONFIG[status];
  return (
    <Badge variant="outline" className={cn('text-xs font-medium', config.className)}>
      {config.label}
    </Badge>
  );
}

// ── Document row ────────────────────────────────────────────────────────────

interface DocumentRowProps {
  docType: (typeof REQUIRED_DOCUMENT_TYPES)[number];
  document: KycDocument | undefined;
  supplierId: string;
  onUpload: (type: KycDocumentType, file: File) => void;
  isUploading: boolean;
}

function DocumentRow({ docType, document, supplierId, onUpload, isUploading }: DocumentRowProps): React.ReactElement {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [previewOpen, setPreviewOpen] = useState(false);

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>): void {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > MAX_FILE_SIZE_BYTES) {
      // Reset the input so the user can try again
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }

    onUpload(docType.type, file);
    // Reset the input after upload
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  const statusConfig = document ? DOC_STATUS_CONFIG[document.status] : null;
  const StatusIcon = statusConfig?.icon;

  return (
    <div className="flex items-center justify-between border-b py-4 last:border-0">
      <div className="flex-1 space-y-1">
        <div className="flex items-center gap-2">
          <p className="text-sm font-medium">{docType.label}</p>
          {statusConfig && StatusIcon && (
            <span className={cn('flex items-center gap-1 text-xs', statusConfig.className)}>
              <StatusIcon className="size-3.5" />
              {statusConfig.label}
            </span>
          )}
        </div>
        <p className="text-xs text-muted-foreground">{docType.description}</p>
        {document && (
          <p className="text-xs text-muted-foreground">
            {document.fileName} — uploaded {new Date(document.uploadedAt).toLocaleDateString('en-UG')}
          </p>
        )}
        {document?.status === 'rejected' && document.reviewerComments && (
          <Alert variant="destructive" className="mt-2">
            <AlertCircle className="size-4" />
            <AlertDescription className="text-xs">
              {document.reviewerComments}
            </AlertDescription>
          </Alert>
        )}
        {/* Checkers §5a — per-document comment thread, visible once the document is uploaded */}
        {document && <DocumentCommentsSection documentId={document.id} />}
      </div>
      <div className="flex flex-col items-end gap-2">
        {/* Suppliers can preview their uploaded document at any status — helpful
            when compliance requests clarification and they want to re-check what
            they submitted. Same preview dialog used on the staff review page. */}
        {document && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPreviewOpen(true)}
          >
            <Eye className="mr-1.5 size-3.5" />
            View
          </Button>
        )}
        {(!document || document.status === 'rejected') && (
          <>
            <input
              ref={fileInputRef}
              type="file"
              accept={ACCEPTED_FILE_TYPES}
              className="hidden"
              onChange={handleFileChange}
              aria-label={`Upload ${docType.label}`}
            />
            <Button
              variant="outline"
              size="sm"
              disabled={isUploading}
              onClick={() => fileInputRef.current?.click()}
            >
              <FileUp className="mr-1.5 size-3.5" />
              {document?.status === 'rejected' ? 'Re-upload' : 'Upload'}
            </Button>
          </>
        )}
      </div>

      {document && (
        <DocumentPreviewDialog
          open={previewOpen}
          onOpenChange={setPreviewOpen}
          supplierId={supplierId}
          documentId={document.id}
          documentType={document.type}
          fileName={document.fileName}
          uploadedAt={document.uploadedAt}
          status={document.status}
        />
      )}
    </div>
  );
}

// ── Additional documents card ──────────────────────────────────────────────

interface AdditionalDocumentsCardProps {
  documents: KycDocument[];
  supplierId: string;
  onUpload: (type: KycDocumentType, file: File) => void;
  isUploading: boolean;
}

function AdditionalDocumentsCard({
  documents,
  supplierId,
  onUpload,
  isUploading,
}: AdditionalDocumentsCardProps): React.ReactElement {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [_count] = useState(documents.length);

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>): void {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > MAX_FILE_SIZE_BYTES) {
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }
    onUpload('additional', file);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">Additional Documents</CardTitle>
          <>
            <input
              ref={fileInputRef}
              type="file"
              accept={ACCEPTED_FILE_TYPES}
              className="hidden"
              onChange={handleFileChange}
              aria-label="Upload additional document"
            />
            <Button
              variant="outline"
              size="sm"
              disabled={isUploading}
              onClick={() => fileInputRef.current?.click()}
            >
              <Plus className="mr-1.5 size-3.5" />
              Add Document
            </Button>
          </>
        </div>
        <p className="text-xs text-muted-foreground">
          Upload any additional documents as requested by the reviewer.
        </p>
      </CardHeader>
      {documents.length > 0 && (
        <CardContent className="pt-0">
          {documents.map((doc) => (
            <AdditionalDocumentRow key={doc.id} doc={doc} supplierId={supplierId} />
          ))}
        </CardContent>
      )}
    </Card>
  );
}

function AdditionalDocumentRow({
  doc,
  supplierId,
}: {
  doc: KycDocument;
  supplierId: string;
}): React.ReactElement {
  const [previewOpen, setPreviewOpen] = useState(false);
  const cfg = DOC_STATUS_CONFIG[doc.status];
  const Icon = cfg.icon;
  return (
    <div className="flex items-center justify-between border-b py-3 last:border-0">
      <div className="space-y-0.5 flex-1">
        <div className="flex items-center gap-2">
          <p className="text-sm font-medium">{doc.fileName}</p>
          <span className={cn('flex items-center gap-1 text-xs', cfg.className)}>
            <Icon className="size-3.5" />
            {cfg.label}
          </span>
        </div>
        <p className="text-xs text-muted-foreground">
          Uploaded {new Date(doc.uploadedAt).toLocaleDateString('en-UG')}
        </p>
        <DocumentCommentsSection documentId={doc.id} />
      </div>
      <Button
        variant="outline"
        size="sm"
        onClick={() => setPreviewOpen(true)}
      >
        <Eye className="mr-1.5 size-3.5" />
        View
      </Button>
      <DocumentPreviewDialog
        open={previewOpen}
        onOpenChange={setPreviewOpen}
        supplierId={supplierId}
        documentId={doc.id}
        documentType={doc.type}
        fileName={doc.fileName}
        uploadedAt={doc.uploadedAt}
        status={doc.status}
      />
    </div>
  );
}

// ── Main page ───────────────────────────────────────────────────────────────

export function KycDocumentsPage(): React.ReactElement {
  const user = useAuthStore((s) => s.user);
  const supplierId = user?.id ?? '';

  const { data: kycStatus, isLoading, isError } = useKycStatus(supplierId);
  const uploadMutation = useUploadKycDocument(supplierId);

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (isError) {
    return (
      <Alert variant="destructive">
        <AlertCircle className="size-4" />
        <AlertDescription>Failed to load KYC status. Please try again.</AlertDescription>
      </Alert>
    );
  }

  const documents = kycStatus?.documents ?? [];
  const requiredUploaded = documents.filter(
    (d) => REQUIRED_DOCUMENT_TYPES.some((r) => r.type === d.type),
  ).length;
  const totalRequired = REQUIRED_DOCUMENT_TYPES.length;
  const progressPercent = Math.round((requiredUploaded / totalRequired) * 100);
  const additionalDocs = documents.filter((d) => d.type === 'additional');

  function getDocumentForType(type: KycDocumentType): KycDocument | undefined {
    return documents.find((d) => d.type === type);
  }

  function handleUpload(type: KycDocumentType, file: File): void {
    uploadMutation.mutate({ type, file });
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold font-display">KYC Documents</h1>
          <p className="text-sm text-muted-foreground">
            Upload the required documents to complete your KYC verification.
          </p>
        </div>
        {kycStatus && <KycOverallStatusBadge status={kycStatus.overallStatus} />}
      </div>

      {/* Progress */}
      <Card>
        <CardContent className="p-4">
          <div className="flex items-center justify-between text-sm">
            <span className="font-medium">Upload Progress</span>
            <span className="text-muted-foreground">
              {requiredUploaded} of {totalRequired} documents uploaded
            </span>
          </div>
          <Progress value={progressPercent} className="mt-2" />
          <p className="text-xs text-muted-foreground mt-2">
            Typically reviewed within 1-2 business days
          </p>
        </CardContent>
      </Card>

      {/* Document checklist */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Required Documents</CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          {REQUIRED_DOCUMENT_TYPES.map((docType) => (
            <DocumentRow
              key={docType.type}
              docType={docType}
              document={getDocumentForType(docType.type)}
              supplierId={supplierId}
              onUpload={handleUpload}
              isUploading={uploadMutation.isPending}
            />
          ))}
        </CardContent>
      </Card>

      {/* Additional documents */}
      <AdditionalDocumentsCard
        documents={additionalDocs}
        supplierId={supplierId}
        onUpload={handleUpload}
        isUploading={uploadMutation.isPending}
      />

      {/* File requirements notice */}
      <p className="text-xs text-muted-foreground">
        Accepted formats: PDF, JPEG, PNG. Maximum file size: {MAX_FILE_SIZE_MB}MB.
      </p>
    </div>
  );
}

export default KycDocumentsPage;
