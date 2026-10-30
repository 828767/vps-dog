/**
 * Ambient declaration that teaches the Workers runtime types about this
 * project's bindings.
 *
 * `cloudflare:test` types its exported `env` as the ambient `Cloudflare.Env`,
 * so the worker's own `Env` interface must be merged into it for tests to see
 * `env.DB` with the right type.
 */
import type { Env as WorkerEnv } from './types';

declare global {
  namespace Cloudflare {
    // eslint-disable-next-line @typescript-eslint/no-empty-object-type
    interface Env extends WorkerEnv {}
  }
}

export {};
