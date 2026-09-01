import { useState, useCallback } from 'react';
import { ShieldCheck, Loader2 } from 'lucide-react';
import { stepUpVerify } from '@/features/auth/api/auth.api';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { OtpInput } from '@/components/forms/otp-input';

// ── Constants ──────────────────────────────────────────────────────────────────

const STEP_UP_STORAGE_KEY = 'ris-step-up-expiry';
const STEP_UP_VALIDITY_MS = 5 * 60 * 1000; // 5 minutes
const OTP_REQUIRED_LENGTH = 6;

// ── Public utility ─────────────────────────────────────────────────────────────

/**
 * Returns true if a prior step-up authentication is still valid (within 5 minutes).
 * Uses sessionStorage so the window of trust ends when the tab is closed.
 */
export function isStepUpValid(): boolean {
  try {
    const raw = sessionStorage.getItem(STEP_UP_STORAGE_KEY);
    if (!raw) return false;
    const expiry = Number(raw);
    if (Number.isNaN(expiry)) return false;
    return Date.now() < expiry;
  } catch {
    // sessionStorage not available (e.g. SSR, privacy mode) — treat as invalid
    return false;
  }
}

function storeStepUpExpiry(): void {
  try {
    sessionStorage.setItem(
      STEP_UP_STORAGE_KEY,
      String(Date.now() + STEP_UP_VALIDITY_MS),
    );
  } catch {
    // Silently fail — step-up will be required again next time
  }
}

// ── Props ──────────────────────────────────────────────────────────────────────

interface StepUpAuthDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onVerified: () => void;
  actionLabel: string;
}

// ── Component ──────────────────────────────────────────────────────────────────

export function StepUpAuthDialog({
  open,
  onOpenChange,
  onVerified,
  actionLabel,
}: StepUpAuthDialogProps): React.ReactElement {
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isVerifying, setIsVerifying] = useState(false);

  const isCodeComplete = code.replace(/\s/g, '').length === OTP_REQUIRED_LENGTH;

  const resetState = useCallback((): void => {
    setCode('');
    setError(null);
    setIsVerifying(false);
  }, []);

  const handleOpenChange = useCallback(
    (isOpen: boolean): void => {
      if (!isOpen) resetState();
      onOpenChange(isOpen);
    },
    [onOpenChange, resetState],
  );

  const handleVerify = useCallback(async (): Promise<void> => {
    if (!isCodeComplete) return;

    setError(null);
    setIsVerifying(true);

    try {
      await stepUpVerify(code.replace(/\s/g, ''));
      storeStepUpExpiry();
      resetState();
      onVerified();
    } catch {
      setError('Verification failed. Please check your code and try again.');
    } finally {
      setIsVerifying(false);
    }
  }, [isCodeComplete, onVerified, resetState]);

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        showCloseButton={false}
        aria-label={`Verify identity to ${actionLabel}`}
      >
        <DialogHeader className="items-center sm:items-center sm:text-center">
          <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-primary/10">
            <ShieldCheck
              className="size-6 text-primary"
              aria-hidden="true"
            />
          </div>
          <DialogTitle className="text-center">
            Verify Your Identity
          </DialogTitle>
          <DialogDescription className="text-center text-base">
            Enter your 2FA code to {actionLabel}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col items-center gap-4 py-2">
          <OtpInput
            value={code}
            onChange={setCode}
            disabled={isVerifying}
            error={error !== null}
            aria-label="Two-factor authentication code"
          />

          {error !== null && (
            <Alert variant="destructive" className="w-full">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
        </div>

        <DialogFooter className="sm:justify-center gap-3 pt-2">
          <Button
            variant="outline"
            onClick={() => handleOpenChange(false)}
            disabled={isVerifying}
          >
            Cancel
          </Button>
          <Button
            onClick={() => void handleVerify()}
            disabled={!isCodeComplete || isVerifying}
          >
            {isVerifying && (
              <Loader2 className="mr-2 size-4 animate-spin" aria-hidden="true" />
            )}
            Verify
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
