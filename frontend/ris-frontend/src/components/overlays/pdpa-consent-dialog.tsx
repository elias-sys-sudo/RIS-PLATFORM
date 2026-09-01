import { useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';

// ── Props ──────────────────────────────────────────────────────────────────────

interface PdpaConsentDialogProps {
  open: boolean;
  onConsent: () => void;
  onDecline: () => void;
}

// ── Consent sections ───────────────────────────────────────────────────────────

interface ConsentSection {
  heading: string;
  body: string;
}

const CONSENT_SECTIONS: readonly ConsentSection[] = [
  {
    heading: 'What we collect',
    body: 'Company registration details, director information, financial records, and transaction data.',
  },
  {
    heading: 'Why we collect it',
    body: 'To assess invoice financing eligibility, perform KYC/AML compliance checks, and process payments.',
  },
  {
    heading: 'How we protect it',
    body: 'AES-256-GCM encryption at rest, TLS 1.3 in transit, role-based access controls.',
  },
  {
    heading: 'Retention period',
    body: 'Financial records: 7 years (legal requirement). Personal data: duration of business relationship plus 2 years.',
  },
  {
    heading: 'Your rights',
    body: 'Access, rectification, erasure (where legally permitted), objection to processing, data portability.',
  },
  {
    heading: 'Contact',
    body: 'Data Protection Officer \u2014 dpo@ris.ug',
  },
] as const;

// ── Component ──────────────────────────────────────────────────────────────────

export function PdpaConsentDialog({
  open,
  onConsent,
  onDecline,
}: PdpaConsentDialogProps): React.ReactElement {
  const [hasConsented, setHasConsented] = useState(false);

  return (
    <Dialog
      open={open}
      onOpenChange={(isOpen) => {
        // Non-dismissable — cannot close by clicking outside or pressing Escape
        if (!isOpen) return;
      }}
    >
      <DialogContent
        showCloseButton={false}
        onPointerDownOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
        onInteractOutside={(e) => e.preventDefault()}
        className="sm:max-w-lg"
        aria-label="Data protection consent notice"
      >
        <DialogHeader className="items-center sm:items-center sm:text-center">
          <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-primary/10">
            <ShieldCheck
              className="size-6 text-primary"
              aria-hidden="true"
            />
          </div>
          <DialogTitle className="text-center">
            Data Protection Notice
          </DialogTitle>
          <DialogDescription className="text-center text-base">
            Under the Uganda Data Protection and Privacy Act, 2019
          </DialogDescription>
        </DialogHeader>

        {/* Scrollable content area */}
        <div
          className="max-h-64 overflow-y-auto rounded-md border bg-muted/30 p-4"
          tabIndex={0}
          role="document"
          aria-label="Data protection details"
        >
          <ol className="list-none space-y-4 m-0 p-0">
            {CONSENT_SECTIONS.map((section) => (
              <li key={section.heading}>
                <p className="text-sm font-semibold text-foreground mb-1">
                  {section.heading}
                </p>
                <p className="text-sm text-muted-foreground leading-relaxed m-0">
                  {section.body}
                </p>
              </li>
            ))}
          </ol>
        </div>

        {/* Consent checkbox */}
        <label
          className="flex items-start gap-3 cursor-pointer pt-1"
          htmlFor="pdpa-consent-checkbox"
        >
          <Checkbox
            id="pdpa-consent-checkbox"
            checked={hasConsented}
            onCheckedChange={(checked) => setHasConsented(checked === true)}
            aria-required="true"
          />
          <span className="text-sm leading-snug select-none">
            I have read and consent to the processing of my data as described
            above
          </span>
        </label>

        <DialogFooter className="sm:justify-center gap-3 pt-2">
          <Button
            variant="outline"
            className="border-destructive text-destructive hover:bg-destructive/10"
            onClick={onDecline}
          >
            Decline
          </Button>
          <Button
            onClick={onConsent}
            disabled={!hasConsented}
          >
            I Consent
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
