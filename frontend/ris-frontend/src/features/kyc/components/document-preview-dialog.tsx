/**
 * On-screen preview for KYC/compliance review.
 *
 * Fetches the actual encrypted file from the backend, decrypts on the
 * server, and renders the real bytes inline. PDFs render in an iframe;
 * images render via <img>; anything else falls back to a download link.
 *
 * Auth-gated end-to-end — apiClient attaches the bearer token and the
 * backend re-checks supplier ownership before streaming bytes. The blob
 * URL is cleaned up on unmount and whenever the documentId changes so we
 * don't leak object URLs across previews.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Skeleton } from '@/components/ui/skeleton';
import { Download, X, FileText, AlertCircle } from 'lucide-react';
import { formatAbsolute } from '@/lib/format-date';
import { useKycDocumentFile } from '../hooks/use-kyc';
import { apiClient } from '@/lib/axios';
import { buildKycDocumentFileUrl } from '../api/kyc.api';
import { useInvoiceDocumentFile } from '@/features/invoices/hooks/use-invoices';
import { buildInvoiceDocumentFileUrl } from '@/features/invoices/api/invoices.api';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * Supplier scope for the file fetch. Used by the KYC route
   * `/onboarding/suppliers/:supplierId/documents/:docId/file`. Pass empty
   * string and provide `invoiceId` instead for invoice-attached documents,
   * which fetch from `/invoices/:invoiceId/documents/:docId/file`.
   */
  supplierId: string;
  /**
   * Invoice scope for the file fetch. When set (and supplierId is empty),
   * the dialog uses the invoice document streaming endpoint. Both routes
   * decrypt server-side and stream inline.
   */
  invoiceId?: string;
  documentId: string;
  documentType: string;
  fileName: string;
  uploadedAt: string;
  status: string;
  /** No longer used — kept optional for compat with existing call sites. */
  supplierCompany?: string;
}

type PreviewKind = 'pdf' | 'image' | 'other';

function inferPreviewKind(blob: Blob, fileName: string): PreviewKind {
  const mime = blob.type.toLowerCase();
  if (mime === 'application/pdf') return 'pdf';
  if (mime.startsWith('image/')) return 'image';

  // Fallback: some servers/proxies strip the Content-Type — guess by extension.
  const ext = fileName.toLowerCase().split('.').pop() ?? '';
  if (ext === 'pdf') return 'pdf';
  if (['png', 'jpg', 'jpeg', 'webp', 'gif'].includes(ext)) return 'image';
  return 'other';
}

interface PreviewBodyProps {
  open: boolean;
  supplierId: string;
  invoiceId?: string;
  documentId: string;
  fileName: string;
}

