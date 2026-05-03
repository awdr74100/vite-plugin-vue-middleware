import { parse } from 'acorn';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/parse', () => ({
  parseMiddlewareFiles: vi.fn<typeof import('../src/parse').parseMiddlewareFiles>(),
}));

import { RESOLVED_VIRTUAL_MODULE_ID } from '../src/constants';
import { parseMiddlewareFiles } from '../src/parse';
import { vueMiddleware } from '../src/plugin';

const acornParse = (code: string) =>
  parse(code, { ecmaVersion: 'latest', sourceType: 'module' }) as any;

const asyncCode = `import { defineMiddleware } from 'vite-plugin-vue-middleware/runtime';
export default defineMiddleware(async (to, from) => {
  await something();
});`;

function makePlugin(opts: object = {}) {
  const plugin = vueMiddleware({ middlewareDir: 'src/middleware', asyncContext: true, ...opts } as any);
  (plugin as any).configResolved({ root: '/project' });
  return plugin;
}

function callTransform(plugin: ReturnType<typeof vueMiddleware>, code: string, id: string) {
  return (plugin.transform as Function).call({ parse: acornParse }, code, id);
}

describe('plugin: isInsideMiddlewareDir (via transform)', () => {
  it('should transform files directly inside the middleware dir', () => {
    const plugin = makePlugin();
    expect(callTransform(plugin, asyncCode, '/project/src/middleware/auth.ts')).toBeDefined();
  });

  it('should transform files in subdirectories of the middleware dir', () => {
    const plugin = makePlugin();
    expect(callTransform(plugin, asyncCode, '/project/src/middleware/nested/logger.ts')).toBeDefined();
  });

  it('should NOT transform files in a sibling directory sharing the prefix (middleware-extra)', () => {
    const plugin = makePlugin();
    expect(callTransform(plugin, asyncCode, '/project/src/middleware-extra/auth.ts')).toBeUndefined();
  });

  it('should strip Vite query suffix before path matching', () => {
    const plugin = makePlugin();
    expect(
      callTransform(plugin, asyncCode, '/project/src/middleware/auth.ts?vue&type=script'),
    ).toBeDefined();
  });

  it('should NOT transform non-script files inside the middleware dir', () => {
    const plugin = makePlugin();
    expect(callTransform(plugin, asyncCode, '/project/src/middleware/utils.css')).toBeUndefined();
  });

  it('should NOT transform anything when asyncContext is false', () => {
    const plugin = makePlugin({ asyncContext: false });
    expect(callTransform(plugin, asyncCode, '/project/src/middleware/auth.ts')).toBeUndefined();
  });
});

describe('plugin: buildVirtualModule (via load)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return undefined for non-virtual-module ids', async () => {
    vi.mocked(parseMiddlewareFiles).mockResolvedValue([]);
    const plugin = makePlugin();
    expect(await (plugin as any).load('/some/real/file.ts')).toBeUndefined();
  });

  it('should place global middleware in globalMiddleware array', async () => {
    vi.mocked(parseMiddlewareFiles).mockResolvedValue([
      { name: 'setup', path: '/project/src/middleware/setup.global.ts', isGlobal: true, order: 0 },
    ]);
    const plugin = makePlugin();
    const code: string = await (plugin as any).load(RESOLVED_VIRTUAL_MODULE_ID);
    expect(code).toContain('globalMiddleware = [__middleware_0]');
    expect(code).toContain('namedMiddleware = /*#__PURE__*/ Object.assign(Object.create(null), {  })');
  });

  it('should place named middleware in namedMiddleware object', async () => {
    vi.mocked(parseMiddlewareFiles).mockResolvedValue([
      { name: 'auth', path: '/project/src/middleware/auth.ts', isGlobal: false, order: 0 },
    ]);
    const plugin = makePlugin();
    const code: string = await (plugin as any).load(RESOLVED_VIRTUAL_MODULE_ID);
    expect(code).toContain('"auth": __middleware_0');
    expect(code).toContain('globalMiddleware = []');
  });

  it('should use Object.create(null) to prevent prototype pollution', async () => {
    vi.mocked(parseMiddlewareFiles).mockResolvedValue([
      { name: '__proto__', path: '/project/src/middleware/__proto__.ts', isGlobal: false, order: 0 },
    ]);
    const plugin = makePlugin();
    const code: string = await (plugin as any).load(RESOLVED_VIRTUAL_MODULE_ID);
    expect(code).toContain('Object.create(null)');
    expect(code).toContain('"__proto__"');
  });

  it('should produce valid empty output when no middleware exists', async () => {
    vi.mocked(parseMiddlewareFiles).mockResolvedValue([]);
    const plugin = makePlugin();
    const code: string = await (plugin as any).load(RESOLVED_VIRTUAL_MODULE_ID);
    expect(code).toContain('globalMiddleware = []');
    expect(code).toContain('Object.create(null)');
  });
});
