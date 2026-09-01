# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability in the RIS Platform, please report it responsibly.

**Do NOT open a public GitHub issue for security vulnerabilities.**

Instead, email: **security@ris.ug**

Include:
- Description of the vulnerability
- Steps to reproduce
- Potential impact
- Suggested fix (if any)

## Response Timeline

- **Acknowledgement:** within 24 hours
- **Initial assessment:** within 72 hours
- **Fix timeline:** depends on severity (critical: 24h, high: 7 days, medium: 30 days)

## Supported Versions

| Version | Supported |
|---------|-----------|
| 1.0.x   | Yes       |
| < 1.0   | No        |

## Security Practices

The RIS Platform follows these security practices:

- **Authentication:** JWT with short-lived access tokens, httpOnly refresh cookies
- **Authorization:** Role-based access control (6 roles), enforced at API layer
- **Data protection:** AES-256-GCM encryption for all PII at rest
- **SQL injection:** Parameterised queries only (zero string concatenation)
- **Payment security:** Dual authorisation enforced at app + database trigger + provider
- **Logging:** No PII in logs (IDs and status values only)
- **Dependencies:** Regular audit via `npm audit`

## Disclosure Policy

We follow coordinated disclosure. We will:
1. Confirm the vulnerability
2. Develop and test a fix
3. Release the fix
4. Credit the reporter (unless they prefer anonymity)
