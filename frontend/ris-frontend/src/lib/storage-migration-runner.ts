/**
 * Side-effect entry that runs the `mms-*` → `ris-*` storage migration at
 * module-evaluation time. Importing this file (without using its exports)
 * guarantees the migration completes before any subsequently-imported
 * Zustand store reads its persisted state.
 *
 * See `./storage-migration.ts` for the migration logic.
 */
import { runStorageMigration } from './storage-migration';

runStorageMigration();
