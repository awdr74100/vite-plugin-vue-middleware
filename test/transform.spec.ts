import { parse } from 'acorn';
import { describe, expect, it, vi } from 'vitest';

import { transformAsyncMiddleware } from '../src/transform';

/** Helper: parse JS code using acorn (same ESTree format as Rollup's this.parse) */
const acornParse = (code: string) =>
  parse(code, { ecmaVersion: 'latest', sourceType: 'module' }) as any;

describe('plugin: transformAsyncMiddleware', () => {
  it('should return undefined when code has no await', () => {
    const code = `
      import { defineMiddleware } from 'vite-plugin-vue-middleware/runtime';
      export default defineMiddleware((to, from) => {});
    `;
    expect(transformAsyncMiddleware(code, acornParse)).toBeUndefined();
  });

  it('should return undefined when no defineMiddleware call exists', () => {
    const code = `
      async function foo() { await bar(); }
    `;
    expect(transformAsyncMiddleware(code, acornParse)).toBeUndefined();
  });

  it('should return undefined for sync defineMiddleware', () => {
    const code = `
      import { defineMiddleware } from 'vite-plugin-vue-middleware/runtime';
      export default defineMiddleware((to, from) => { return '/login'; });
    `;
    expect(transformAsyncMiddleware(code, acornParse)).toBeUndefined();
  });

  it('should transform async arrow function with block body', () => {
    const code = `import { defineMiddleware } from 'vite-plugin-vue-middleware/runtime';
export default defineMiddleware(async (to, from) => {
  const data = await fetchData();
  return data;
});`;

    const result = transformAsyncMiddleware(code, acornParse);
    expect(result).toBeDefined();
    expect(result!.code).toContain('__executeMiddleware(');
    expect(result!.code).toContain('function*');
    expect(result!.code).toContain('yield fetchData()');
    expect(result!.code).not.toContain('await');
    expect(result!.code).not.toContain('async');
  });

  it('should transform async function expression', () => {
    const code = `import { defineMiddleware } from 'vite-plugin-vue-middleware/runtime';
export default defineMiddleware(async function (to, from) {
  const data = await fetchData();
  return data;
});`;

    const result = transformAsyncMiddleware(code, acornParse);
    expect(result).toBeDefined();
    expect(result!.code).toContain('__executeMiddleware(');
    expect(result!.code).toContain('function*');
    expect(result!.code).toContain('yield fetchData()');
    expect(result!.code).not.toContain('await');
  });

  it('should NOT transform await inside nested async functions', () => {
    const code = `import { defineMiddleware } from 'vite-plugin-vue-middleware/runtime';
export default defineMiddleware(async (to, from) => {
  const data = await fetchData();
  const handler = async () => {
    await nestedCall();
  };
  return data;
});`;

    const result = transformAsyncMiddleware(code, acornParse);
    expect(result).toBeDefined();

    // The top-level await should become yield
    expect(result!.code).toContain('yield fetchData()');

    // The nested async arrow and its await should be preserved
    expect(result!.code).toContain('async ()');
    expect(result!.code).toContain('await nestedCall()');
  });

  it('should add __executeMiddleware import', () => {
    const code = `import { defineMiddleware } from 'vite-plugin-vue-middleware/runtime';
export default defineMiddleware(async (to, from) => {
  await something();
});`;

    const result = transformAsyncMiddleware(code, acornParse);
    expect(result).toBeDefined();
    expect(result!.code).toContain(
      'import { __executeMiddleware } from "vite-plugin-vue-middleware/runtime"',
    );
  });

  it('should generate a source map', () => {
    const code = `import { defineMiddleware } from 'vite-plugin-vue-middleware/runtime';
export default defineMiddleware(async (to, from) => {
  await something();
});`;

    const result = transformAsyncMiddleware(code, acornParse);
    expect(result).toBeDefined();
    expect(result!.map).toBeDefined();
  });

  it('should handle multiple await expressions', () => {
    const code = `import { defineMiddleware } from 'vite-plugin-vue-middleware/runtime';
export default defineMiddleware(async (to, from) => {
  const a = await first();
  const b = await second();
  const c = await third();
  return [a, b, c];
});`;

    const result = transformAsyncMiddleware(code, acornParse);
    expect(result).toBeDefined();
    expect(result!.code).toContain('yield first()');
    expect(result!.code).toContain('yield second()');
    expect(result!.code).toContain('yield third()');
    expect(result!.code).not.toContain('await');
  });

  it('should skip async defineMiddleware with no awaits', () => {
    const code = `import { defineMiddleware } from 'vite-plugin-vue-middleware/runtime';
export default defineMiddleware(async (to, from) => {
  return '/login';
});`;

    const result = transformAsyncMiddleware(code, acornParse);
    expect(result).toBeUndefined();
  });

  it('should add parens around a single bare-identifier param (async to => ...)', () => {
    const code = `import { defineMiddleware } from 'vite-plugin-vue-middleware/runtime';
export default defineMiddleware(async to => {
  await fetchData();
  return to.path;
});`;

    const result = transformAsyncMiddleware(code, acornParse);
    expect(result).toBeDefined();
    // Must be `function* (to)` — `function* to` is a syntax error
    expect(result!.code).toMatch(/function\*\s*\(\s*to\s*\)/);
    expect(result!.code).toContain('yield fetchData()');

    // Sanity check: result must be syntactically valid JS
    expect(() => acornParse(result!.code)).not.toThrow();
  });

  it('should NOT add parens when the single param already has them', () => {
    const code = `import { defineMiddleware } from 'vite-plugin-vue-middleware/runtime';
export default defineMiddleware(async (to) => {
  await fetchData();
});`;

    const result = transformAsyncMiddleware(code, acornParse);
    expect(result).toBeDefined();
    // Should not duplicate the parens
    expect(result!.code).not.toMatch(/\(\(\s*to\s*\)\)/);
    expect(() => acornParse(result!.code)).not.toThrow();
  });

  it('should bail out and warn when middleware uses `for await...of`', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const code = `import { defineMiddleware } from 'vite-plugin-vue-middleware/runtime';
export default defineMiddleware(async (to, from) => {
  for await (const x of stream()) {
    console.log(x);
  }
});`;

    const result = transformAsyncMiddleware(code, acornParse);
    expect(result).toBeUndefined();
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('for await...of'));
    warnSpy.mockRestore();
  });

  it('should not transform async generator functions', () => {
    const code = `import { defineMiddleware } from 'vite-plugin-vue-middleware/runtime';
export default defineMiddleware(async function* (to, from) {
  yield await fetchData();
});`;

    const result = transformAsyncMiddleware(code, acornParse);
    expect(result).toBeUndefined();
  });

  it('should return undefined when defineMiddleware is called without arguments', () => {
    const code = `import { defineMiddleware } from 'vite-plugin-vue-middleware/runtime';
defineMiddleware();
async function other() { await foo(); }`;

    expect(transformAsyncMiddleware(code, acornParse)).toBeUndefined();
  });

  it('should produce parseable output for an arrow with expression body', () => {
    const code = `import { defineMiddleware } from 'vite-plugin-vue-middleware/runtime';
export default defineMiddleware(async (to) => (await load(to)));`;

    const result = transformAsyncMiddleware(code, acornParse);
    expect(result).toBeDefined();
    expect(result!.code).toContain('{ return ');
    expect(result!.code).toContain('yield load(to)');
    expect(() => acornParse(result!.code)).not.toThrow();
  });
});
