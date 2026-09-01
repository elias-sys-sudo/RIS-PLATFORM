import { useState } from 'react';
import { CalendarIcon } from 'lucide-react';
import { format } from 'date-fns';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { cn } from '@/lib/cn';
import type { DateRange } from 'react-day-picker';

interface DateRangePickerProps {
  from?: Date;
  to?: Date;
  onChange: (range: { from?: Date; to?: Date }) => void;
  placeholder?: string;
  className?: string;
}

export function DateRangePicker({
  from,
  to,
  onChange,
  placeholder = 'Pick a date range',
  className,
}: DateRangePickerProps): React.ReactElement {
  const [open, setOpen] = useState(false);

  const range: DateRange = { from, to };

  const label = from
    ? to
      ? `${format(from, 'dd MMM yyyy')} – ${format(to, 'dd MMM yyyy')}`
      : format(from, 'dd MMM yyyy')
    : placeholder;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          className={cn('justify-start text-left font-normal', !from && 'text-muted-foreground', className)}
        >
          <CalendarIcon className="mr-2 size-4" />
          {label}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="range"
          selected={range}
          onSelect={(r) => onChange({ from: r?.from, to: r?.to })}
          numberOfMonths={2}
        />
      </PopoverContent>
    </Popover>
  );
}
