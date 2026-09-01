# onboarding/ — KYC & Registration Module

> Most PII-intensive module in the system. Every field that identifies a person or company must be encrypted before storage.

---

## PII Fields — Encrypt ALL of These Before INSERT

```typescript
import { encrypt, hashDocument } from '../../shared/crypto';

// Supplier registration — fields to encrypt:
const encryptedBankAccNum  = encrypt(data.bank_account_number);
const encryptedBankAccName = encrypt(data.bank_account_name);
const encryptedMoMo        = data.mobile_money_number
  ? encrypt(data.mobile_money_number)
  : null;

// Contact details (phone) encrypted:
const encryptedPhone       = encrypt(data.phone);

// Company name: store BOTH plaintext (display-source) AND encrypted
// (legacy / audit redundancy). Company names are publicly searchable in
// the Uganda URSB registry — encrypting them was compliance theatre that
// broke every list view that JOINs to suppliers. Plaintext is the
// canonical display source; encrypted column is kept for back-compat.
const encryptedCompanyName = encrypt(data.company_name);
const plaintextCompanyName = data.company_name; // → suppliers.company_name
// Email stored as lowercase hash for lookup + encrypted value for display:
const emailHash            = crypto.createHash('sha256').update(data.email.toLowerCase()).digest('hex');
const encryptedEmail       = encrypt(data.email);
```

Fields that do NOT need encryption: `user_id` (UUID), `kyc_status` (enum), `registration_number` (needed for duplicate check as plaintext hash), `created_at`.

---

## Document Upload Rules — Enforced Before Storage

```typescript
const ALLOWED_MIME_TYPES = ['application/pdf', 'image/jpeg', 'image/png'];
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB

// Validate before saving:
if (!ALLOWED_MIME_TYPES.includes(file.mimetype)) {
  throw new ValidationError('Only PDF, JPEG, and PNG documents are accepted');
}
if (file.size > MAX_FILE_SIZE) {
  throw new ValidationError('Document size must not exceed 10 MB');
}
```

Document content is encrypted on disk using `hashDocument()` from `shared/crypto`:
```typescript
const documentHash = hashDocument(fileBuffer); // SHA-256 of file content — for integrity check
const encrypted = encrypt(fileBuffer.toString('base64')); // encrypted content stored
```

Upload directory: `uploads/documents/` (relative to project root). Files stored as `{uuid}.enc`.

---

## Required Document Types — KYC Cannot Be Approved Without All Four

```typescript
const REQUIRED_DOC_TYPES = [
  'CERTIFICATE_OF_INCORPORATION',
  'TAX_REGISTRATION',           // TIN certificate from URA
  'DIRECTOR_ID',                // National ID or passport
  'SIGNED_SUPPLIER_AGREEMENT',  // RIS legal agreement, signed
];

// Before approving KYC:
const submitted = await repo.getDocumentTypes(supplierId);
const missing = REQUIRED_DOC_TYPES.filter(t => !submitted.includes(t));
if (missing.length > 0) {
  throw new BusinessRuleError('KYC_DOCUMENTS_INCOMPLETE',
    `Missing required documents: ${missing.join(', ')}`
  );
}
```

---

## KYC Status Flow

```
pending → under_review → approved
pending → under_review → rejected  (can re-submit documents → back to under_review)
```

Only `compliance_officer` can transition `under_review → approved/rejected`.
`under_review` is set automatically when all 4 required documents are uploaded.

```typescript
// Status transitions owned by onboarding:
pending → under_review     // auto: triggered when all required docs submitted
under_review → approved    // compliance_officer only
under_review → rejected    // compliance_officer only (with rejection reason)
rejected → under_review    // supplier re-submits documents
```

❌ WRONG — supplier self-approving KYC:
```typescript
router.post('/kyc/approve', authMiddleware, requireRole(['supplier']), ...); // supplier cannot approve own KYC
```

---

## Duplicate Prevention — Uniqueness Checks Before Creating

```typescript
// Email uniqueness (check before any PII is encrypted):
const exists = await repo.emailExists(data.email); // uses email hash, not plaintext
if (exists) throw new BusinessRuleError('EMAIL_TAKEN', '...');

// Company registration number uniqueness:
const regExists = await repo.registrationNumberExists(data.registration_number);
if (regExists) throw new BusinessRuleError('REGISTRATION_NUMBER_TAKEN', '...');
```

---

## Sanctions Screening — Required for Buyers

Before creating a buyer record, screen against the Uganda sanctions list:

```typescript
const sanctionsResult = await screenAgainstSanctionsList(data.company_name, data.tin);
if (sanctionsResult.matched) {
  await repo.createAuditEntry(null, 'SANCTIONS_MATCH', 'buyers', buyerId,
    null, { matchedEntry: sanctionsResult.matchedId } // no PII — use ID
  );
  throw new BusinessRuleError('SANCTIONS_MATCH', 'Buyer failed sanctions screening');
}
```

Sanctions screening is performed at buyer creation only. Re-screen is a manual compliance operation.

---

## Password — Bcrypt at Exactly 12 Rounds

```typescript
const BCRYPT_ROUNDS = 12;
const passwordHash = await bcrypt.hash(data.password, BCRYPT_ROUNDS);
```

Do not change this value without a migration plan — existing hashes use 12 rounds and cannot be compared against a different cost factor.
