export interface PasswordValidation {
  valid:    boolean;
  errors:   string[];
  strength: 'weak' | 'fair' | 'strong' | 'very-strong';
}

/**
 * Validates a password against RIS security requirements.
 * Returns a structured result with per-rule errors and an overall strength rating.
 */
export function validatePassword(password: string): PasswordValidation {
  const errors: string[] = [];

  if (password.length < 8)            errors.push('At least 8 characters required');
  if (!/[A-Z]/.test(password))        errors.push('At least one uppercase letter required');
  if (!/[a-z]/.test(password))        errors.push('At least one lowercase letter required');
  if (!/[0-9]/.test(password))        errors.push('At least one number required');
  if (!/[^A-Za-z0-9]/.test(password)) errors.push('At least one special character required');

  let score = 0;
  if (password.length >= 8)            score++;
  if (password.length >= 12)           score++;
  if (/[A-Z]/.test(password))          score++;
  if (/[a-z]/.test(password))          score++;
  if (/[0-9]/.test(password))          score++;
  if (/[^A-Za-z0-9]/.test(password))  score++;

  const strength: PasswordValidation['strength'] =
    score <= 2 ? 'weak'
    : score <= 3 ? 'fair'
    : score <= 4 ? 'strong'
    : 'very-strong';

  return { valid: errors.length === 0, errors, strength };
}
