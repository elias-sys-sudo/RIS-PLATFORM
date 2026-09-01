import {
  renderPaymentReminder,
  renderPaymentConfirmation,
  renderEscalationNotice,
} from '../../../src/services/notifications/sms.templates';

const SMS_MAX_LENGTH = 160;

// =========================================================================
// payment_reminder template
// =========================================================================

describe('renderPaymentReminder', () => {
  const data = {
    name: 'John',
    amount: '5,000,000',
    invoice_no: 'INV-001',
    days: 15,
    paybill: '123456',
    ref: 'REF-001',
  };

  it('returns a message string', () => {
    const result = renderPaymentReminder(data);
    expect(result).toHaveProperty('message');
    expect(typeof result.message).toBe('string');
  });

  it('includes key data in message', () => {
    const result = renderPaymentReminder(data);
    expect(result.message).toContain('John');
    expect(result.message).toContain('5,000,000');
    expect(result.message).toContain('INV-001');
  });

  it('does not exceed 160 characters', () => {
    const result = renderPaymentReminder(data);
    expect(result.message.length).toBeLessThanOrEqual(SMS_MAX_LENGTH);
  });

  it('truncates long messages with ellipsis', () => {
    const longData = {
      ...data,
      name: 'A Very Long Name That Will Push The Message Over The Limit',
      invoice_no: 'INV-2024-VERY-LONG-NUMBER-001',
      paybill: 'VERY-LONG-PAYBILL-NUMBER-12345',
      ref: 'REF-VERY-LONG-REFERENCE-001',
    };
    const result = renderPaymentReminder(longData);
    expect(result.message.length).toBeLessThanOrEqual(SMS_MAX_LENGTH);
    expect(result.message).toMatch(/\.\.\.$/);
  });
});

// =========================================================================
// payment_confirmation template
// =========================================================================

describe('renderPaymentConfirmation', () => {
  const data = {
    amount: '3,000,000',
    ref: 'PAY-REF-001',
    balance: '2,000,000',
  };

  it('returns a message string', () => {
    const result = renderPaymentConfirmation(data);
    expect(result).toHaveProperty('message');
  });

  it('includes amount and reference', () => {
    const result = renderPaymentConfirmation(data);
    expect(result.message).toContain('3,000,000');
    expect(result.message).toContain('PAY-REF-001');
  });

  it('includes balance', () => {
    const result = renderPaymentConfirmation(data);
    expect(result.message).toContain('2,000,000');
  });

  it('does not exceed 160 characters', () => {
    const result = renderPaymentConfirmation(data);
    expect(result.message.length).toBeLessThanOrEqual(SMS_MAX_LENGTH);
  });

  it('includes thank you', () => {
    const result = renderPaymentConfirmation(data);
    expect(result.message).toContain('Thank you');
  });
});

// =========================================================================
// escalation_notice template
// =========================================================================

describe('renderEscalationNotice', () => {
  const data = {
    invoice_no: 'INV-002',
    days: 30,
    amount: '10,000,000',
    contact: '+256700123456',
  };

  it('returns a message string', () => {
    const result = renderEscalationNotice(data);
    expect(result).toHaveProperty('message');
  });

  it('includes URGENT prefix', () => {
    const result = renderEscalationNotice(data);
    expect(result.message).toContain('URGENT');
  });

  it('includes invoice and amount details', () => {
    const result = renderEscalationNotice(data);
    expect(result.message).toContain('INV-002');
    expect(result.message).toContain('10,000,000');
  });

  it('includes contact info', () => {
    const result = renderEscalationNotice(data);
    expect(result.message).toContain('+256700123456');
  });

  it('does not exceed 160 characters', () => {
    const result = renderEscalationNotice(data);
    expect(result.message.length).toBeLessThanOrEqual(SMS_MAX_LENGTH);
  });
});
