import path from 'pathe';
import type { Plugin, ResolvedConfig } from 'vite';
import { generateDts, parseMiddlewareFiles } from './utils';

/**
 * Plugin configuration options
 */
export type Options = {
  /**
   * Directory containing middleware files, relative to project root
   * @default 'src/middleware'
   */
  middlewareDir?: string;
  /**
   * Glob patterns to exclude from scanning
   * @default []
   */
  exclude?: string[];
  /**
   * Whether to automatically generate TypeScript declaration file.
   * Can be a boolean or a custom string path (relative or absolute).
   * @default true
   */
  dts?: boolean | string;
};

const VIRTUAL_MODULE_ID = 'virtual:vue-middleware';
const RESOLVED_VIRTUAL_MODULE_ID = '\0' + VIRTUAL_MODULE_ID;

/**
 * Vite Plugin: Vue Middleware
 * @description Type-safe navigation middleware for Vue Router with virtual module and HMR support
 * @param {Partial<Options>} options - Plugin configuration options
 * @returns {Plugin}
 */
export function vueMiddleware(options: Partial<Options> = {}): Plugin {
  const { middlewareDir = 'src/middleware', dts = true, exclude = [] } = options;

  let viteConfig: ResolvedConfig;
  let pathsPromise: Promise<{ resolvedDir: string; resolvedDtsPath?: string }> | null = null;

  /**
   * Initialize and cache plugin-required paths
   * @description Lazily resolves middleware directory and d.ts output path based on config (follows EAFP)
   * @returns {Promise<{ resolvedDir: string; resolvedDtsPath?: string }>}
   */
  async function initPaths() {
    if (pathsPromise) return pathsPromise;
    pathsPromise = (async () => {
      const root = viteConfig.root;
      const resolvedDir = path.resolve(root, middlewareDir);
      let resolvedDtsPath: string | undefined;

      if (dts) {
        if (typeof dts === 'string') {
          resolvedDtsPath = path.resolve(root, dts);
        } else {
          // Default to project root
          resolvedDtsPath = path.resolve(root, 'middleware.d.ts');
        }
      }

      return { resolvedDir, resolvedDtsPath };
    })();
    return pathsPromise;
  }

  return {
    name: 'vite-plugin-vue-middleware',

    configResolved(config) {
      viteConfig = config;
    },

    async buildStart() {
      const { resolvedDir, resolvedDtsPath } = await initPaths();
      // Ensure type declarations are generated or updated at build start
      if (dts) {
        const files = await parseMiddlewareFiles(resolvedDir, exclude);
        if (resolvedDtsPath) {
          await generateDts(files, resolvedDtsPath);
        }
      }
    },

    resolveId(id: string) {
      if (id === VIRTUAL_MODULE_ID) {
        return RESOLVED_VIRTUAL_MODULE_ID;
      }
    },

    async load(id: string) {
      if (id === RESOLVED_VIRTUAL_MODULE_ID) {
        const { resolvedDir } = await initPaths();
        const files = await parseMiddlewareFiles(resolvedDir, exclude);

        let code = 'import { setupMiddleware as _setup } from "vite-plugin-vue-middleware/runtime";\n';
        code += 'export { defineMiddleware } from "vite-plugin-vue-middleware/runtime";\n\n';

        const globalImports: string[] = [];
        const namedImports: string[] = [];

        files.forEach((file, index) => {
          const importName = `__middleware_${index}`;
          code += `import ${importName} from "${file.path}";\n`;
          if (file.isGlobal) {
            globalImports.push(importName);
          } else {
            namedImports.push(`"${file.name}": ${importName}`);
          }
        });

        code += `\nexport const globalMiddleware = [${globalImports.join(', ')}];\n`;
        code += `export const namedMiddleware = { ${namedImports.join(', ')} };\n`;
        code += `export const setupMiddleware = (router) => _setup(router, globalMiddleware, namedMiddleware);\n`;

        return code;
      }
    },

    configureServer(server) {
      const _handleFileChange = async (file: string) => {
        const { resolvedDir, resolvedDtsPath } = await initPaths();
        // pathe uses posix separators by default
        const normalizedFile = path.normalize(file);
        const normalizedDir = path.normalize(resolvedDir);

        if (normalizedFile.startsWith(normalizedDir)) {
          // Regenerate type definition file
          if (dts && resolvedDtsPath) {
            const files = await parseMiddlewareFiles(resolvedDir, exclude);
            await generateDts(files, resolvedDtsPath);
          }

          // Invalidate virtual module
          const mod = server.moduleGraph.getModuleById(RESOLVED_VIRTUAL_MODULE_ID);
          if (mod) {
            server.moduleGraph.invalidateModule(mod);
          }

          // Trigger full reload to ensure runtime state stays in sync
          server.ws.send({ type: 'full-reload' });
        }
      };

      server.watcher.on('add', _handleFileChange);
      server.watcher.on('unlink', _handleFileChange);
    },
  };
}
