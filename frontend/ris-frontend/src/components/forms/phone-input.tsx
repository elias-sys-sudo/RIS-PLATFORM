import { forwardRef, useCallback } from 'react';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/cn';

const COUNTRY_CODE = '256';
const LOCAL_DIGIT_COUNT = 9;

interface PhoneInputProps {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  error?: boolean;
  placeholder?: string;
  id?: string;
  'aria-label'?: string;
}

/**
 * Format 9 raw digits into "7XX XXX XXX" display pattern.
 * Inserts spaces after the 3rd and 6th digit.
 */
function formatLocalNumber(raw: string): string {
  const digits = raw.replace(/[^0-9]/g, '').slice(0, LOCAL_DIGIT_COUNT);
  if (digits.length <= 3) return digits;
  if (digits.length <= 6) return `${digits.slice(0, 3)} ${digits.slice(3)}`;
  return `${digits.slice(0, 3)} ${digits.slice(3, 6)} ${digits.slice(6)}`;
}

/**
 * Extract raw digits from a full value (strip country code prefix if present).
 */
function extractLocalDigits(fullValue: string): string {
  const cleaned = fullValue.replace(/[^0-9]/g, '');
  if (cleaned.startsWith(COUNTRY_CODE)) {
    return cleaned.slice(COUNTRY_CODE.length);
  }
  return cleaned;
}

/**
 * Uganda phone number input with fixed +256 country code prefix.
 *
 * - Non-editable "+256" prefix displayed on the left
 * - Accepts 9 digits after the prefix (format: 7XX XXX XXX)
 * - Auto-formats with spaces as the user types
 * - `value` prop is the full number with 256 prefix (e.g., "256712345678")
 * - `onChange` emits the full number with 256 prefix
 * - Mobile-friendly: tel keyboard via inputMode="tel"
 */
export const PhoneInput = forwardRef<HTMLInputElement, PhoneInputProps>(
  function PhoneInput(
    {
      value,
      onChange,
      disabled = false,
      error = false,
      placeholder = '7XX XXX XXX',
      id,
      'aria-label': ariaLabel = 'Uganda phone number',
    },
    ref,
  ) {
    const localDigits = extractLocalDigits(value);
    const displayValue = formatLocalNumber(localDigits);

    const handleChange = useCallback(
      (e: React.ChangeEvent<HTMLInputElement>): void => {
        const raw = e.target.value.replace(/[^0-9]/g, '');
        const clamped = raw.slice(0, LOCAL_DIGIT_COUNT);
        onChange(`${COUNTRY_CODE}${clamped}`);
      },
      [onChange],
    );

    return (
      <div className="relative flex items-center">
        <span
          aria-hidden="true"
          className={cn(
            'pointer-events-none absolute left-3 top-1/2 -translate-y-1/2',
            'select-none text-sm font-medium text-muted-foreground',
            disabled && 'opacity-50',
          )}
        >
          +256
        </span>
        <Input
          ref={ref}
          id={id}
          type="tel"
          inputMode="tel"
          value={displayValue}
          onChange={handleChange}
          placeholder={placeholder}
          disabled={disabled}
          aria-label={ariaLabel}
          aria-invalid={error || undefined}
          className={cn(
            'pl-14 tabular-nums',
            error &&
              'border-destructive ring-destructive/20 focus-visible:border-destructive focus-visible:ring-destructive/20',
          )}
        />
      </div>
    );
  },
);
