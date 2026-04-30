import MagicString from 'magic-string';
import path from 'pathe';
import type { Plugin, ResolvedConfig } from 'vite';

import { generateDts, parseMiddlewareFiles } from './utils';

/** Plugin configuration options */
export type Options = {
  /**
   * Directory containing middleware files, relative to project root
   *
   * @default 'src/middleware'
   */
  middlewareDir?: string;
  /**
   * Glob patterns to exclude from scanning
   *
   * @default [ ]
   */
  exclude?: string[];
  /**
   * Whether to automatically generate TypeScript declaration file. Can be a boolean or a custom
   * string path (relative or absolute).
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

const VIRTUAL_MODULE_ID = 'virtual:vue-middleware';
const RESOLVED_VIRTUAL_MODULE_ID = '\0' + VIRTUAL_MODULE_ID;

// ---------------------------------------------------------------------------
// AST helpers for the async-context transform
// ---------------------------------------------------------------------------

/** Minimal ESTree node shape returned by Rollup's `this.parse()` */
interface AstNode {
  type: string;
  start: number;
  end: number;
  async?: boolean;
  body?: AstNode | AstNode[];
  params?: AstNode[];
  argument?: AstNode;
  callee?: AstNode & { name?: string };
  arguments?: AstNode[];
  [key: string]: unknown;
}

/**
 * Walk an ESTree-compatible AST, calling `onEnter` for every node. Return `false` from `onEnter` to
 * skip that node's children.
 */
function walkAst(
  node: AstNode,
  onEnter: (n: AstNode) => void | false,
  visited = new Set<any>(),
): void {
  if (!node || typeof node !== 'object' || visited.has(node)) return;
  visited.add(node);
  if (onEnter(node) === false) return;

  for (const key of Object.keys(node)) {
    if (key === 'type' || key === 'start' || key === 'end') continue;
    const child = (node as any)[key];
    if (Array.isArray(child)) {
      for (const item of child) {
        if (item && typeof item === 'object' && typeof (item as AstNode).type === 'string') {
          walkAst(item as AstNode, onEnter, visited);
        }
      }
    } else if (child && typeof child === 'object' && typeof (child as AstNode).type === 'string') {
      walkAst(child as AstNode, onEnter, visited);
    }
  }
}

/**
 * Collect all top-level `AwaitExpression` nodes inside `root`, skipping any nested async functions
 * (arrow, expression, or declaration).
 */
function collectTopLevelAwaits(root: AstNode): AstNode[] {
  const awaits: AstNode[] = [];

  walkAst(root, (node) => {
    // Skip nested async functions — their awaits belong to a different context
    if (
      node !== root &&
      (node.type === 'ArrowFunctionExpression' ||
        node.type === 'FunctionExpression' ||
        node.type === 'FunctionDeclaration') &&
      node.async
    ) {
      return false;
    }
    if (node.type === 'AwaitExpression') {
      awaits.push(node);
    }
  });

  return awaits;
}

/**
 * Apply the async → generator transform to a middleware source file.
 *
 * Looks for `defineMiddleware(async ...)` call sites, converts the async function to a generator
 * (`await` → `yield`), and wraps it with the runtime `__executeMiddleware` executor so that each
 * generator segment runs inside `app.runWithContext()`.
 *
 * @returns `{ code, map }` if the file was transformed, or `undefined` otherwise.
 */
function transformAsyncMiddleware(
  code: string,
  parse: (code: string) => AstNode,
): { code: string; map: ReturnType<MagicString['generateMap']> } | undefined {
  // Fast bailout — nothing to transform
  if (!code.includes('await')) return;

  let ast: AstNode;
  try {
    ast = parse(code);
  } catch {
    return; // unparseable → skip silently
  }

  const s = new MagicString(code);
  let transformed = false;

  // Find all `defineMiddleware(asyncFn)` call sites
  walkAst(ast, (node) => {
    if (
      node.type !== 'CallExpression' ||
      !node.callee ||
      node.callee.type !== 'Identifier' ||
      (node.callee as AstNode & { name: string }).name !== 'defineMiddleware'
    ) {
      return;
    }

    const args = node.arguments as AstNode[] | undefined;
    if (!args || args.length === 0) return;

    const funcNode = args[0];
    const isAsyncArrow = funcNode.type === 'ArrowFunctionExpression' && funcNode.async;
    const isAsyncFunc = funcNode.type === 'FunctionExpression' && funcNode.async;

    if (!isAsyncArrow && !isAsyncFunc) return;

    // Skip async generators — they cannot be represented as plain generators
    if (funcNode.generator) return;

    // ---- Collect top-level awaits inside the function body ----
    const bodyNode = funcNode.body as AstNode;
    if (!bodyNode) return;

    // Bail out if the function uses `for await...of` — converting it to a plain
    // generator would be incorrect since `for await` requires an async context.
    let hasForAwait = false;
    walkAst(bodyNode, (n) => {
      if (
        n !== bodyNode &&
        (n.type === 'ArrowFunctionExpression' ||
          n.type === 'FunctionExpression' ||
          n.type === 'FunctionDeclaration') &&
        n.async
      )
        return false;
      if (n.type === 'ForOfStatement' && (n as any).await) {
        hasForAwait = true;
        return false;
      }
    });
    if (hasForAwait) {
      console.warn(
        '[vite-plugin-vue-middleware] `for await...of` in middleware is not supported with the asyncContext transform. The middleware will run without Vue injection context across await boundaries.',
      );
      return;
    }

    const awaits = collectTopLevelAwaits(bodyNode);
    if (awaits.length === 0) return; // async but no awaits → nothing to do

    // ---- Replace each `await` keyword with `yield` ----
    for (const awaitNode of awaits) {
      // `await` is 5 chars, `yield` is 5 chars — positions stay aligned
      s.overwrite(awaitNode.start, awaitNode.start + 5, 'yield');
    }

    // ---- Convert async function to generator ----
    if (isAsyncArrow) {
      // async (to, from) => { ... }  →  function* (to, from) { ... }
      // 1. Replace `async` with `function*`
      s.overwrite(funcNode.start, funcNode.start + 5, 'function*');

      // 2. Remove the `=>` token between params and body
      const params = funcNode.params as AstNode[];
      const searchStart =
        params && params.length > 0
          ? params[params.length - 1].end
          : code.indexOf(')', funcNode.start) + 1;
      const arrowIdx = code.indexOf('=>', searchStart);
      if (arrowIdx !== -1) {
        s.remove(arrowIdx, arrowIdx + 2);
      }

      // 3. If expression body, wrap with `{ return ... }`
      if (bodyNode.type !== 'BlockStatement') {
        s.prependLeft(bodyNode.start, '{ return ');
        s.appendRight(bodyNode.end, ' }');
      }
    } else {
      // async function (to, from) { ... }  →  function* (to, from) { ... }
      // The AST node starts at `async`, so funcNode.start points to 'a' in 'async'
      // Search past 'async' (5 chars) to avoid matching 'function' inside a preceding comment
      const funcIdx = code.indexOf('function', funcNode.start + 5);
      // overwrite from 'async' through 'function' (the whole 'async function' span) with 'function*'
      s.overwrite(funcNode.start, funcIdx + 8, 'function*');
    }

    // ---- Wrap with __executeMiddleware(...) ----
    s.prependLeft(funcNode.start, '__executeMiddleware(');
    s.appendRight(funcNode.end, ')');

    transformed = true;
  });

  if (!transformed) return;

  // Ensure the import for __executeMiddleware exists
  s.prepend('import { __executeMiddleware } from "vite-plugin-vue-middleware/runtime";\n');

  return {
    code: s.toString(),
    map: s.generateMap({ hires: true }),
  };
}

// ---------------------------------------------------------------------------
// Main plugin
// ---------------------------------------------------------------------------

/**
 * Vite Plugin: Vue Middleware
 *
 * Type-safe navigation middleware for Vue Router with virtual module and HMR support
 *
 * @param {Partial<Options>} options - Plugin configuration options
 * @returns {Plugin}
 */
export function vueMiddleware(options: Partial<Options> = {}): Plugin {
  const {
    middlewareDir = 'src/middleware',
    dts = true,
    exclude = [],
    asyncContext = true,
  } = options;

  let viteConfig: ResolvedConfig;
  let pathsPromise: Promise<{ resolvedDir: string; resolvedDtsPath?: string }> | null = null;

  /**
   * Initialize and cache plugin-required paths
   *
   * Lazily resolves middleware directory and d.ts output path based on config (follows EAFP)
   *
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

        let code =
          'import { setupMiddleware as _setup } from "vite-plugin-vue-middleware/runtime";\n';
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

    async transform(code: string, id: string) {
      if (!asyncContext) return;

      const { resolvedDir } = await initPaths();
      const normalizedId = path.normalize(id);
      const normalizedDir = path.normalize(resolvedDir);

      // Only transform files inside the middleware directory
      if (!normalizedId.startsWith(normalizedDir)) return;

      // Only transform JS/TS files
      if (!/\.[jt]sx?$/.test(id)) return;

      return transformAsyncMiddleware(code, (c) => (this as any).parse(c) as AstNode);
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

export { transformAsyncMiddleware as _transformAsyncMiddleware };
