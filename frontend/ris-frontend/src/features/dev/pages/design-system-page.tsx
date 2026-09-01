import { useState } from 'react';
import { Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';

import {
  InvoiceStatusBadge,
  EscalationBadge,
  RiskBadge,
  PaymentStatusBadge,
} from '@/components/display/status-badge';
import { AmountDisplay } from '@/components/display/amount-display';
import { ApprovalTierBadge } from '@/components/display/approval-tier-badge';
import { OtpInput } from '@/components/forms/otp-input';
import { PhoneInput } from '@/components/forms/phone-input';
import { cn } from '@/lib/cn';

import type { InvoiceStatus, EscalationLevel, RiskLevel } from '@/lib/constants';
import type { ApprovalTier } from '@/types/approval.types';

// ── Section 1: Color Palette ────────────────────────────────────────────────

interface ColorSwatch {
  label: string;
  hex: string;
  twClass: string;
}

const PRIMARY_COLORS: ColorSwatch[] = [
  { label: 'Primary', hex: '#1B4332', twClass: 'bg-[#1B4332]' },
  { label: 'Accent', hex: '#F59E0B', twClass: 'bg-[#F59E0B]' },
];

const NEUTRAL_COLORS: ColorSwatch[] = [
  { label: 'Background', hex: '#FAFAF8', twClass: 'bg-[#FAFAF8]' },
  { label: 'Surface', hex: '#F5F5F0', twClass: 'bg-[#F5F5F0]' },
  { label: 'Border', hex: '#E7E5E4', twClass: 'bg-[#E7E5E4]' },
  { label: 'Muted Text', hex: '#78716C', twClass: 'bg-[#78716C]' },
  { label: 'Body Text', hex: '#44403C', twClass: 'bg-[#44403C]' },
  { label: 'Heading Text', hex: '#1C1917', twClass: 'bg-[#1C1917]' },
];

const SEMANTIC_COLORS: ColorSwatch[] = [
  { label: 'Success', hex: '#16A34A', twClass: 'bg-[#16A34A]' },
  { label: 'Warning', hex: '#D97706', twClass: 'bg-[#D97706]' },
  { label: 'Error', hex: '#DC2626', twClass: 'bg-[#DC2626]' },
  { label: 'Info', hex: '#2563EB', twClass: 'bg-[#2563EB]' },
];

const FINTECH_COLORS: ColorSwatch[] = [
  { label: 'Credit', hex: '#16A34A', twClass: 'bg-green-600' },
  { label: 'Debit', hex: '#DC2626', twClass: 'bg-red-600' },
  { label: 'Pending', hex: '#D97706', twClass: 'bg-amber-600' },
  { label: 'Reversed', hex: '#7C3AED', twClass: 'bg-purple-600' },
];

function SwatchCircle({ swatch }: { swatch: ColorSwatch }): React.ReactElement {
  return (
    <div className="flex flex-col items-center gap-1.5">
      <span className="text-xs font-medium text-muted-foreground">
        {swatch.label}
      </span>
      <span
        className={cn(
          'size-12 rounded-full border border-border shadow-sm',
          swatch.twClass,
        )}
        aria-label={`${swatch.label}: ${swatch.hex}`}
      />
      <span className="font-mono text-[11px] text-muted-foreground">
        {swatch.hex}
      </span>
    </div>
  );
}

function ColorSwatchGroup({
  title,
  swatches,
}: {
  title: string;
  swatches: ColorSwatch[];
}): React.ReactElement {
  return (
    <div className="space-y-3">
      <h4 className="text-sm font-semibold text-foreground">{title}</h4>
      <div className="flex flex-wrap gap-6">
        {swatches.map((s) => (
          <SwatchCircle key={s.label} swatch={s} />
        ))}
      </div>
    </div>
  );
}

function ColorPaletteSection(): React.ReactElement {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Color Palette</CardTitle>
        <CardDescription>
          Design tokens for the RIS Platform color system.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <ColorSwatchGroup title="Primary" swatches={PRIMARY_COLORS} />
        <Separator />
        <ColorSwatchGroup title="Neutrals" swatches={NEUTRAL_COLORS} />
        <Separator />
        <ColorSwatchGroup title="Semantic" swatches={SEMANTIC_COLORS} />
        <Separator />
        <ColorSwatchGroup title="Fintech" swatches={FINTECH_COLORS} />
      </CardContent>
    </Card>
  );
}

// ── Section 2: Typography Scale ─────────────────────────────────────────────

interface TypoSize {
  name: string;
  px: number;
  twClass: string;
}

