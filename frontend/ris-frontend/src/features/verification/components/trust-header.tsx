import { ShieldCheck } from 'lucide-react';

/**
 * Trust-building header for the buyer verification page.
 * Buyers arrive from an SMS link and have never seen RIS before —
 * regulatory references and professional branding build confidence.
 */
export function TrustHeader(): React.ReactElement {
  return (
    <div className="mb-8 text-center space-y-2">
      <div className="flex items-center justify-center gap-2">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground font-bold text-sm">
          R
        </div>
        <h1 className="text-2xl font-bold font-display tracking-tight">RIS Platform</h1>
      </div>
      <p className="text-sm text-muted-foreground">
        Invoice Discounting &amp; Early Payment
      </p>
      <p className="inline-flex items-center justify-center gap-1.5 text-xs text-muted-foreground">
        <ShieldCheck className="size-3.5 text-green-600" />
        Regulated under the Bank of Uganda Financial Institutions Act 2004
      </p>
    </div>
  );
}
