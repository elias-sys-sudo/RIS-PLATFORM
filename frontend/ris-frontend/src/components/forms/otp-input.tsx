import { useRef, useCallback } from 'react';
import { cn } from '@/lib/cn';

const OTP_LENGTH = 6;

interface OtpInputProps {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  error?: boolean;
  'aria-label'?: string;
}

/**
 * 6-digit OTP input for 2FA verification.
 *
 * - Individual cells with auto-advance on digit entry
 * - Backspace moves to previous cell and clears it
 * - Paste support: distributes a pasted code across all cells
 * - Mobile-friendly: numeric keyboard via inputMode="numeric"
 * - Browser autofill via autoComplete="one-time-code" on first cell
 */
export function OtpInput({
  value,
  onChange,
  disabled = false,
  error = false,
  'aria-label': ariaLabel = 'One-time verification code',
}: OtpInputProps): React.ReactElement {
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

  const digits = value.padEnd(OTP_LENGTH, '').slice(0, OTP_LENGTH).split('');

  const focusCell = useCallback((index: number): void => {
    const clamped = Math.max(0, Math.min(index, OTP_LENGTH - 1));
    inputRefs.current[clamped]?.focus();
  }, []);

  const updateValue = useCallback(
    (newDigits: string[]): void => {
      onChange(newDigits.join('').slice(0, OTP_LENGTH));
    },
    [onChange],
  );

  function handleInput(index: number, inputValue: string): void {
    const digit = inputValue.replace(/[^0-9]/g, '').slice(-1);
    if (!digit) return;

    const next = [...digits];
    next[index] = digit;
    updateValue(next);

    if (index < OTP_LENGTH - 1) {
      focusCell(index + 1);
    }
  }

  function handleKeyDown(
    index: number,
    e: React.KeyboardEvent<HTMLInputElement>,
  ): void {
    if (e.key === 'Backspace') {
      e.preventDefault();
      const next = [...digits];

      if (digits[index]) {
        next[index] = '';
        updateValue(next);
      } else if (index > 0) {
        next[index - 1] = '';
        updateValue(next);
        focusCell(index - 1);
      }
      return;
    }

    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      focusCell(index - 1);
      return;
    }

    if (e.key === 'ArrowRight') {
      e.preventDefault();
      focusCell(index + 1);
    }
  }

  function handlePaste(e: React.ClipboardEvent<HTMLInputElement>): void {
    e.preventDefault();
    const pasted = e.clipboardData
      .getData('text/plain')
      .replace(/[^0-9]/g, '')
      .slice(0, OTP_LENGTH);

    if (!pasted) return;

    const next = pasted.padEnd(OTP_LENGTH, '').split('').slice(0, OTP_LENGTH);
    // Preserve empty strings for unfilled cells
    const filled = next.map((ch) => (ch === ' ' ? '' : ch));
    updateValue(filled);

    // Focus the cell after the last pasted digit, or the last cell
    const focusIndex = Math.min(pasted.length, OTP_LENGTH - 1);
    focusCell(focusIndex);
  }

  function handleFocus(e: React.FocusEvent<HTMLInputElement>): void {
    e.target.select();
  }

  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className="flex items-center gap-2"
    >
      {Array.from({ length: OTP_LENGTH }, (_, i) => (
        <input
          key={i}
          ref={(el) => {
            inputRefs.current[i] = el;
          }}
          type="text"
          inputMode="numeric"
          autoComplete={i === 0 ? 'one-time-code' : 'off'}
          maxLength={1}
          value={digits[i] ?? ''}
          disabled={disabled}
          aria-label={`Digit ${i + 1} of ${OTP_LENGTH}`}
          aria-invalid={error || undefined}
          onInput={(e) =>
            handleInput(i, (e.target as HTMLInputElement).value)
          }
          onKeyDown={(e) => handleKeyDown(i, e)}
          onPaste={handlePaste}
          onFocus={handleFocus}
          className={cn(
            // Size: 48x48 min for WCAG touch target
            'size-12 min-h-[48px] min-w-[48px]',
            // Typography: Geist Mono, centered digit
            'text-center text-lg font-mono tabular-nums',
            // Base styling matching shadcn Input
            'rounded-md border bg-transparent shadow-xs',
            'transition-[color,box-shadow] outline-none',
            'placeholder:text-muted-foreground',
            'disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50',
            // Focus ring: primary green via --ring token
            'focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50',
            // Default border
            !error && 'border-input',
            // Error state
            error && 'border-destructive ring-destructive/20',
          )}
        />
      ))}
    </div>
  );
}
