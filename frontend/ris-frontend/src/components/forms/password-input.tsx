import { useState, forwardRef } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/cn';

interface PasswordInputProps extends React.ComponentProps<typeof Input> {
  showStrength?: boolean;
}

function getStrength(pw: string): { score: number; label: string; color: string } {
  let score = 0;
  if (pw.length >= 8) score++;
  if (/[A-Z]/.test(pw)) score++;
  if (/[a-z]/.test(pw)) score++;
  if (/[0-9]/.test(pw)) score++;
  if (/[^A-Za-z0-9]/.test(pw)) score++;

  if (score <= 2) return { score: score * 20, label: 'Weak', color: 'bg-red-500' };
  if (score <= 3) return { score: score * 20, label: 'Fair', color: 'bg-amber-500' };
  if (score <= 4) return { score: score * 20, label: 'Good', color: 'bg-blue-500' };
  return { score: 100, label: 'Strong', color: 'bg-green-500' };
}

export const PasswordInput = forwardRef<HTMLInputElement, PasswordInputProps>(
  function PasswordInput({ showStrength, className, ...props }, ref) {
    const [visible, setVisible] = useState(false);
    const val = typeof props.value === 'string' ? props.value : '';
    const strength = showStrength && val.length > 0 ? getStrength(val) : null;

    return (
      <div className="space-y-1">
        <div className="relative">
          <Input
            ref={ref}
            type={visible ? 'text' : 'password'}
            className={cn('pr-10', className)}
            {...props}
          />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="absolute right-0 top-0 h-full px-3 hover:bg-transparent"
            onClick={() => setVisible(!visible)}
            tabIndex={-1}
            aria-label={visible ? 'Hide password' : 'Show password'}
          >
            {visible ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
          </Button>
        </div>
        {strength && (
          <div className="flex items-center gap-2">
            <Progress value={strength.score} className={cn('h-1.5 flex-1', strength.color)} />
            <span className="text-xs text-muted-foreground">{strength.label}</span>
          </div>
        )}
      </div>
    );
  },
);