const TYPO_SIZES: TypoSize[] = [
  { name: 'xs', px: 12, twClass: 'text-xs' },
  { name: 'sm', px: 14, twClass: 'text-sm' },
  { name: 'base', px: 16, twClass: 'text-base' },
  { name: 'lg', px: 18, twClass: 'text-lg' },
  { name: 'xl', px: 20, twClass: 'text-xl' },
  { name: '2xl', px: 24, twClass: 'text-2xl' },
  { name: '3xl', px: 30, twClass: 'text-3xl' },
  { name: '4xl', px: 36, twClass: 'text-4xl' },
];

function TypographySection(): React.ReactElement {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Typography Scale</CardTitle>
        <CardDescription>
          8 sizes from DESIGN.md across all 3 font families.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-6">
          {TYPO_SIZES.map((size) => (
            <div key={size.name} className="space-y-1">
              <div className="flex items-baseline gap-2">
                <span className="font-mono text-xs text-muted-foreground w-10">
                  {size.name}
                </span>
                <span className="text-xs text-muted-foreground">
                  {size.px}px
                </span>
              </div>
              <p className={cn(size.twClass, 'font-display text-foreground')}>
                Plus Jakarta Sans &mdash; Display
              </p>
              <p className={cn(size.twClass, 'font-sans text-foreground')}>
                DM Sans &mdash; Body
              </p>
              <p className={cn(size.twClass, 'font-mono text-foreground')}>
                UGX 12,345,678
              </p>
              {size.name !== '4xl' && <Separator className="mt-4" />}
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

// ── Section 3: Button Gallery ───────────────────────────────────────────────

type ButtonVariant = 'default' | 'destructive' | 'outline' | 'secondary' | 'ghost' | 'link';
type ButtonSize = 'xs' | 'sm' | 'default' | 'lg';

const BUTTON_VARIANTS: ButtonVariant[] = [
  'default', 'destructive', 'outline', 'secondary', 'ghost', 'link',
];

const BUTTON_SIZES: ButtonSize[] = ['xs', 'sm', 'default', 'lg'];

function ButtonGallerySection(): React.ReactElement {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Button Gallery</CardTitle>
        <CardDescription>
          All variant and size combinations, plus disabled and loading states.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-8">
        {/* Variant x Size grid */}
        <div className="space-y-4">
          <h4 className="text-sm font-semibold text-foreground">
            Variants x Sizes
          </h4>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr>
                  <th className="text-left py-2 pr-4 font-medium text-muted-foreground">
                    Variant
                  </th>
                  {BUTTON_SIZES.map((size) => (
                    <th
                      key={size}
                      className="text-left py-2 px-2 font-medium text-muted-foreground"
                    >
                      {size}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {BUTTON_VARIANTS.map((variant) => (
                  <tr key={variant} className="border-t border-border">
                    <td className="py-3 pr-4 font-mono text-xs text-muted-foreground">
                      {variant}
                    </td>
                    {BUTTON_SIZES.map((size) => (
                      <td key={size} className="py-3 px-2">
                        <Button variant={variant} size={size}>
                          {variant === 'link' ? 'Link' : 'Button'}
                        </Button>
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <Separator />

        {/* Disabled states */}
        <div className="space-y-3">
          <h4 className="text-sm font-semibold text-foreground">
            Disabled States
          </h4>
          <div className="flex flex-wrap items-center gap-3">
            <Button disabled>Default</Button>
            <Button variant="destructive" disabled>Destructive</Button>
            <Button variant="outline" disabled>Outline</Button>
            <Button variant="secondary" disabled>Secondary</Button>
            <Button variant="ghost" disabled>Ghost</Button>
          </div>
        </div>

        <Separator />

        {/* Loading state */}
        <div className="space-y-3">
          <h4 className="text-sm font-semibold text-foreground">
            Loading State
          </h4>
          <div className="flex flex-wrap items-center gap-3">
            <Button disabled>
              <Loader2 className="size-4 animate-spin" />
              Processing...
            </Button>
            <Button variant="outline" disabled>
              <Loader2 className="size-4 animate-spin" />
              Saving...
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ── Section 4: Status Badge Gallery ─────────────────────────────────────────

const ALL_INVOICE_STATUSES: InvoiceStatus[] = [
  'draft', 'submitted', 'buyer_confirmed', 'scored', 'priced',
  'approved', 'rejected', 'pending_first_auth', 'pending_second_auth',
  'executing', 'funded', 'collecting', 'overdue', 'collected',
  'defaulted', 'cancelled',
];

const ALL_RISK_LEVELS: RiskLevel[] = ['low', 'medium', 'high', 'critical'];

const ALL_ESCALATION_LEVELS: EscalationLevel[] = [
  'none', 'reminder', 'formal', 'legal',
];

const ALL_PAYMENT_STATUSES: string[] = [
  'pending_first_auth', 'pending_second_auth', 'executing',
  'funded', 'failed', 'reversed',
];

function StatusBadgeSection(): React.ReactElement {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Status Badge Gallery</CardTitle>
        <CardDescription>
          Triple-encoded badges: icon + color + text for every status type.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Invoice statuses */}
        <div className="space-y-3">
          <h4 className="text-sm font-semibold text-foreground">
            Invoice Statuses ({ALL_INVOICE_STATUSES.length})
          </h4>
          <div className="flex flex-wrap gap-2">
            {ALL_INVOICE_STATUSES.map((status) => (
              <InvoiceStatusBadge key={status} status={status} />
            ))}
          </div>
        </div>

        <Separator />

        {/* Risk levels */}
        <div className="space-y-3">
          <h4 className="text-sm font-semibold text-foreground">
            Risk Levels ({ALL_RISK_LEVELS.length})
          </h4>
          <div className="flex flex-wrap gap-2">
            {ALL_RISK_LEVELS.map((level) => (
              <RiskBadge key={level} level={level} />
            ))}
          </div>
        </div>

        <Separator />

        {/* Escalation levels */}
        <div className="space-y-3">
          <h4 className="text-sm font-semibold text-foreground">
            Escalation Levels ({ALL_ESCALATION_LEVELS.length})
          </h4>
          <div className="flex flex-wrap gap-2">
            {ALL_ESCALATION_LEVELS.map((level) => (
              <EscalationBadge key={level} level={level} />
            ))}
          </div>
        </div>

        <Separator />

        {/* Payment statuses */}
        <div className="space-y-3">
          <h4 className="text-sm font-semibold text-foreground">
            Payment Statuses ({ALL_PAYMENT_STATUSES.length})
          </h4>
          <div className="flex flex-wrap gap-2">
            {ALL_PAYMENT_STATUSES.map((status) => (
              <PaymentStatusBadge key={status} status={status} />
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ── Section 5: Approval Tier Badges ─────────────────────────────────────────

interface TierExample {
  tier: ApprovalTier;
  label: string;
  received?: number;
  required?: number;
}

const TIER_EXAMPLES: TierExample[] = [
  { tier: 'AUTO', label: 'AUTO (no quorum)' },
  { tier: 'TIER_2', label: 'TIER_2 (no quorum)' },
  { tier: 'TIER_3', label: 'TIER_3 (1 of 2)', received: 1, required: 2 },
  { tier: 'TIER_3', label: 'TIER_3 (2 of 2 -- complete)', received: 2, required: 2 },
  { tier: 'TIER_4', label: 'TIER_4 (0 of 3)', received: 0, required: 3 },
];

function ApprovalTierSection(): React.ReactElement {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Approval Tier Badges</CardTitle>
        <CardDescription>
          4-tier approval matrix with quorum progress indicators.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex flex-wrap gap-6">
          {TIER_EXAMPLES.map((ex, i) => (
            <div key={i} className="flex flex-col items-center gap-2">
              <ApprovalTierBadge
                tier={ex.tier}
                approvalsReceived={ex.received}
                approvalsRequired={ex.required}
              />
              <span className="text-xs text-muted-foreground text-center max-w-[120px]">
                {ex.label}
              </span>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

// ── Section 6: Form Inputs ──────────────────────────────────────────────────

function FormInputsSection(): React.ReactElement {
  const [otpValue, setOtpValue] = useState('');
  const [phoneValue, setPhoneValue] = useState('256');

  return (
    <Card>
      <CardHeader>
        <CardTitle>Form Inputs</CardTitle>
        <CardDescription>
          Standard inputs, OTP, phone number, and formatted amount display.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-8">
        {/* Standard Input */}
        <div className="space-y-3">
          <h4 className="text-sm font-semibold text-foreground">
            Standard Input
          </h4>
          <div className="max-w-sm space-y-2">
            <Label htmlFor="demo-input">Invoice Number</Label>
            <Input
              id="demo-input"
              placeholder="INV-2026-0001"
            />
          </div>
        </div>

        <Separator />

        {/* OTP Input */}
        <div className="space-y-3">
          <h4 className="text-sm font-semibold text-foreground">
            OTP Input
          </h4>
          <OtpInput value={otpValue} onChange={setOtpValue} />
          <p className="text-xs text-muted-foreground">
            Current value: &quot;{otpValue}&quot;
          </p>
        </div>

        <Separator />

        {/* Phone Input */}
        <div className="space-y-3">
          <h4 className="text-sm font-semibold text-foreground">
            Phone Input (Uganda +256)
          </h4>
          <div className="max-w-sm space-y-2">
            <Label htmlFor="demo-phone">Phone Number</Label>
            <PhoneInput
              id="demo-phone"
              value={phoneValue}
              onChange={setPhoneValue}
            />
          </div>
          <p className="text-xs text-muted-foreground">
            Full value: &quot;{phoneValue}&quot;
          </p>
        </div>

        <Separator />

        {/* Amount Display */}
        <div className="space-y-3">
          <h4 className="text-sm font-semibold text-foreground">
            Amount Display (formatUGX)
          </h4>
          <div className="flex flex-wrap gap-6">
            <div className="space-y-1">
              <span className="text-xs text-muted-foreground">5,000,000</span>
              <div>
                <AmountDisplay value="5000000" />
              </div>
            </div>
            <div className="space-y-1">
              <span className="text-xs text-muted-foreground">
                12,345,678,900
              </span>
              <div>
                <AmountDisplay value="12345678900" />
              </div>
            </div>
            <div className="space-y-1">
              <span className="text-xs text-muted-foreground">
                Color coded (positive)
              </span>
              <div>
                <AmountDisplay value="5000000" colorCoded />
              </div>
            </div>
            <div className="space-y-1">
              <span className="text-xs text-muted-foreground">
                Color coded (negative)
              </span>
              <div>
                <AmountDisplay value="-250000" colorCoded />
              </div>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ── Section 7: Spacing Scale ────────────────────────────────────────────────

interface SpacingStep {
  name: string;
  px: number;
}

const SPACING_STEPS: SpacingStep[] = [
  { name: '2xs', px: 2 },
  { name: 'xs', px: 4 },
  { name: 'sm', px: 8 },
  { name: 'md', px: 16 },
  { name: 'lg', px: 24 },
  { name: 'xl', px: 32 },
  { name: '2xl', px: 48 },
  { name: '3xl', px: 64 },
];

function SpacingScaleSection(): React.ReactElement {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Spacing Scale</CardTitle>
        <CardDescription>
          Visual representation of the spacing tokens from DESIGN.md.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {SPACING_STEPS.map((step) => (
            <div key={step.name} className="flex items-center gap-4">
              <span className="w-10 text-right font-mono text-xs text-muted-foreground">
                {step.name}
              </span>
              <span className="w-12 text-right font-mono text-xs text-muted-foreground">
                {step.px}px
              </span>
              <div
                className="h-4 rounded-sm bg-primary"
                style={{ width: `${step.px}px` }}
                aria-label={`${step.name}: ${step.px}px`}
              />
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

// ── Section 8: Border Radius ────────────────────────────────────────────────

interface RadiusStep {
  name: string;
  px: number;
  twClass: string;
}

const RADIUS_STEPS: RadiusStep[] = [
  { name: 'sm', px: 4, twClass: 'rounded-sm' },
  { name: 'md', px: 8, twClass: 'rounded-md' },
  { name: 'lg', px: 12, twClass: 'rounded-lg' },
  { name: 'full', px: 9999, twClass: 'rounded-full' },
];

function BorderRadiusSection(): React.ReactElement {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Border Radius</CardTitle>
        <CardDescription>
          4 radius tokens from the design system.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex flex-wrap gap-6">
          {RADIUS_STEPS.map((step) => (
            <div key={step.name} className="flex flex-col items-center gap-2">
              <div
                className={cn(
                  'flex size-16 items-center justify-center bg-primary text-primary-foreground text-xs font-mono',
                  step.twClass,
                )}
              >
                {step.px === 9999 ? 'full' : `${step.px}px`}
              </div>
              <span className="font-mono text-xs text-muted-foreground">
                {step.name}
              </span>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

// ── Bonus: Badge variants (shadcn/ui base) ──────────────────────────────────

function BadgeVariantsSection(): React.ReactElement {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Base Badge Variants</CardTitle>
        <CardDescription>
          shadcn/ui Badge component with all 4 variants.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex flex-wrap gap-3">
          <Badge variant="default">Default</Badge>
          <Badge variant="secondary">Secondary</Badge>
          <Badge variant="destructive">Destructive</Badge>
          <Badge variant="outline">Outline</Badge>
        </div>
      </CardContent>
    </Card>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function DesignSystemPage(): React.ReactElement {
  return (
    <div className="mx-auto max-w-5xl space-y-8 pb-16">
      {/* Page header */}
      <div className="space-y-2">
        <h1 className="font-display text-4xl font-bold tracking-tight text-foreground">
          Design System
        </h1>
        <p className="text-lg text-muted-foreground">
          Living reference &mdash; RIS Platform design tokens and components
        </p>
      </div>

      {/* Sections */}
      <ColorPaletteSection />
      <TypographySection />
      <ButtonGallerySection />
      <BadgeVariantsSection />
      <StatusBadgeSection />
      <ApprovalTierSection />
      <FormInputsSection />
      <SpacingScaleSection />
      <BorderRadiusSection />
    </div>
  );
}
