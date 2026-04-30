import { parse } from 'acorn';
import { describe, it, expect } from 'vitest';

import { _transformAsyncMiddleware as transformAsyncMiddleware } from '../src/plugin';

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
});
