import { describe, it, expect, vi } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import { render } from '@/test/test-utils';
import { AmountInput } from '../amount-input';

describe('AmountInput', () => {
  it('displays UGX prefix', () => {
    render(<AmountInput value={0} onChange={() => {}} />);
    expect(screen.getByText('UGX')).toBeInTheDocument();
  });

  it('formats display with commas', () => {
    render(<AmountInput value={1500000} onChange={() => {}} />);
    const input = screen.getByRole('textbox');
    expect(input).toHaveValue('1,500,000');
  });

  it('calls onChange with raw integer', () => {
    const onChange = vi.fn();
    render(<AmountInput value={0} onChange={onChange} />);
    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: '1,500,000' } });
    expect(onChange).toHaveBeenCalledWith(1500000);
  });

  it('rejects non-numeric input', () => {
    const onChange = vi.fn();
    render(<AmountInput value={0} onChange={onChange} />);
    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: 'abc' } });
    expect(onChange).toHaveBeenCalledWith(0);
  });

  it('handles empty input', () => {
    const onChange = vi.fn();
    render(<AmountInput value={1000} onChange={onChange} />);
    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: '' } });
    expect(onChange).toHaveBeenCalledWith(0);
  });
});
