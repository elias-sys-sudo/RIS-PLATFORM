# auth/ — Security-Critical Patterns

> Every mistake here is a security vulnerability.

---

## Token Architecture

```
Access token:  JWT, signed with JWT_SECRET, expires in JWT_EXPIRY (15m)
Refresh token: random 64-byte hex string, hashed with SHA-256 before DB storage
```

- Access tokens verified by signature only — zero DB lookup per request
- Refresh tokens: look up by hash, check `revoked_at IS NULL`, check `expires_at > NOW()`
- On refresh: issue new access token + rotate refresh token (invalidate old one immediately)
- On logout: set `revoked_at = NOW()` — never DELETE refresh token rows (audit trail)

---

## Startup Validation — Server Must Refuse to Start

```typescript
// Validate at module load time, before any requests
const jwtSecret = process.env.JWT_SECRET ?? '';
if (Buffer.from(jwtSecret).length < 32) {
  throw new Error('JWT_SECRET must be at least 256 bits (32 bytes). Server will not start.');
}
```

❌ WRONG — deferring validation until a request arrives:
```typescript
export function signToken(payload: object): string {
  const secret = process.env.JWT_SECRET; // undefined in prod → silent failure
  return jwt.sign(payload, secret!);
}
```

---

## Password Handling

```typescript
// Hash on registration / password change
const hash = await bcrypt.hash(password, 12); // cost factor ≥ 12

// Verify on login
const valid = await bcrypt.compare(password, storedHash);
```

❌ WRONG — anything other than bcrypt compare:
```typescript
if (user.password === password) { ... }              // plaintext compare
if (sha256(password) === user.password) { ... }      // wrong algorithm
if (password === decrypt(user.password)) { ... }     // AES is not a password hash
```

---

## Login Failure — Never Reveal Whether Email Exists

```typescript
// ✅ CORRECT — same error, same timing for both cases
const user = await repo.findByEmail(email);
if (!user) {
  await bcrypt.compare(password, '$2b$12$invalidhashfortimingnormalization');
  throw new AuthError('Invalid credentials');
}
const valid = await bcrypt.compare(password, user.passwordHash);
if (!valid) throw new AuthError('Invalid credentials');
```

❌ WRONG — account enumeration vulnerability:
```typescript
if (!user) throw new AuthError('Email not found');      // reveals account existence
if (!user) throw new NotFoundError('User not found');   // same problem
```

The `bcrypt.compare` dummy call is required even when user is not found, to equalise response time and prevent timing-based user enumeration.

---

## Rate Limiting — Auth Endpoints Only

Apply `rateLimitMiddleware` before `authMiddleware` on:
- `POST /auth/login`
- `POST /auth/refresh`
- `POST /auth/register`
- `POST /auth/forgot-password`

Config from env:
```
RATE_LIMIT_AUTH_MAX=10         # requests per window
RATE_LIMIT_AUTH_WINDOW_MS=900000  # 15 minutes
```

After limit exceeded: `429 Too Many Requests`. Log `RATE_LIMIT_EXCEEDED` to audit_logs with IP address (IP is not PII).

---

## Session Cookie — Browser Clients Only

```typescript
res.cookie('refreshToken', token, {
  httpOnly: true,                               // no JS access
  secure: process.env.NODE_ENV === 'production', // HTTPS only in prod
  sameSite: 'strict',                           // CSRF protection
  maxAge: 7 * 24 * 60 * 60 * 1000,            // 7 days in ms
});
```

❌ WRONG — returning refresh token in JSON body (logged by reverse proxies, visible in browser network tab):
```typescript
res.json({ accessToken, refreshToken }); // ← refreshToken must NOT be in body
```

---

## What auth/ Owns vs What It Does Not Own

| auth/ OWNS | auth/ does NOT own |
|---|---|
| JWT sign/verify | Role assignment (management does this) |
| Refresh token lifecycle | KYC / identity verification (onboarding) |
| Password hash/verify | MFA device management (settings) |
| Session revocation | User profile data (onboarding) |
| Rate limiting | Supplier/buyer onboarding flow |

❌ WRONG — adding business logic to auth module:
```typescript
// auth.service.ts — fetching invoice data during login
const invoices = await invoiceRepo.getBySupplier(user.id); // not auth's concern
```
