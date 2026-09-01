# Migration Guide

## Running Migrations

```bash
npm run migrate          # apply all pending
```

Migrations are in `src/shared/database/migrations/` numbered 001–030 (30 files; two files share prefix 023).

## Writing a New Migration

1. Use the next number: `031_your_description.sql`
2. Make it idempotent (`IF NOT EXISTS`, `ON CONFLICT DO NOTHING`)
3. For RLS policies use `DROP POLICY IF EXISTS ... ; CREATE POLICY ...` (not `CREATE POLICY IF NOT EXISTS`)
4. No string concatenation — static values only
5. Test on fresh AND existing databases

## Versioning Policy

RIS uses Semantic Versioning (MAJOR.MINOR.PATCH).

- MAJOR: breaking API or schema changes
- MINOR: new features, non-breaking additions
- PATCH: bug fixes, docs, performance

## Upgrade Steps

1. Read CHANGELOG.md for target version
2. Back up database
3. `git pull origin develop`
4. `npm install`
5. `npm run migrate`
6. `npm run test:unit`
7. Restart application
