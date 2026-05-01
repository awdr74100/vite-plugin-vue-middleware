# AGENTS.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

`vite-plugin-vue-middleware` — a Vite plugin that scans a directory of middleware files and exposes them through the virtual module `virtual:vue-middleware`, with auto-generated `.d.ts` for type-safe `RouteMeta.middleware`. Published as a library; the repo is a pnpm workspace whose `playground/` package consumes the plugin via `workspace:*`.

## Commands

All commands are run from the repo root unless noted.

- `pnpm build` — bundle `src/index.ts` and `src/runtime.ts` to ESM + CJS via tsdown (output: `dist/`).
- `pnpm dev` — `tsdown --watch` for library development.
- `pnpm test` — run Vitest (node env, globals enabled). Run a single file with `pnpm test test/transform.spec.ts`; a single test with `pnpm test -t "should transform async arrow"`.
- `pnpm typecheck` — `tsc --noEmit` against `src/`.
- `pnpm lint` / `pnpm lint:fix` — oxlint.
- `pnpm format` / `pnpm format:check` — oxfmt.
- `pnpm knip` — unused-export check; **requires `pnpm build` first** (CI runs build before knip).
- `pnpm release` — bumpp-driven version + tag; `prepublishOnly` rebuilds.
- Playground: `cd playground && pnpm dev` to exercise the plugin end-to-end.

CI (`.github/workflows/ci.yml`) runs lint, typecheck, test, and knip in parallel on every push/PR.

## Architecture

The plugin has three layers that should not be conflated:

### 1. Build-time plugin (`src/plugin.ts`)
The Vite `Plugin` object — owns config, virtual-module resolution, dts generation, and the async-context transform hook. Key behaviors:
- **Path resolution is lazy**: `ensurePathsResolved()` runs on `configResolved` because `middlewareDir` and the dts path are resolved against `viteConfig.root`.
- **Containment check**: `isInsideMiddlewareDir()` does a path-component-aware prefix match — `middleware-extra/foo.ts` must NOT be considered "inside" `middleware/`.
- **HMR**: `configureServer` listens for `add`/`unlink` (not `change` — file content edits don't change the dts), debounces dts regen at 50 ms to absorb `git checkout` bursts, invalidates the virtual module, and triggers a full reload.
- **Virtual module output** uses `Object.assign(Object.create(null), {...})` for `namedMiddleware` to avoid prototype pollution (a middleware named `__proto__` would otherwise be dangerous).

### 2. Runtime (`src/runtime.ts`)
Shipped as a separate entry (`vite-plugin-vue-middleware/runtime`) so user code and transformed middleware can both import from it without pulling in the build-time plugin.
- `setupMiddleware` wraps `router.install` to capture the `App` instance, then registers a `beforeEach` that runs global middleware first, then route-meta-named middleware. Each call goes through `app.runWithContext()` so `inject()` works at the top of the body.
- `consumeResult()` defines the contract: `undefined`/`true` → continue; `false` → abort; `Error` instance → reject; anything else → treat as redirect target. The internal `CONTINUE` sentinel must not leak.
- `__executeMiddleware` is the generator-based executor that `transform.ts` wraps async middleware in. **Internal API** — typed in `client.d.ts` with an `@internal` marker. Each `next()`/`throw()` runs inside `app.runWithContext()` so `inject()` is available on every segment after `await`.

### 3. Async-context transform (`src/transform.ts`)
Vite `transform` hook applied only to script files inside the middleware dir. Detects `defineMiddleware(async ...)` call sites, converts the async function to a generator (`await` → `yield`, `async` arrow → `function*`, etc.), and wraps with `__executeMiddleware`. Subtleties baked into the code:
- **Bare-identifier params** (`async to => ...`): generators reject this, so synthesise parens.
- **Expression-body arrows**: wrap in `{ return ... }` — wrap the entire post-`=>` region (not just the body node) so `=> (await foo())` stays balanced.
- **Nested async functions**: `collectTopLevelAwaits` and `containsForAwait` skip into them; their `await`s remain untouched.
- **Bailouts**: `for await...of` (warn + leave alone), `async function*` (cannot flatten), no-await async fn (nothing to do). The fast bailout `!code.includes('await')` runs before parsing.
- The plugin passes Rollup's `this.parse` as the parser — tests use `acorn` directly with the same ESTree shape.

### Cross-cutting

- `RUNTIME_IMPORT_PATH` (`vite-plugin-vue-middleware/runtime`) is the single source of truth for the runtime entry — both `plugin.ts` (virtual module) and `transform.ts` (injected import) emit it. Keep these aligned with `package.json#exports`.
- `client.d.ts` declares `virtual:vue-middleware` for user-land TS; the **generated** dts (default `middleware.d.ts`) augments `vue-router`'s `RouteMeta`. Both must be kept in sync with the runtime's exported shape.
- File naming rules in `parse.ts`: `.global` suffix → `isGlobal`; leading `\d+\.` on the basename → `order` (lower runs first); nested paths join with `-` (`nested/logger.ts` → `nested-logger`). Sort is `order` ascending, then `name` as tie-breaker for determinism.
- `dts.ts` skips writing when on-disk content is byte-identical — this avoids spurious TS-server reloads in editors during HMR.

## Tooling notes

- **Package manager**: pnpm 10 (pinned via `packageManager`). Workspace defined in `pnpm-workspace.yaml` (`playground`, future `docs`, `packages/*`, `examples/*`).
- **Bundler**: tsdown (Rolldown-powered). Config bundles `src/index.ts` + `src/runtime.ts` only; `deps.skipNodeModulesBundle: true` keeps deps external.
- **Linter/formatter**: oxlint + oxfmt (not ESLint/Prettier). cspell wordlist lives in `.cspell.json`.
- **Tests**: Vitest with `environment: 'node'` and `globals: true` — `describe`/`it`/`expect` are global, no per-file imports needed (existing tests still import explicitly; either is fine).
