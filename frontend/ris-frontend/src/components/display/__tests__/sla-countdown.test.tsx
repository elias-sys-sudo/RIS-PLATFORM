import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import { render } from '@/test/test-utils';
import { SlaCountdown } from '../sla-countdown';

describe('SlaCountdown', () => {
  it('shows time remaining for fresh SLA', () => {
    render(<SlaCountdown startedAt={new Date().toISOString()} slaHours={72} />);
    expect(screen.getByText(/71h/)).toBeInTheDocument();
  });

  it('shows BREACHED for expired SLA', () => {
    const expired = new Date(Date.now() - 100 * 60 * 60 * 1000).toISOString();
    render(<SlaCountdown startedAt={expired} slaHours={72} />);
    expect(screen.getByText('BREACHED')).toBeInTheDocument();
  });

  it('shows minutes only when less than 1 hour', () => {
    const almostExpired = new Date(Date.now() - 23.5 * 60 * 60 * 1000).toISOString();
    render(<SlaCountdown startedAt={almostExpired} slaHours={24} />);
    expect(screen.getByText(/m$/)).toBeInTheDocument();
  });
});
