import { useState, useCallback } from 'react';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/cn';

interface AmountInputProps {
  value: number | string;
  onChange: (rawValue: number) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  id?: string;
}

/**
 * UGX integer input with live comma formatting.
 * Stores raw integer, displays formatted (e.g., 1,500,000).
 * Rejects decimals, negatives, and non-numeric input.
 */
export function AmountInput({
  value,
  onChange,
  placeholder = '0',
  disabled,
  className,
  id,
}: AmountInputProps): React.ReactElement {
  const formatDisplay = useCallback((v: number | string): string => {
    const raw = String(v).replace(/[^0-9]/g, '');
    if (!raw) return '';
    return raw.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }, []);

  const [display, setDisplay] = useState(() => formatDisplay(value));

  function handleChange(e: React.ChangeEvent<HTMLInputElement>): void {
    const raw = e.target.value.replace(/[^0-9]/g, '');
    if (raw === '') {
      setDisplay('');
      onChange(0);
      return;
    }
    const num = parseInt(raw, 10);
    if (isNaN(num)) return;
    setDisplay(raw.replace(/\B(?=(\d{3})+(?!\d))/g, ','));
    onChange(num);
  }

  return (
    <div className="relative">
      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground font-mono" aria-hidden="true">
        UGX
      </span>
      <Input
        id={id}
        type="text"
        inputMode="numeric"
        value={display}
        onChange={handleChange}
        placeholder={placeholder}
        disabled={disabled}
        className={cn('pl-12 font-mono tabular-nums text-right', className)}
      />
    </div>
  );
}
