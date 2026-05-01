import type { Node } from 'estree-walker';
import { walk } from 'estree-walker';
import MagicString from 'magic-string';

import { PLUGIN_NAME, RUNTIME_IMPORT_PATH } from './constants';

/** ESTree node enriched with source positions added by acorn / OXC at parse time */
export type ParsedNode = Node & { start: number; end: number };

/** Parser callback — must produce an ESTree-shaped AST with `start`/`end` byte offsets */
type ParseFn = (code: string) => ParsedNode;

/** Result of a successful transform */
type TransformResult = {
  code: string;
  map: ReturnType<MagicString['generateMap']>;
};

const ASYNC_KEYWORD_LEN = 'async'.length;
const AWAIT_KEYWORD_LEN = 'await'.length;
const FUNCTION_KEYWORD_LEN = 'function'.length;

const FUNCTION_NODE_TYPES = new Set([
  'ArrowFunctionExpression',
  'FunctionExpression',
  'FunctionDeclaration',
]);

/**
 * Apply the async → generator transform to a middleware source file.
 *
 * Looks for `defineMiddleware(async ...)` call sites, converts the async function to a generator
 * (`await` → `yield`), and wraps it with the runtime `__executeMiddleware` executor so that each
 * generator segment runs inside `app.runWithContext()`.
 *
 * @returns `{ code, map }` if the file was transformed, or `undefined` otherwise.
 */
