import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/cn';
import {
  INVOICE_STATUS_LABELS,
  ESCALATION_LABELS,
  type InvoiceStatus,
  type EscalationLevel,
  type RiskLevel,
} from '@/lib/constants';
import {
  FileEdit,
  Send,
  UserCheck,
  BarChart3,
  Calculator,
  CheckCircle2,
  XCircle,
  Clock,
  Loader2,
  Banknote,
  ArrowDownToLine,
  AlertTriangle,
  ShieldCheck,
  Ban,
  MinusCircle,
  Bell,
  FileWarning,
  Gavel,
  ShieldAlert,
  TrendingDown,
  type LucideIcon,
} from 'lucide-react';

// ── Icon maps for triple encoding (icon + color + text) ─────────────────────

const INVOICE_ICON: Record<string, LucideIcon> = {
  draft:               FileEdit,
  submitted:           Send,
  buyer_confirmed:     UserCheck,
  scored:              BarChart3,
  priced:              Calculator,
  approved:            CheckCircle2,
  rejected:            XCircle,
  pending_first_auth:  Clock,
  pending_second_auth: Clock,
  executing:           Loader2,
  funded:              Banknote,
  collecting:          ArrowDownToLine,
  overdue:             AlertTriangle,
  collected:           ShieldCheck,
  defaulted:           Ban,
  cancelled:           MinusCircle,
  withdrawn:           MinusCircle,
};

// ── Invoice status ──────────────────────────────────────────────────────────

const INVOICE_VARIANT: Record<string, string> = {
  draft:               'bg-stone-100 text-stone-700 border-stone-200',
  submitted:           'bg-emerald-50 text-emerald-700 border-emerald-200',
  buyer_confirmed:     'bg-teal-50 text-teal-700 border-teal-200',
  scored:              'bg-violet-50 text-violet-700 border-violet-200',
  priced:              'bg-violet-50 text-violet-700 border-violet-200',
  approved:            'bg-green-50 text-green-700 border-green-200',
  rejected:            'bg-red-50 text-red-700 border-red-200',
  pending_first_auth:  'bg-amber-50 text-amber-700 border-amber-200',
  pending_second_auth: 'bg-amber-50 text-amber-700 border-amber-200',
  executing:           'bg-yellow-50 text-yellow-700 border-yellow-200',
  funded:              'bg-emerald-50 text-emerald-800 border-emerald-300',
  collecting:          'bg-blue-50 text-blue-700 border-blue-200',
  overdue:             'bg-orange-50 text-orange-700 border-orange-200',
  collected:           'bg-teal-50 text-teal-800 border-teal-300',
  defaulted:           'bg-red-100 text-red-800 border-red-300',
  cancelled:           'bg-stone-50 text-stone-500 border-stone-200',
  withdrawn:           'bg-slate-50 text-slate-600 border-slate-200',
};

export function InvoiceStatusBadge({ status, className }: { status: InvoiceStatus; className?: string }): React.ReactElement {
  const Icon = INVOICE_ICON[status];
  return (
    <Badge variant="outline" className={cn('text-[11px] font-medium gap-1', INVOICE_VARIANT[status], className)}>
      {Icon && <Icon className="size-3" aria-hidden="true" />}
      {INVOICE_STATUS_LABELS[status] ?? status}
    </Badge>
  );
}

// ── Escalation level ────────────────────────────────────────────────────────

const ESCALATION_ICON: Record<string, LucideIcon> = {
  none:     MinusCircle,
  reminder: Bell,
  formal:   FileWarning,
  legal:    Gavel,
};

const ESCALATION_VARIANT: Record<string, string> = {
  none:     'bg-stone-50 text-stone-600 border-stone-200',
  reminder: 'bg-amber-50 text-amber-700 border-amber-200',
  formal:   'bg-orange-50 text-orange-700 border-orange-200',
  legal:    'bg-red-50 text-red-700 border-red-200',
};

export function EscalationBadge({ level, className }: { level: EscalationLevel; className?: string }): React.ReactElement {
  const Icon = ESCALATION_ICON[level];
  return (
    <Badge variant="outline" className={cn('text-[11px] font-medium gap-1', ESCALATION_VARIANT[level], className)}>
      {Icon && <Icon className="size-3" aria-hidden="true" />}
      {ESCALATION_LABELS[level] ?? level}
    </Badge>
  );
}

// ── Risk level ──────────────────────────────────────────────────────────────

const RISK_ICON: Record<string, LucideIcon> = {
  low:      CheckCircle2,
  medium:   AlertTriangle,
  high:     ShieldAlert,
  critical: TrendingDown,
};

const RISK_VARIANT: Record<string, string> = {
  low:      'bg-green-50 text-green-700 border-green-200',
  medium:   'bg-amber-50 text-amber-700 border-amber-200',
  high:     'bg-orange-50 text-orange-700 border-orange-200',
  critical: 'bg-red-50 text-red-700 border-red-200',
};

export function RiskBadge({ level, className }: { level: RiskLevel; className?: string }): React.ReactElement {
  const Icon = RISK_ICON[level];
  return (
    <Badge variant="outline" className={cn('text-[11px] font-medium gap-1 capitalize', RISK_VARIANT[level], className)}>
      {Icon && <Icon className="size-3" aria-hidden="true" />}
      {level}
    </Badge>
  );
}

// ── Payment status ──────────────────────────────────────────────────────────

const PAYMENT_ICON: Record<string, LucideIcon> = {
  pending_first_auth:  Clock,
  pending_second_auth: Clock,
  executing:           Loader2,
  funded:              Banknote,
  failed:              XCircle,
  reversed:            MinusCircle,
};

const PAYMENT_VARIANT: Record<string, string> = {
  pending_first_auth:  'bg-amber-50 text-amber-700 border-amber-200',
  pending_second_auth: 'bg-amber-50 text-amber-700 border-amber-200',
  executing:           'bg-blue-50 text-blue-700 border-blue-200',
  funded:              'bg-green-50 text-green-700 border-green-200',
  failed:              'bg-red-50 text-red-700 border-red-200',
  reversed:            'bg-stone-50 text-stone-500 border-stone-200',
};

const PAYMENT_LABELS: Record<string, string> = {
  pending_first_auth:  '1st Auth',
  pending_second_auth: '2nd Auth',
  executing:           'Executing',
  funded:              'Funded',
  failed:              'Failed',
  reversed:            'Reversed',
};

export function PaymentStatusBadge({ status, className }: { status: string; className?: string }): React.ReactElement {
  const Icon = PAYMENT_ICON[status];
  return (
    <Badge variant="outline" className={cn('text-[11px] font-medium gap-1', PAYMENT_VARIANT[status], className)}>
      {Icon && <Icon className="size-3" aria-hidden="true" />}
      {PAYMENT_LABELS[status] ?? status}
    </Badge>
  );
}
