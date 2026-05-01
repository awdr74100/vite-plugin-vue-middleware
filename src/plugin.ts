import path from 'pathe';
import type { Plugin, ResolvedConfig } from 'vite';

import {
  PLUGIN_NAME,
  RESOLVED_VIRTUAL_MODULE_ID,
  RUNTIME_IMPORT_PATH,
  VIRTUAL_MODULE_ID,
} from './constants';
import { generateDts } from './dts';
import type { MiddlewareFile } from './parse';
import { parseMiddlewareFiles } from './parse';
import type { ParsedNode } from './transform';
import { transformAsyncMiddleware } from './transform';

/** Plugin configuration options */
export type Options = {
  /**
   * Directory containing middleware files, relative to project root.
   *
   * @default 'src/middleware'
   */
  middlewareDir?: string;
  /**
   * Glob patterns to exclude from scanning.
   *
   * @default [ ]
   */
  exclude?: string[];
  /**
   * Whether to automatically generate the TypeScript declaration file. Can be a boolean or a custom
   * string path (relative to project root, or absolute).
   *
   * @default true
   */
  dts?: boolean | string;
  /**
   * Preserve Vue injection context (`inject()`) across `await` boundaries in middleware files.
   *
   * When enabled, async middleware functions are automatically transformed at build time so that
   * `inject()` and composables relying on it (e.g. `useQueryClient()`) continue to work after
   * `await` statements.
   *
   * @default true
   */
  asyncContext?: boolean;
};

const DEFAULT_MIDDLEWARE_DIR = 'src/middleware';
const DEFAULT_DTS_PATH = 'middleware.d.ts';
const SCRIPT_FILE_RE = /\.[jt]sx?$/;
const DTS_REGEN_DEBOUNCE_MS = 50;

/**
 * Vite Plugin: Vue Middleware
 *
 * Type-safe navigation middleware for Vue Router with virtual module and HMR support.
 */
export function vueMiddleware(options: Partial<Options> = {}): Plugin {
  const {
    middlewareDir = DEFAULT_MIDDLEWARE_DIR,
    dts = true,
    exclude = [],
    asyncContext = true,
  } = options;

  let viteConfig: ResolvedConfig;
  let resolvedDir = '';
  let normalizedDir = '';
  let resolvedDtsPath: string | undefined;
  let dtsRegenTimer: ReturnType<typeof setTimeout> | null = null;

  /** Lazily compute the absolute middleware-dir / dts-path the first time we have a config */
  function ensurePathsResolved(): void {
    if (resolvedDir) return;
    const root = viteConfig.root;
    resolvedDir = path.resolve(root, middlewareDir);
    normalizedDir = path.normalize(resolvedDir);
    if (dts) {
      resolvedDtsPath =
        typeof dts === 'string' ? path.resolve(root, dts) : path.resolve(root, DEFAULT_DTS_PATH);
    }
  }

  /**
   * Path-prefix check that respects path-component boundaries — `middleware-extra/foo.ts` should
   * NOT be considered "inside" `middleware/`.
   */
  function isInsideMiddlewareDir(file: string): boolean {
    const normalizedFile = path.normalize(file);
    if (normalizedFile === normalizedDir) return true;
    if (!normalizedFile.startsWith(normalizedDir)) return false;
    const next = normalizedFile.charAt(normalizedDir.length);
    return next === '/' || next === '\\';
  }

  async function regenerateDts(): Promise<void> {
    if (!dts || !resolvedDtsPath) return;
    const files = await parseMiddlewareFiles(resolvedDir, exclude);
    await generateDts(files, resolvedDtsPath);
  }

  function buildVirtualModule(files: MiddlewareFile[]): string {
    const lines: string[] = [];
    lines.push(`import { setupMiddleware as _setup } from "${RUNTIME_IMPORT_PATH}";`);
    lines.push(`export { defineMiddleware } from "${RUNTIME_IMPORT_PATH}";`);
    lines.push('');

    const globalImports: string[] = [];
    const namedImports: string[] = [];

    files.forEach((file, index) => {
      const importName = `__middleware_${index}`;
      lines.push(`import ${importName} from ${JSON.stringify(file.path)};`);
      if (file.isGlobal) {
        globalImports.push(importName);
      } else {
        namedImports.push(`${JSON.stringify(file.name)}: ${importName}`);
      }
    });

    lines.push('');
    lines.push(`export const globalMiddleware = [${globalImports.join(', ')}];`);
    // `Object.assign(Object.create(null), { ... })` keeps an object literal initialiser while
    // avoiding prototype pollution if a middleware happens to be named `__proto__` etc.
    lines.push(
      `export const namedMiddleware = /*#__PURE__*/ Object.assign(Object.create(null), { ${namedImports.join(', ')} });`,
    );
    lines.push(
      `export const setupMiddleware = (router) => _setup(router, globalMiddleware, namedMiddleware);`,
    );
    lines.push('');

    return lines.join('\n');
  }

  return {
    name: PLUGIN_NAME,

    configResolved(config) {
      viteConfig = config;
      ensurePathsResolved();
    },

    async buildStart() {
      // Ensure type declarations are generated or updated at build start
      await regenerateDts();
    },

    resolveId(id) {
      if (id === VIRTUAL_MODULE_ID) {
        return RESOLVED_VIRTUAL_MODULE_ID;
      }
    },

    async load(id) {
      if (id !== RESOLVED_VIRTUAL_MODULE_ID) return;
      const files = await parseMiddlewareFiles(resolvedDir, exclude);
      return buildVirtualModule(files);
    },

    transform(code, id) {
      if (!asyncContext) return;

      // Strip query string — Vite occasionally suffixes ids (e.g. `?vue&type=script`); the
      // extension regex would otherwise miss them.
      const cleanId = id.split('?', 1)[0];

      if (!isInsideMiddlewareDir(cleanId)) return;
      if (!SCRIPT_FILE_RE.test(cleanId)) return;

      return transformAsyncMiddleware(code, (c) => (this as any).parse(c) as ParsedNode);
    },

    configureServer(server) {
      const handleStructureChange = (file: string): void => {
        if (!isInsideMiddlewareDir(file)) return;

        // Debounce dts regeneration — bursts of fs events (`git checkout`, IDE batch saves) would
        // otherwise re-render the file many times.
        if (dts && resolvedDtsPath) {
          if (dtsRegenTimer) clearTimeout(dtsRegenTimer);
          dtsRegenTimer = setTimeout(() => {
            dtsRegenTimer = null;
            regenerateDts().catch((err) => {
              server.config.logger.error(
                `[${PLUGIN_NAME}] failed to regenerate dts: ${(err as Error).message}`,
              );
            });
          }, DTS_REGEN_DEBOUNCE_MS);
        }

        // Invalidate virtual module so the next load() picks up the new file list
        const mod = server.moduleGraph.getModuleById(RESOLVED_VIRTUAL_MODULE_ID);
        if (mod) {
          server.moduleGraph.invalidateModule(mod);
        }

        // Trigger full reload to ensure runtime state stays in sync
        server.ws.send({ type: 'full-reload' });
      };

      server.watcher.on('add', handleStructureChange);
      server.watcher.on('unlink', handleStructureChange);
    },
  };
}
