import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import { render } from '@/test/test-utils';
import { InvoiceStatusBadge, EscalationBadge, RiskBadge, PaymentStatusBadge } from '../status-badge';

describe('InvoiceStatusBadge', () => {
  it('renders funded status', () => {
    render(<InvoiceStatusBadge status="funded" />);
    expect(screen.getByText('Funded')).toBeInTheDocument();
  });

  it('renders overdue status', () => {
    render(<InvoiceStatusBadge status="overdue" />);
    expect(screen.getByText('Overdue')).toBeInTheDocument();
  });

  it('renders all statuses without error', () => {
    const statuses = ['draft', 'submitted', 'approved', 'rejected', 'funded', 'collecting', 'overdue', 'collected', 'defaulted', 'cancelled', 'priced'] as const;
    statuses.forEach((s) => {
      const { unmount } = render(<InvoiceStatusBadge status={s} />);
      unmount();
    });
  });
});

describe('EscalationBadge', () => {
  it('renders all levels', () => {
    const levels = ['none', 'reminder', 'formal', 'legal'] as const;
    levels.forEach((l) => {
      const { unmount } = render(<EscalationBadge level={l} />);
      unmount();
    });
  });
});

describe('RiskBadge', () => {
  it('renders risk levels', () => {
    render(<RiskBadge level="high" />);
    expect(screen.getByText('high')).toBeInTheDocument();
  });
});

describe('PaymentStatusBadge', () => {
  it('renders payment statuses', () => {
    render(<PaymentStatusBadge status="funded" />);
    expect(screen.getByText('Funded')).toBeInTheDocument();
  });
});
