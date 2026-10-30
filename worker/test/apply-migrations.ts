/**
 * Test setup: apply the D1 migrations before each test file runs.
 *
 * Runs inside the Workers runtime. `TEST_MIGRATIONS` is injected by
 * `vitest.config.ts` via `readD1Migrations('./migrations')`.
 */
import { applyD1Migrations, env } from 'cloudflare:test';
import type { MigrationEntry } from '../src/types';

const migrations = (env as unknown as { TEST_MIGRATIONS?: MigrationEntry[] }).TEST_MIGRATIONS ?? [];

await applyD1Migrations(env.DB, migrations);
