import { defineConfig } from 'vitest/config';
import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-pool-workers';

// NOTE: tests run against `wrangler.test.toml`, NOT the root `wrangler.toml`.
// The root config points `[assets].directory` at `web/dist`, which does not
// exist while only the worker is being developed; Miniflare refuses to boot
// with a missing assets directory. `wrangler.test.toml` is the same config with
// `[assets]` removed, so the suite never depends on the frontend build.
//
// `@cloudflare/vitest-pool-workers` 0.22 replaced `defineWorkersConfig()` with
// the `cloudflareTest()` Vite plugin, which takes the old
// `test.poolOptions.workers` object directly.
export default defineConfig(async () => {
  // Migrations are applied by `test/apply-migrations.ts`, a setup file that
  // runs inside the Workers runtime for every test (isolated storage resets
  // the database between tests, so the schema must be re-created each time).
  const migrations = await readD1Migrations('./migrations');

  return {
    plugins: [
      cloudflareTest({
        main: './src/index.ts',
        wrangler: { configPath: './wrangler.test.toml' },
        miniflare: {
          bindings: { TEST_MIGRATIONS: migrations },
        },
      }),
    ],
    test: {
      setupFiles: ['./test/apply-migrations.ts'],
    },
  };
});