function PreviewBody({
  open,
  supplierId,
  invoiceId,
  documentId,
  fileName,
}: PreviewBodyProps): React.ReactElement {
  // Pick the right streaming endpoint based on which scope the caller
  // provided. Both backends decrypt server-side; the dialog only differs
  // in URL. Hooks must be called unconditionally — both useQuery hooks run
  // every render, but only one is enabled at a time.
  const kycEnabled = open && !!supplierId;
  const invoiceEnabled = open && !supplierId && !!invoiceId;

  const kycQuery = useKycDocumentFile(supplierId, documentId, { enabled: kycEnabled });
  const invoiceQuery = useInvoiceDocumentFile(invoiceId ?? '', documentId, {
    enabled: invoiceEnabled,
  });

  const active = kycEnabled ? kycQuery : invoiceQuery;
  const { data: blob, isLoading, isError, error, refetch } = active;

  // Manage the object URL lifecycle ourselves: create on blob change, revoke
  // on cleanup. We derive the URL synchronously via useMemo so it's ready on
  // the first render that has the blob (no extra render cycle), and use an
  // effect ONLY for revocation. This avoids the "setState in effect" smell
  // while still guaranteeing every URL.createObjectURL is paired with a
  // revoke when the blob changes or the component unmounts.
  const blobUrl = useMemo(() => (blob ? URL.createObjectURL(blob) : null), [blob]);
  // Hold the latest URL in a ref so the cleanup effect can revoke without
  // capturing a stale closure. The cleanup runs when blobUrl changes (i.e.
  // a different document was loaded) or on unmount.
  const blobUrlRef = useRef<string | null>(null);
  useEffect(() => {
    blobUrlRef.current = blobUrl;
    return () => {
      if (blobUrlRef.current) {
        URL.revokeObjectURL(blobUrlRef.current);
        blobUrlRef.current = null;
      }
    };
  }, [blobUrl]);

  const previewKind = useMemo(
    () => (blob ? inferPreviewKind(blob, fileName) : 'other'),
    [blob, fileName],
  );

  if (isLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-[60vh] w-full rounded border" />
        <p className="text-center text-xs text-muted-foreground">Loading document...</p>
      </div>
    );
  }

  if (isError) {
    const detail =
      error instanceof Error ? error.message : 'Could not load this document.';
    return (
      <Alert variant="destructive">
        <AlertCircle className="size-4" />
        <AlertDescription className="flex flex-col gap-2">
          <span>Failed to load document. {detail}</span>
          <Button
            variant="outline"
            size="sm"
            className="w-fit"
            onClick={() => {
              void refetch();
            }}
          >
            Retry
          </Button>
        </AlertDescription>
      </Alert>
    );
  }

  if (!blobUrl) {
    // No streaming endpoint at all — neither supplierId (KYC) nor invoiceId
    // (invoice docs) was provided by the caller. Distinct from "fetch failed",
    // which is handled above by isError.
    if (!supplierId && !invoiceId) {
      return (
        <div className="flex flex-col items-center gap-3 rounded border bg-muted/10 p-8 text-center">
          <FileText className="size-12 text-muted-foreground" />
          <p className="text-sm">
            Inline preview is not yet available for this document type.
          </p>
        </div>
      );
    }
    return (
      <p className="text-center text-sm text-muted-foreground">
        Document not available.
      </p>
    );
  }

  if (previewKind === 'pdf') {
    return (
      <div className="flex flex-col gap-2">
        {/*
          We render PDFs in two layers:
            1. An <object> with PDF MIME-type — uses the OS / browser native
               PDF plugin (Chrome PDF viewer, Edge PDF viewer, etc.). Most
               capable: zoom, search, page nav, text-select, signature.
            2. <iframe> fallback inside <object> for browsers that don't
               support the embedded plugin path (rare on desktop, common
               on some mobile browsers).
          Both load the same blob URL so we don't re-fetch.
        */}
        <object
          data={blobUrl}
          type="application/pdf"
          className="h-[68vh] w-full rounded border bg-muted/10"
          aria-label={`Preview of ${fileName}`}
        >
          <iframe
            src={blobUrl}
            className="h-[68vh] w-full rounded border bg-muted/10"
            title={fileName}
          />
        </object>
        {/*
          Belt-and-braces fallback: if the embedded viewer renders blank
          (zero-page PDF, browser plugin disabled, malformed file), the
          reviewer can click here and read the original in a new tab via
          the OS PDF reader. The blob: URL is local-page-scoped so the
          new tab will see the same bytes — no extra round-trip.
        */}
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>If the preview is blank, the source PDF may have no rendered pages.</span>
          <a
            href={blobUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="underline hover:text-primary font-medium"
          >
            Open in new tab
          </a>
        </div>
      </div>
    );
  }

  if (previewKind === 'image') {
    return (
      <div className="flex flex-col items-center gap-2">
        <img
          src={blobUrl}
          alt={fileName}
          className="max-h-[70vh] rounded border bg-muted/10"
        />
        <a
          href={blobUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs text-muted-foreground underline hover:text-primary"
        >
          Open full size in new tab
        </a>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center gap-3 rounded border bg-muted/10 p-8 text-center">
      <FileText className="size-12 text-muted-foreground" />
      <p className="text-sm">Preview not available for this file type.</p>
      <Button asChild variant="outline" size="sm">
        <a href={blobUrl} download={fileName}>
          <Download className="mr-2 size-4" />
          Download {fileName}
        </a>
      </Button>
    </div>
  );
}

/**
 * Force-download via authenticated fetch. We can't `<a href={apiUrl}>` because
 * the bearer token lives in axios interceptors / memory — a plain anchor would
 * skip auth and 401. So we re-use the cached blob if we have it, otherwise
 * fetch fresh. Routes to the KYC or invoice endpoint based on which scope
 * was provided.
 */
async function triggerDownload(
  supplierId: string,
  invoiceId: string | undefined,
  documentId: string,
  fileName: string,
): Promise<void> {
  const url = supplierId
    ? buildKycDocumentFileUrl(supplierId, documentId)
    : buildInvoiceDocumentFileUrl(invoiceId ?? '', documentId);
  const { data } = await apiClient.get<Blob>(url, { responseType: 'blob' });
  const objectUrl = URL.createObjectURL(data);
  const a = document.createElement('a');
  a.href = objectUrl;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(objectUrl);
}

export function DocumentPreviewDialog(props: Props): React.ReactElement {
  const {
    open, onOpenChange, supplierId, invoiceId, documentId,
    fileName, uploadedAt, status,
  } = props;

  const [downloading, setDownloading] = useState(false);
  const canDownload = !!supplierId || !!invoiceId;

  async function handleDownload(): Promise<void> {
    setDownloading(true);
    try {
      await triggerDownload(supplierId, invoiceId, documentId, fileName);
    } finally {
      setDownloading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="size-5" />
            {fileName}
          </DialogTitle>
          <DialogDescription className="flex items-center gap-3 text-xs">
            <span>Uploaded {formatAbsolute(uploadedAt)}</span>
            <Badge variant="outline" className="capitalize">
              {status}
            </Badge>
          </DialogDescription>
        </DialogHeader>

        <div className="py-4">
          <PreviewBody
            open={open}
            supplierId={supplierId}
            invoiceId={invoiceId}
            documentId={documentId}
            fileName={fileName}
          />
        </div>

        <div className="flex justify-end gap-2 border-t pt-4">
          {/* Download is only wired when we have a known scope (KYC supplier
              or invoice). Without one there's no streaming endpoint to call. */}
          {canDownload && (
            <Button
              variant="outline"
              onClick={() => {
                void handleDownload();
              }}
              disabled={downloading}
            >
              <Download className="mr-2 size-4" />
              {downloading ? 'Downloading...' : 'Download original'}
            </Button>
          )}
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            <X className="mr-2 size-4" />
            Close
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
