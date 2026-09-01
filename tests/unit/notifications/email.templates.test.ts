import {
  renderPasswordReset,
  renderInvoiceCreated,
  renderPaymentReceived,
  renderCollectionEscalation,
  renderWelcome,
} from '../../../src/services/notifications/email.templates';

// =========================================================================
// password_reset template
// =========================================================================

describe('renderPasswordReset', () => {
  const data = {
    token_url: 'https://app.mms.ug/reset-password?token=abc123',
    expiry_minutes: 60,
    user_name: 'John',
  };

  it('returns subject, html, and text fields', () => {
    const result = renderPasswordReset(data);
    expect(result).toHaveProperty('subject');
    expect(result).toHaveProperty('html');
    expect(result).toHaveProperty('text');
  });

  it('includes the reset URL in html and text', () => {
    const result = renderPasswordReset(data);
    expect(result.html).toContain(data.token_url);
    expect(result.text).toContain(data.token_url);
  });

  it('includes the user name', () => {
    const result = renderPasswordReset(data);
    expect(result.html).toContain('John');
    expect(result.text).toContain('John');
  });

  it('includes the expiry time', () => {
    const result = renderPasswordReset(data);
    expect(result.text).toContain('60 minutes');
  });

  it('sets subject line', () => {
    const result = renderPasswordReset(data);
    expect(result.subject).toContain('Password Reset');
  });

  it('html is a complete HTML document', () => {
    const result = renderPasswordReset(data);
    expect(result.html).toContain('<!DOCTYPE html>');
    expect(result.html).toContain('</html>');
  });

  it('uses fallback expiry of 60 when expiry_minutes is 0 (falsy)', () => {
    // Covers line 48 branch 1: `data.expiry_minutes || 60` — 0 is falsy
    const result = renderPasswordReset({ ...data, expiry_minutes: 0 });
    expect(result.text).toContain('60 minutes');
    expect(result.html).toContain('60 minutes');
  });

  it('uses fallback user name "User" when user_name is empty string (falsy)', () => {
    // Covers line 49 branch 1: `data.user_name || 'User'` — '' is falsy
    const result = renderPasswordReset({ ...data, user_name: '' });
    expect(result.html).toContain('Dear User,');
    expect(result.text).toContain('Dear User,');
  });

  it('uses provided expiry_minutes when non-zero (truthy path)', () => {
    const result = renderPasswordReset({ ...data, expiry_minutes: 30 });
    expect(result.text).toContain('30 minutes');
  });

  it('uses provided user_name when non-empty (truthy path)', () => {
    const result = renderPasswordReset({ ...data, user_name: 'Alice' });
    expect(result.text).toContain('Dear Alice,');
  });

  it('uses provided expiry_minutes directly when it is a positive number', () => {
    // Explicitly exercises `data.expiry_minutes || 60` truthy branch (branch 1):
    // when expiry_minutes=120, result is 120 (not the fallback 60)
    const result = renderPasswordReset({ ...data, expiry_minutes: 120 });
    expect(result.text).toContain('120 minutes');
    expect(result.html).toContain('120 minutes');
    expect(result.text).not.toContain('60 minutes');
  });

  it('uses provided user_name directly when it is a non-empty string', () => {
    // Explicitly exercises `data.user_name || 'User'` truthy branch (branch 1):
    // when user_name='Grace', result is 'Grace' (not the fallback 'User')
    const result = renderPasswordReset({ ...data, user_name: 'Grace' });
    expect(result.html).toContain('Dear Grace,');
    expect(result.text).toContain('Dear Grace,');
    expect(result.html).not.toContain('Dear User,');
  });
});

// =========================================================================
// invoice_created template
// =========================================================================

describe('renderInvoiceCreated', () => {
  const data = {
    invoice_number: 'INV-2024-001',
    amount: '5,000,000',
    buyer_name: 'Acme Corp',
    due_date: '2024-06-15',
  };

  it('returns subject, html, and text fields', () => {
    const result = renderInvoiceCreated(data);
    expect(result).toHaveProperty('subject');
    expect(result).toHaveProperty('html');
    expect(result).toHaveProperty('text');
  });

  it('includes invoice number in subject', () => {
    const result = renderInvoiceCreated(data);
    expect(result.subject).toContain('INV-2024-001');
  });

  it('includes UGX amount in subject', () => {
    const result = renderInvoiceCreated(data);
    expect(result.subject).toContain('UGX 5,000,000');
  });

  it('includes buyer name in body', () => {
    const result = renderInvoiceCreated(data);
    expect(result.html).toContain('Acme Corp');
    expect(result.text).toContain('Acme Corp');
  });

  it('includes due date in body', () => {
    const result = renderInvoiceCreated(data);
    expect(result.text).toContain('2024-06-15');
  });
});

// =========================================================================
// payment_received template
// =========================================================================

describe('renderPaymentReceived', () => {
  const data = {
    amount: '3,000,000',
    reference: 'PAY-REF-001',
    remaining_balance: '2,000,000',
  };

  it('returns subject, html, and text fields', () => {
    const result = renderPaymentReceived(data);
    expect(result).toHaveProperty('subject');
    expect(result).toHaveProperty('html');
    expect(result).toHaveProperty('text');
  });

  it('includes amount in subject', () => {
    const result = renderPaymentReceived(data);
    expect(result.subject).toContain('UGX 3,000,000');
  });

  it('includes reference in body', () => {
    const result = renderPaymentReceived(data);
    expect(result.text).toContain('PAY-REF-001');
  });

  it('includes remaining balance', () => {
    const result = renderPaymentReceived(data);
    expect(result.text).toContain('UGX 2,000,000');
  });
});

// =========================================================================
// collection_escalation template
// =========================================================================

describe('renderCollectionEscalation', () => {
  const data = {
    escalation_level: '2',
    amount_overdue: '10,000,000',
    days_overdue: 45,
    next_action: 'Legal action',
  };

  it('returns subject, html, and text fields', () => {
    const result = renderCollectionEscalation(data);
    expect(result).toHaveProperty('subject');
    expect(result).toHaveProperty('html');
    expect(result).toHaveProperty('text');
  });

  it('includes URGENT in subject', () => {
    const result = renderCollectionEscalation(data);
    expect(result.subject).toContain('URGENT');
  });

  it('includes escalation level', () => {
    const result = renderCollectionEscalation(data);
    expect(result.subject).toContain('Level 2');
  });

  it('includes overdue details in body', () => {
    const result = renderCollectionEscalation(data);
    expect(result.text).toContain('UGX 10,000,000');
    expect(result.text).toContain('45');
    expect(result.text).toContain('Legal action');
  });
});

// =========================================================================
// welcome template
// =========================================================================

describe('renderWelcome', () => {
  const data = {
    user_name: 'Jane Doe',
    login_url: 'https://app.mms.ug/login',
  };

  it('returns subject, html, and text fields', () => {
    const result = renderWelcome(data);
    expect(result).toHaveProperty('subject');
    expect(result).toHaveProperty('html');
    expect(result).toHaveProperty('text');
  });

  it('includes user name', () => {
    const result = renderWelcome(data);
    expect(result.html).toContain('Jane Doe');
    expect(result.text).toContain('Jane Doe');
  });

  it('includes login URL', () => {
    const result = renderWelcome(data);
    expect(result.html).toContain(data.login_url);
    expect(result.text).toContain(data.login_url);
  });

  it('includes Welcome in subject', () => {
    const result = renderWelcome(data);
    expect(result.subject).toContain('Welcome');
  });
});