export function transformAsyncMiddleware(
  code: string,
  parse: ParseFn,
): TransformResult | undefined {
  // Fast bailout — nothing to transform
  if (!code.includes('await')) return;

  let ast: ParsedNode;
  try {
    ast = parse(code);
  } catch {
    return; // unparseable → skip silently
  }

  const s = new MagicString(code);
  let transformed = false;

  walk(ast as Node, {
    enter(node) {
      const n = node as ParsedNode;
      if (!isDefineMiddlewareCall(n)) return;

      const args = (n as any).arguments as ParsedNode[];
      const funcNode = args[0];
      if (!funcNode || !isTransformableAsyncFn(funcNode)) return;

      const bodyNode = (funcNode as any).body as ParsedNode;

      // Skip whole-fn transform if body uses `for await...of` — converting to a plain
      // generator would be incorrect since `for await` requires an async context.
      if (containsForAwait(bodyNode)) {
        console.warn(
          `[${PLUGIN_NAME}] \`for await...of\` in middleware is not supported with the asyncContext transform. The middleware will run without Vue injection context across await boundaries.`,
        );
        return;
      }

      const awaits = collectTopLevelAwaits(bodyNode);
      if (awaits.length === 0) return; // async but no awaits → nothing to do

      // 1. `await` → `yield` (both are 5 chars, source positions stay aligned)
      for (const awaitNode of awaits) {
        s.overwrite(awaitNode.start, awaitNode.start + AWAIT_KEYWORD_LEN, 'yield');
      }

      // 2. Convert the async function to a generator
      if (funcNode.type === 'ArrowFunctionExpression') {
        rewriteAsyncArrow(s, code, funcNode);
      } else {
        rewriteAsyncFunctionExpression(s, code, funcNode);
      }

      // 3. Wrap with runtime executor
      s.prependLeft(funcNode.start, '__executeMiddleware(');
      s.appendRight(funcNode.end, ')');

      transformed = true;

      // Don't descend into the function body — we've already rewritten its awaits
      this.skip();
    },
  });

  if (!transformed) return;

  // Ensure the runtime helper import is present at the top of the file
  s.prepend(`import { __executeMiddleware } from "${RUNTIME_IMPORT_PATH}";\n`);

  return {
    code: s.toString(),
    map: s.generateMap({ hires: true }),
  };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function isDefineMiddlewareCall(n: ParsedNode): boolean {
  return (
    n.type === 'CallExpression' &&
    (n as any).callee?.type === 'Identifier' &&
    (n as any).callee.name === 'defineMiddleware'
  );
}

function isTransformableAsyncFn(funcNode: ParsedNode): boolean {
  if (funcNode.type !== 'ArrowFunctionExpression' && funcNode.type !== 'FunctionExpression') {
    return false;
  }
  // Async generators cannot be flattened into plain generators
  return Boolean((funcNode as any).async) && !(funcNode as any).generator;
}

/**
 * Collect all top-level `AwaitExpression` nodes inside `root`, skipping any nested async functions
 * (arrow, expression, or declaration) — their awaits remain untouched.
 */
function collectTopLevelAwaits(root: ParsedNode): ParsedNode[] {
  const awaits: ParsedNode[] = [];

  walk(root as Node, {
    enter(node) {
      const n = node as ParsedNode;
      if (n !== root && FUNCTION_NODE_TYPES.has(n.type) && (n as any).async) {
        this.skip();
        return;
      }
      if (n.type === 'AwaitExpression') {
        awaits.push(n);
      }
    },
  });

  return awaits;
}

/** Detect any `for await...of` at the top level (skipping nested async functions) */
function containsForAwait(root: ParsedNode): boolean {
  let found = false;

  walk(root as Node, {
    enter(node) {
      const n = node as ParsedNode;
      if (n !== root && FUNCTION_NODE_TYPES.has(n.type) && (n as any).async) {
        this.skip();
        return;
      }
      if (n.type === 'ForOfStatement' && (n as any).await) {
        found = true;
        this.skip();
      }
    },
  });

  return found;
}

/**
 * `async (a, b) => body` → `function* (a, b) { ... body ... }`
 *
 * Handles three subtleties:
 *
 * 1. Single-param shorthand `async x => ...` is valid for arrows but **invalid** for generator
 *    functions, so we synthesise the missing parens around the parameter.
 * 2. The `=>` token has to go.
 * 3. Expression-body arrows must be wrapped in `{ return ... }`.
 */
function rewriteAsyncArrow(s: MagicString, code: string, funcNode: ParsedNode): void {
  // Replace the leading `async` keyword with `function*`
  s.overwrite(funcNode.start, funcNode.start + ASYNC_KEYWORD_LEN, 'function*');

  const params = (funcNode as any).params as ParsedNode[];
  const bodyNode = (funcNode as any).body as ParsedNode;

  // Single bare-identifier param (e.g. `async to => ...`) needs parens for `function*`
  if (params.length === 1 && needsSyntheticParens(code, funcNode.start, params[0])) {
    s.prependLeft(params[0].start, '(');
    s.appendRight(params[0].end, ')');
  }

  // Locate the `=>` token between the params and the body
  const paramsEnd =
    params.length > 0 ? params[params.length - 1].end : code.indexOf(')', funcNode.start) + 1;
  const arrowIdx = code.indexOf('=>', paramsEnd);

  if (arrowIdx === -1 || arrowIdx >= bodyNode.start) {
    // Defensive — should not happen for valid input
    return;
  }

  // Remove `=>` itself
  s.remove(arrowIdx, arrowIdx + 2);

  // Expression body → wrap into a block. We wrap the **entire** post-`=>` region (not just the
  // body node) so that any source-level wrapping like `=> (await foo())` is preserved as
  // `{ return (yield foo()) }` rather than the invalid `({ return yield foo() })`.
  if (bodyNode.type !== 'BlockStatement') {
    s.appendRight(arrowIdx + 2, ' { return ');
    s.appendRight(funcNode.end, ' }');
  }
}

/** `async function name?(a, b) { ... }` → `function* name?(a, b) { ... }` */
function rewriteAsyncFunctionExpression(s: MagicString, code: string, funcNode: ParsedNode): void {
  // funcNode.start points to 'a' in 'async'. Skip past 'async' (5 chars) before
  // searching for 'function' to avoid matching the substring inside a preceding comment.
  const funcIdx = code.indexOf('function', funcNode.start + ASYNC_KEYWORD_LEN);
  s.overwrite(funcNode.start, funcIdx + FUNCTION_KEYWORD_LEN, 'function*');
}

/**
 * Decide whether an arrow's lone parameter needs us to synthesise enclosing parens.
 *
 * `async x => ...` has none; `async (x) => ...` does. We can tell the two apart by checking the
 * source between the end of the `async` keyword and the start of the parameter for an opening
 * paren.
 */
function needsSyntheticParens(code: string, funcStart: number, param: ParsedNode): boolean {
  if (param.type !== 'Identifier') return false;
  const between = code.slice(funcStart + ASYNC_KEYWORD_LEN, param.start);
  return !between.includes('(');
}
