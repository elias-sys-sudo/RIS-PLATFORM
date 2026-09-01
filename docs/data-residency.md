# Data Residency Policy -- RIS Platform

## Hosting Location

- Primary database: [Document actual hosting location]
- Application servers: [Document actual hosting location]
- Redis cache: [Document actual hosting location]
- Backup storage: [Document actual hosting location]

## Data Classification

- **PII (Personal Identifiable Information)**: Encrypted at application layer (AES-256-GCM) before storage. Fields: names, phone numbers, bank accounts, ID numbers.
- **Financial data**: Invoice amounts, payment records, facility balances. Stored as BIGINT. Not encrypted (non-PII).
- **Audit logs**: Immutable, 7-year retention. Contains action IDs, timestamps, IP addresses. No PII.

## Cross-Border Data Transfer

- All PII must remain within Uganda/East Africa Community unless:
  1. Data Protection Authority (PDPO) has been notified
  2. Standard Contractual Clauses are in place with the data processor
  3. Transfer is documented in the Data Processing Agreement

## Compliance

- Uganda Personal Data Protection Act (PDPA) 2019
- Bank of Uganda data handling guidelines
- Financial Intelligence Authority (FIA) record retention requirements

## Review Schedule

- This policy is reviewed quarterly by the Compliance Officer
- Last reviewed: [DATE]
- Next review: [DATE + 3 months]
