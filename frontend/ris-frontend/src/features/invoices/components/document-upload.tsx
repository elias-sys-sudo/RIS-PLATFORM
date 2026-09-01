import { useState, useRef } from 'react';
import { Upload, FileText, Loader2, Eye } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { DocumentPreviewDialog } from '@/components/display/document-preview-dialog';
import { apiClient } from '@/lib/axios';
import { parseApiError } from '@/lib/parse-api-error';
import type { InvoiceDocument } from '@/types/invoice.types';

// ─── Constants ────────────────────────────────────────────────────────────────

const DOC_TYPE_LABELS: Record<string, string> = {
  invoice_pdf:          'Tax Invoice',
  notice_of_assignment: 'Notice of Assignment',
  supporting_doc:       'Supporting Document',
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatUploadDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-UG', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

// ─── Props ─────────────────────────────────────────────────────────────────────

interface DocumentUploadProps {
  invoiceId:        string;
  documents:        InvoiceDocument[];
  onUploadComplete: () => void;
  readOnly?:        boolean;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function DocumentUpload({
  invoiceId,
  documents,
  onUploadComplete,
  readOnly,
}: DocumentUploadProps): React.ReactElement {
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading,  setUploading]  = useState(false);
  const [viewingDoc, setViewingDoc] = useState<InvoiceDocument | null>(null);

  // ── Upload handler ─────────────────────────────────────────────────────────

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 10 * 1024 * 1024) {
      toast.error('File size must be under 10MB');
      return;
    }
    const allowed = ['application/pdf', 'image/jpeg', 'image/png'];
    if (!allowed.includes(file.type)) {
      toast.error('Only PDF, JPEG, and PNG files are allowed');
      return;
    }

    setUploading(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('type', 'supporting_doc');
      await apiClient.post(`/invoices/${invoiceId}/documents`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      toast.success('Document uploaded');
      onUploadComplete();
    } catch (err) {
      toast.error(parseApiError(err));
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <>
      {/* ── Document list card ──────────────────────────────────────────────── */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">Documents ({documents.length})</CardTitle>
          {!readOnly && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => fileRef.current?.click()}
              disabled={uploading}
            >
              {uploading
                ? <Loader2 className="mr-2 size-3 animate-spin" />
                : <Upload className="mr-2 size-3" />}
              Upload
            </Button>
          )}
        </CardHeader>
        <CardContent>
          <input
            ref={fileRef}
            type="file"
            accept=".pdf,.jpg,.jpeg,.png"
            className="hidden"
            onChange={handleUpload}
          />

          {documents.length === 0 ? (
            <p className="text-sm text-muted-foreground">No documents uploaded.</p>
          ) : (
            <div className="space-y-2">
              {documents.map((doc) => (
                <button
                  key={doc.id}
                  type="button"
                  onClick={() => setViewingDoc(doc)}
                  className="group flex w-full items-center gap-3 rounded-lg border p-3 text-left
                             transition-colors hover:border-primary/40 hover:bg-muted/50
                             focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1"
                >
                  {/* File icon */}
                  <div className="flex size-9 shrink-0 items-center justify-center rounded-md
                                  bg-primary/10 text-primary transition-colors
                                  group-hover:bg-primary/15">
                    <FileText className="size-4" />
                  </div>

                  {/* Name + meta */}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{doc.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {DOC_TYPE_LABELS[doc.type] ?? doc.type.replace(/_/g, ' ')}
                      &nbsp;·&nbsp;
                      {formatSize(doc.sizeBytes)}
                      &nbsp;·&nbsp;
                      {formatUploadDate(doc.uploadedAt)}
                    </p>
                  </div>

                  {/* View cue */}
                  <div className="flex items-center gap-1.5 shrink-0 text-xs text-muted-foreground
                                  opacity-0 transition-opacity group-hover:opacity-100">
                    <Eye className="size-3.5" />
                    <span>View</span>
                  </div>
                </button>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Shared preview — matches the styling on every KYC document. The
          dialog routes its fetch based on which scope we pass: invoiceId
          here since these are invoice-attached docs. Backend streams from
          /invoices/:invoiceId/documents/:docId/file (decrypted server-side). */}
      {viewingDoc && (
        <DocumentPreviewDialog
          open={!!viewingDoc}
          onOpenChange={(open) => { if (!open) setViewingDoc(null); }}
          supplierId=""
          invoiceId={invoiceId}
          documentId={viewingDoc.id}
          documentType={viewingDoc.type}
          fileName={viewingDoc.name}
          uploadedAt={viewingDoc.uploadedAt}
          status="uploaded"
        />
      )}
    </>
  );
}
