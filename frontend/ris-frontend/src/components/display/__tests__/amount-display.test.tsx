import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import { render } from '@/test/test-utils';
import { AmountDisplay } from '../amount-display';

describe('AmountDisplay', () => {
  it('formats a number as UGX', () => {
    render(<AmountDisplay value={1500000} />);
    expect(screen.getByText('UGX 1,500,000')).toBeInTheDocument();
  });

  it('formats a string as UGX', () => {
    render(<AmountDisplay value="100000000000" />);
    expect(screen.getByText('UGX 100,000,000,000')).toBeInTheDocument();
  });

  it('shows dash for null', () => {
    render(<AmountDisplay value={null} />);
    expect(screen.getByText('—')).toBeInTheDocument();
  });

  it('shows dash for undefined', () => {
    render(<AmountDisplay value={undefined} />);
    expect(screen.getByText('—')).toBeInTheDocument();
  });

  it('formats zero correctly', () => {
    render(<AmountDisplay value={0} />);
    expect(screen.getByText('UGX 0')).toBeInTheDocument();
  });

  it('has aria-label for screen readers', () => {
    render(<AmountDisplay value={1500000} />);
    expect(screen.getByLabelText(/1500000 Uganda shillings/)).toBeInTheDocument();
  });

  it('applies green color when colorCoded and positive', () => {
    const { container } = render(<AmountDisplay value={2500000} colorCoded />);
    expect(container.firstChild).toHaveClass('text-green-600');
  });

  it('applies red color when colorCoded and negative', () => {
    const { container } = render(<AmountDisplay value={-500000} colorCoded />);
    expect(container.firstChild).toHaveClass('text-destructive');
  });
});
