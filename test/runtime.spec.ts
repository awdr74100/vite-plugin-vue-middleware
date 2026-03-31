import { describe, it, expect, vi, beforeEach } from 'vitest';

import { setupMiddleware, defineMiddleware } from '../src/runtime';

describe('runtime: setupMiddleware', () => {
  let router: any;
  let beforeEachHandler: any;

  beforeEach(() => {
    beforeEachHandler = null;
    router = {
      beforeEach: vi.fn((handler) => {
        beforeEachHandler = handler;
      }),
    };
  });

  it('should register a beforeEach guard', () => {
    setupMiddleware(router as any, [], {});
    expect(router.beforeEach).toHaveBeenCalledOnce();
  });

  it('should execute global middleware in order', async () => {
    const callOrder: string[] = [];
    const m1 = defineMiddleware(async () => {
      callOrder.push('m1');
    });
    const m2 = defineMiddleware(async () => {
      callOrder.push('m2');
    });

    setupMiddleware(router as any, [m1, m2], {});

    const to = { meta: {} } as any;
    const from = {} as any;

    await beforeEachHandler(to, from);
    expect(callOrder).toEqual(['m1', 'm2']);
  });

  it('should stop and return the result if global middleware redirects', async () => {
    const m1 = defineMiddleware(async () => '/login');
    const m2 = vi.fn();

    setupMiddleware(router as any, [m1, m2 as any], {});

    const result = await beforeEachHandler({ meta: {} } as any, {} as any);
    expect(result).toBe('/login');
    expect(m2).not.toHaveBeenCalled();
  });

  it('should handle named middleware from route meta', async () => {
    const callOrder: string[] = [];
    const m1 = defineMiddleware(async () => {
      callOrder.push('m1');
    });
    const named = {
      auth: defineMiddleware(async () => {
        callOrder.push('auth');
      }),
    };

    setupMiddleware(router as any, [m1], named);

    const to = { meta: { middleware: 'auth' } } as any;

    await beforeEachHandler(to, {} as any);
    expect(callOrder).toEqual(['m1', 'auth']);
  });

  it('should handle multiple named middleware in route meta array', async () => {
    const callOrder: string[] = [];
    const named = {
      a: defineMiddleware(async () => {
        callOrder.push('a');
      }),
      b: defineMiddleware(async () => {
        callOrder.push('b');
      }),
    };

    setupMiddleware(router as any, [], named);

    const to = { meta: { middleware: ['a', 'b'] } } as any;

    await beforeEachHandler(to, {} as any);
    expect(callOrder).toEqual(['a', 'b']);
  });

  it('should warn if named middleware is not found', async () => {
    const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    setupMiddleware(router as any, [], {});

    const to = { meta: { middleware: 'missing' } } as any;

    await beforeEachHandler(to, {} as any);
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('Middleware "missing" not found'),
    );
    consoleSpy.mockRestore();
  });

  it('should handle errors thrown in middleware', async () => {
    const error = new Error('fail');
    const m1 = defineMiddleware(async () => {
      throw error;
    });

    setupMiddleware(router as any, [m1], {});

    await expect(beforeEachHandler({ meta: {} } as any, {} as any)).rejects.toThrow('fail');
  });

  it('should handle Error instances returned from middleware', async () => {
    const error = new Error('returned fail');
    const m1 = defineMiddleware(async () => error);

    setupMiddleware(router as any, [m1], {});

    await expect(beforeEachHandler({ meta: {} } as any, {} as any)).rejects.toThrow(
      'returned fail',
    );
  });
});
